"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { confirmJobDraft, confirmGeneralCleaningDraft, readCurrentConfirmedDraft,
  readCurrentConfirmedCleaningDraft } = require("../src/v2/confirmedPostingDraft");
const { createJobDraftCallable, createConfirmedDraftCallable } = require("../src/v2/confirmedDraftCallable");
const { POLICY_VERSION } = require("../src/v2/taskScopePolicy");
const { commandPayloadDigest } = require("../src/v2/foundation");
const now = new Date("2026-09-23T12:00:00Z");
const clear = "CLEARED_EXACT_TEMPLATE_V1";
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
function submission() {
  return { task_type_id: "general_cleaning", taxonomy_version: 2,
    title: "Clean bedroom", description: "Deep cleaning of bedroom.", additional_info: "",
    duration_minutes: 120, schedule_window: { start_at: "2099-09-24T13:00:00Z",
      end_at: "2099-09-24T15:00:00Z", time_zone: "America/New_York" },
    scope: { areas_items: ["bedroom"], cleaning_level: "DEEP", approximate_scale: "one room" },
    risk_facts: { medical_or_intimate_care: "ABSENT_CONFIRMED", hazardous_materials: "ABSENT_CONFIRMED",
      pest_control: "ABSENT_CONFIRMED", chemical_risk: "ABSENT_CONFIRMED", unknown_conditions: "ABSENT_CONFIRMED" },
    conflicting_facts: [], additional_task_type_ids: [], prohibited_scope_codes: [] };
}
function setup() {
  const records = new Map();
  const db = { collection: (name) => ({ doc: (id) => ({ key: `${name}/${id}` }) }),
    runTransaction: async (work) => {
      const staged = new Map(records);
      const result = await work({
        get: async (ref) => ({ exists: staged.has(ref.key), data: () => structuredClone(staged.get(ref.key)) }),
        set: (ref, record) => staged.set(ref.key, structuredClone(record))
      });
      records.clear(); for (const [key, value] of staged) records.set(key, value);
      return result;
    } };
  const args = (content = submission()) => ({ db, actorRef: "poster-1", intentKey: "confirmed-job-intent-1",
    expectedVersion: 0, taskSchemaVersion: 2, submission: content, now });
  const read = (receipt, actor = "poster-1") => db.runTransaction((tx) =>
    readCurrentConfirmedDraft(tx, db, receipt.draft_ref, actor, receipt.draft_version));
  return { db, records, args, read };
}
const request = () => ({ intent_key: "confirmed-job-intent-1", expected_version: 0,
  task_schema_version: 2, submission: submission() });
const ctx = { auth: { uid: "poster-1" } };

const { canonicalReviewedScope, verifyScopeReview } = require("../src/v2/scopeReview");
const vector = require("./fixtures/scope-review-v1.json");
const review = (scope) => ({ version: 1, scope_digest: commandPayloadDigest(canonicalReviewedScope(scope)) });
const reviewed = (args) => ({ ...args, confirmationContractVersion: 2, scopeReview: review(args.submission.scope) });

test("canonical cross-platform vector, reordered areas, separate safety evidence", () => {
  assert.equal(commandPayloadDigest(canonicalReviewedScope(vector.scope)), vector.digest);
  assert.deepEqual(canonicalReviewedScope(vector.scope), JSON.parse(vector.canonical));
  assert.deepEqual(review({ ...vector.scope, areas_items: ["bedroom", "KITCHEN"] }), review(vector.scope));
  assert.deepEqual(review({ ...vector.scope, condition_hazards: "UNKNOWN" }), review(vector.scope));
  assert.notDeepEqual(review({ ...vector.scope, areas_items: ["bedroom", "bedroom"] }), review(vector.scope));
});

test("reviewed command records bound provenance and preserves text-5, receipt and exact replay", async () => {
  const { args, records, read } = setup(); const command = reviewed(args());
  const receipt = await confirmJobDraft(command);
  assert.equal(receipt.text_reconciliation_state, clear);
  assert.deepEqual(await confirmJobDraft(command), receipt);
  const record = [...records.values()][0];
  assert.equal(record.schema_version, 4); assert.equal(record.confirmation_contract_version, 2);
  assert.deepEqual(record.scope_review, command.scopeReview);
  assert.equal(record.text_rule_version, "cleaning-text-5");
  assert.equal(record.owner_ref, "poster-1"); await read(receipt);
  record.scope_review.scope_digest = "0".repeat(64);
  records.set([...records.keys()][0], record);
  await assert.rejects(read(receipt), /CONFIRMED_DRAFT_UNAVAILABLE/);
});

test("new contract rejects missing/malformed/forged acknowledgment and unsupported versions", async () => {
  for (const acknowledgment of [undefined, null, true, {}, { version: 1 },
    { version: 2, scope_digest: vector.digest }, { version: 1, scope_digest: "0".repeat(64) },
    { version: 1, scope_digest: vector.digest, owner_ref: "forged" }]) {
    const { args, records } = setup();
    await assert.rejects(confirmJobDraft({ ...reviewed(args()), scopeReview: acknowledgment }), /DRAFT_INPUT_INVALID/);
    assert.equal(records.size, 0);
  }
  const { args } = setup();
  await assert.rejects(confirmJobDraft({ ...reviewed(args()), confirmationContractVersion: 3 }), /DRAFT_INPUT_INVALID/);
  await assert.rejects(confirmJobDraft({ ...args(), scopeReview: review(args().submission.scope) }), /DRAFT_INPUT_INVALID/);
});

test("every included fact binds the acknowledgment; server recomputes digest", async () => {
  for (const patch of [{ areas_items: ["kitchen"] }, { cleaning_level: "STANDARD" },
    { approximate_scale: "2 rooms" }, { room_count: 2 }, { supplies_responsibility: "POSTER_PROVIDES" }]) {
    const { args, records } = setup(); const command = reviewed(args());
    Object.assign(command.submission.scope, patch);
    await assert.rejects(confirmJobDraft(command), /DRAFT_INPUT_INVALID/); assert.equal(records.size, 0);
  }
});

test("safety and prohibited scope remain independently authoritative", async () => {
  for (const key of Object.keys(submission().risk_facts)) {
    const { args } = setup(); const command = reviewed(args());
    command.submission.risk_facts[key] = "UNKNOWN";
    const result = await confirmJobDraft(command);
    assert.equal(result.policy_outcome, "ESCALATION_REQUIRED"); assert.equal(result.text_reconciliation_state, "UNRESOLVED");
  }
  const { args } = setup(); const command = reviewed(args());
  command.submission.prohibited_scope_codes = ["HAZARDOUS_MATERIALS"];
  assert.equal((await confirmJobDraft(command)).policy_outcome, "UNSUPPORTED_WITHHOLD");
});

test("legacy commands replay without provenance; explicit next-version acceptance adds provenance", async () => {
  const { args, records, read } = setup(); const old = args(); const receipt = await confirmJobDraft(old);
  assert.deepEqual(await confirmJobDraft(old), receipt); await read(receipt);
  assert.equal([...records.values()][0].scope_review, undefined);
  await assert.rejects(confirmJobDraft(reviewed(old)), /DRAFT_VERSION_CONFLICT/);
  const next = await confirmJobDraft(reviewed({ ...args(), expectedVersion: 1 }));
  assert.equal(next.draft_version, 2); await read(next);
});

test("callable requires authentication, exact envelope and review; owner never comes from data", async () => {
  const { db, records } = setup(); const handler = createConfirmedDraftCallable({ db, HttpsError });
  const body = { intent_key: "reviewed-cleaning-intent", expected_version: 0, submission: submission(),
    confirmation_contract_version: 2, scope_review: review(submission().scope) };
  await assert.rejects(handler(body, {}), e => e.code === "unauthenticated");
  for (const invalid of [{ ...body, scope_review: undefined }, { ...body, owner_ref: "forged" },
    { ...body, confirmation_contract_version: 3 }]) {
    await assert.rejects(handler(invalid, ctx), e => e.code === "invalid-argument");
  }
  const result = await handler(body, ctx);
  assert.equal(result.draft_version, 1); assert.equal([...records.values()][0].owner_ref, "poster-1");
});
