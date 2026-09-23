"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  STANDING_POLICY_VERSION, SAFETY_POLICY_VERSION,
  standingFromAuth, safetyFromDecision, readCurrentPublicationStanding,
  recordSafetyDecision
} = require("../src/v2/standingSafetyAuthority");

const now = new Date("2026-09-23T12:00:00Z");
const later = new Date("2026-09-24T12:00:00Z");
const decision = {
  subject_ref: "poster-1", authority: "BACKEND_DOMAIN",
  source: "V2_SAFETY_OPERATOR", policy_version: SAFETY_POLICY_VERSION,
  state: "CLEAR", operator_ref: "safety-op-1", reason_code: "REVIEW_CLEAR",
  version: 1, decided_at: now, valid_until: later
};

test("current Admin Auth, not legacy status or claims, produces standing", () => {
  assert.equal(standingFromAuth("poster-1", { uid: "poster-1", disabled: false }).publication_allowed, true);
  assert.equal(standingFromAuth("poster-1", { uid: "poster-1", disabled: true }).publication_allowed, false);
  assert.equal(standingFromAuth("poster-1", { uid: "poster-2", disabled: false }), null);
  assert.equal(standingFromAuth("poster-1", { accountStatus: "active", customClaims: { admin: true } }), null);
  assert.equal(standingFromAuth("poster-1", { uid: "poster-1" }), null);
  assert.equal(STANDING_POLICY_VERSION, "v2-standing-auth-1");
});

test("moderation clearance has explicit provenance, version and expiry", () => {
  assert.equal(safetyFromDecision("poster-1", decision, now).publication_clear, true);
  assert.equal(safetyFromDecision("poster-1", { ...decision, state: "BLOCKED" }, now).publication_clear, false);
  assert.equal(safetyFromDecision("poster-1", { ...decision, state: "REVOKED" }, now).publication_clear, false);
  assert.equal(safetyFromDecision("poster-1", decision, later).publication_clear, false);
  for (const bad of [null, { ...decision, authority: "CLIENT" },
    { ...decision, source: "legacy_admin" }, { ...decision, subject_ref: "other" },
    { ...decision, policy_version: "unknown" }, { ...decision, operator_ref: "" },
    { ...decision, valid_until: now }, { ...decision, version: 0 }]) {
    assert.equal(safetyFromDecision("poster-1", bad, now), null);
  }
});

test("consumer requires live Auth, protected decision and matching audit", async () => {
  let current = decision;
  let audit = { ...decision, prior_version: 0 };
  let disabled = false;
  const db = { collection: (name) => ({ doc: (id) => ({ name, id }) }) };
  const tx = { get: async ({ name }) => ({ exists: true,
    data: () => name === "v2Safety" ? current : audit }) };
  const auth = { getUser: async (uid) => ({ uid, disabled }) };
  const check = () => readCurrentPublicationStanding({ actorRef: "poster-1", auth, tx, db, now });
  assert.equal((await check()).allowed, true);
  assert.deepEqual((await check()).provenance, {
    standing_policy_version: STANDING_POLICY_VERSION, auth_checked_at: now,
    safety_policy_version: SAFETY_POLICY_VERSION, safety_decision_version: 1
  });
  disabled = true;
  assert.equal((await check()).allowed, false);
  disabled = false;
  audit = { ...audit, state: "BLOCKED" };
  assert.equal((await check()).reason, "AUTHORITY_UNAVAILABLE");
  audit = { ...decision };
  current = { ...decision, state: "REVOKED" };
  assert.equal((await check()).allowed, false);
  current = decision;
  assert.equal((await readCurrentPublicationStanding({ actorRef: "poster-1",
    auth: { getUser: async () => { throw new Error("missing user"); } }, tx, db, now })).allowed, false);
});

test("writer is inert without explicit narrow authorization", async () => {
  let transactions = 0;
  const db = { runTransaction: async () => { transactions++; } };
  const args = { db, operatorRef: "broad-admin", subjectRef: "poster-1",
    state: "CLEAR", reasonCode: "REVIEW_CLEAR", expectedVersion: 0,
    validUntil: later, now };
  await assert.rejects(recordSafetyDecision(args), /NOT_AUTHORIZED/);
  await assert.rejects(recordSafetyDecision({ ...args, authorizeSafetyOperator: async () => false }), /NOT_AUTHORIZED/);
  assert.equal(transactions, 0);
});
