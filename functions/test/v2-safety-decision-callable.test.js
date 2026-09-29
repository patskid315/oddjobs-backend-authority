"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSafetyDecisionCallable } = require("../src/v2/safetyDecisionCallable");
const { safetyFromDecision, SAFETY_POLICY_VERSION } = require("../src/v2/standingSafetyAuthority");
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const now = new Date("2030-01-01T00:00:00.000Z");
const context = { auth: { uid: "operator-1" } };
const request = () => ({ subject_ref: "subject-1", state: "CLEAR", reason_code: "REVIEW_CLEAR",
  expected_version: 0, valid_until: "2030-01-02T00:00:00.000Z" });
const code = (expected) => (error) => error.code === expected;
function setup() {
  const records = new Map();
  let configuration = '["operator-1"]';
  let transactions = 0;
  const db = {
    collection: (name) => ({ doc: (id) => ({ key: `${name}/${id}` }) }),
    // Sequential atomic mock; not a claim of live Firestore concurrency testing.
    runTransaction: async (work) => {
      transactions++;
      const next = new Map(records);
      const result = await work({
        get: async (ref) => ({ exists: next.has(ref.key), data: () => next.get(ref.key) }),
        create: (ref, value) => { if (next.has(ref.key)) throw new Error("audit exists"); next.set(ref.key, value); },
        set: (ref, value) => next.set(ref.key, value)
      });
      records.clear(); for (const [key, value] of next) records.set(key, value);
      return result;
    }
  };
  return { records, get transactions() { return transactions; },
    configure: (value) => { configuration = value; },
    handler: createSafetyDecisionCallable({ db, HttpsError, clock: () => now,
      getOperatorConfiguration: () => configuration }) };
}

test("unauthenticated caller cannot reach authority", async () => {
  const s = setup();
  for (const ctx of [undefined, {}, { auth: {} }, { auth: { uid: "" } }]) {
    await assert.rejects(s.handler(request(), ctx), code("unauthenticated"));
  }
  assert.equal(s.transactions, 0);
});

test("missing, empty and malformed allowlists fail closed", async () => {
  const s = setup();
  for (const config of [undefined, "", "[]", "null", "{}", "true", "bad", '"operator-1"',
    '["operator-1",3]', '["operator-1",""]', '["operator-1","operator-1"]',
    '[" operator-1"]', '["operator-1","bad/uid"]']) {
    s.configure(config);
    await assert.rejects(s.handler(request(), context), code("permission-denied"));
  }
  assert.equal(s.transactions, 0);
});

test("unauthorized UID cannot use claims, email, or wildcard as authority", async () => {
  const s = setup(); s.configure('["*"]');
  await assert.rejects(s.handler(request(), { auth: { uid: "other", token: { admin: true, email: "operator-1" } } }), code("permission-denied"));
  assert.equal(s.transactions, 0);
});

test("operator identity forgery, extra fields and self-decisions are rejected", async () => {
  const s = setup();
  for (const extra of [{ operator_ref: "operator-1" }, { authorizeSafetyOperator: true },
    { subjectRef: "other" }, { claims: { admin: true } }]) {
    await assert.rejects(s.handler({ ...request(), ...extra }, context), code("invalid-argument"));
  }
  await assert.rejects(s.handler({ ...request(), subject_ref: "operator-1" }, context), code("permission-denied"));
  await assert.rejects(s.handler({ ...request(), subject_ref: "../other" }, context), code("invalid-argument"));
  assert.equal(s.transactions, 0);
});

for (const state of ["CLEAR", "BLOCKED", "REVOKED"]) {
  test(`authorized ${state} uses real authority and consistent audit`, async () => {
    const s = setup();
    const result = await s.handler({ ...request(), state }, context);
    assert.deepEqual(result, { subject_ref: "subject-1", state, version: 1, policy_version: SAFETY_POLICY_VERSION });
    const decision = s.records.get("v2Safety/subject-1");
    assert.equal(decision.operator_ref, "operator-1");
    assert.equal(decision.decided_at, now);
    assert.deepEqual(s.records.get("v2SafetyAudit/subject-1_1"), { ...decision, prior_version: 0 });
    assert.equal(safetyFromDecision("subject-1", decision, now).publication_clear, state === "CLEAR");
  });
}

test("versions advance; conflicts and audit collisions cannot overwrite records", async () => {
  const s = setup(); await s.handler(request(), context);
  const audit = s.records.get("v2SafetyAudit/subject-1_1");
  await assert.rejects(s.handler(request(), context), code("failed-precondition"));
  await s.handler({ ...request(), state: "BLOCKED", expected_version: 1 }, context);
  assert.equal(s.records.get("v2Safety/subject-1").version, 2);
  assert.deepEqual(s.records.get("v2SafetyAudit/subject-1_1"), audit);
  assert.equal(s.records.get("v2SafetyAudit/subject-1_2").prior_version, 1);
  s.records.set("v2SafetyAudit/subject-1_3", { sentinel: true });
  await assert.rejects(s.handler({ ...request(), expected_version: 2 }, context), code("failed-precondition"));
  assert.equal(s.records.get("v2Safety/subject-1").version, 2);
  assert.deepEqual(s.records.get("v2SafetyAudit/subject-1_3"), { sentinel: true });
});

test("configuration removal revokes authorization without cached privileges", async () => {
  const s = setup(); await s.handler(request(), context);
  s.configure('["different-operator"]');
  await assert.rejects(s.handler({ ...request(), expected_version: 1 }, context), code("permission-denied"));
  assert.equal(s.transactions, 1);
});

test("invalid state, expiry and version fail without exposing internals", async () => {
  const s = setup();
  for (const patch of [{ state: "ADMIN_CLEAR" }, { valid_until: "2029-01-01T00:00:00.000Z" },
    { valid_until: "2030-02-30T00:00:00.000Z" }, { expected_version: Number.MAX_SAFE_INTEGER }]) {
    await assert.rejects(s.handler({ ...request(), ...patch }, context), (error) => {
      assert.ok(["invalid-argument", "failed-precondition"].includes(error.code));
      assert.ok(!error.message.includes("SAFETY_") && !error.message.includes("operator-1"));
      return true;
    });
  }
  assert.equal(s.records.size, 0);
});


test("configuration read failure and removal at the authority gate fail closed", async () => {
  for (const throws of [false, true]) {
    let reads = 0, transactions = 0;
    const handler = createSafetyDecisionCallable({
      db: { runTransaction: () => { transactions++; } }, HttpsError, clock: () => now,
      getOperatorConfiguration: () => {
        reads++;
        if (throws) throw new Error("private configuration failure");
        return reads === 1 ? '["operator-1"]' : '[]';
      }
    });
    await assert.rejects(handler(request(), context), code(throws ? "permission-denied" : "failed-precondition"));
    assert.equal(transactions, 0);
  }
});
