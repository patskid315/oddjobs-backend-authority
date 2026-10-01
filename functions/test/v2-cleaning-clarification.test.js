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

const { canonicalReviewedScope } = require("../src/v2/scopeReview");
const { reconcileReviewedCleaning } = require("../src/v2/generalCleaningReconciliationV6");
const { cleaningV2, cleaningV2Text3, cleaningV2Text4, cleaningV2Text5 } = require("../src/v2/generalCleaningValidator");
const review = (scope) => ({ version: 1, scope_digest: commandPayloadDigest(canonicalReviewedScope(scope)) });
const provenance = (value) => ({ confirmation_contract_version: 2, scope_review: review(value.scope) });
const reviewed = (args) => ({ ...args, confirmationContractVersion: 2, scopeReview: review(args.submission.scope) });
function example(description, areas = ["Bedroom"], level = "STANDARD", scale = "1 room", title = "General Apartment Cleaning") {
  return { ...submission(), title, description, scope: { areas_items: areas, cleaning_level: level, approximate_scale: scale } };
}

const { cleaningClarification, publicReason, ISSUES } = require("../src/v2/cleaningClarification");

test("bounded public reason matrix with unchanged authoritative outcomes", async () => {
  for (const [value, expected] of [
    [example("Deep clean my bedroom", ["Bedroom"], "DEEP"), null],
    [example("Deep clean my bedroom"), "cleaning_level_conflict"],
    [example("Clean my bedroom", ["Kitchen"]), "area_conflict"],
    [example("Clean my bedroom", ["Bedroom"], "STANDARD", "2 rooms"), "scale_conflict"],
    [example("Clean my bedroom only", ["Bedroom", "Bathroom"], "STANDARD", "2 rooms"), "exclusive_scope_conflict"],
    [example("Clean my whole apartment"), "whole_scope_unresolved"],
    [example("Clean mold off my bedroom wall"), "unclassified_scope"],
    [example("Clean my bedroom and assemble my desk"), "additional_scope_unresolved"],
    [example("Clean my bedroom", ["Bedroom"], ""), "missing_cleaning_level"]
  ]) {
    const s = setup(); const command = reviewed(s.args(value)); const receipt = await confirmJobDraft(command);
    if (expected) {
      assert.equal(receipt.text_reconciliation_state, "UNRESOLVED");
      assert.ok(receipt.clarification.issues.some((issue) => issue.code === expected), expected);
      assert.equal(receipt.clarification.version, 1);
    } else {
      assert.equal(receipt.text_reconciliation_state, clear); assert.equal(receipt.clarification, undefined);
      assert.equal(Object.keys(receipt).length, 6);
    }
    await s.read(receipt); assert.deepEqual(await confirmJobDraft(command), receipt);
  }
});

test("multiple issues have fixed recovery order, no raw strings and a safe fallback", async () => {
  const value = example("private unrecognized prose"); value.scope.areas_items = [];
  value.scope.cleaning_level = ""; value.scope.approximate_scale = ""; value.risk_facts.chemical_risk = "UNKNOWN";
  const s = setup(); const result = await confirmJobDraft(reviewed(s.args(value)));
  assert.deepEqual(result.clarification.issues.map((i) => i.code), ["safety_confirmation_required", "missing_area", "missing_cleaning_level", "missing_scale"]);
  assert.deepEqual(cleaningClarification(value, provenance(value)), result.clarification);
  for (const reason of ["secret arbitrary stack/parser/detail", "toString", "__proto__", "REVIEW_REQUIRED"])
    assert.equal(publicReason(reason), "unclassified_scope");
  assert.deepEqual(require("./fixtures/cleaning-clarification-v1.json"), { version: 1, issues: ISSUES });
  const serialized = JSON.stringify(result.clarification);
  for (const forbidden of [value.title, value.description, review(value.scope).scope_digest, "UNKNOWN", "regex", "stack", "address", "scope_digest"])
    assert.ok(!serialized.includes(forbidden));
  for (const issue of result.clarification.issues) assert.ok(ISSUES.some((allowed) => JSON.stringify(allowed) === JSON.stringify(issue)));
  const conflicting = example("Clean my kitchen", ["Bedroom"], "STANDARD", "1 room", "Deep clean my bedroom");
  assert.deepEqual(cleaningClarification(conflicting, provenance(conflicting)).issues.map((i) => i.code), ["cleaning_level_conflict", "area_conflict"]);
});

test("invalid review stays an error; stored clarification cannot be forged", async () => {
  const s = setup(); const value = example("Clean my whole apartment");
  await assert.rejects(confirmJobDraft({ ...reviewed(s.args(value)), scopeReview: { version: 1, scope_digest: "0".repeat(64) } }), /DRAFT_INPUT_INVALID/);
  assert.equal(s.records.size, 0);
  const receipt = await confirmJobDraft(reviewed(s.args(value)));
  const record = [...s.records.values()][0];
  record.clarification = { issues: record.clarification.issues.map(({code, field, action}) => ({action, field, code})), version: 1 };
  await s.read(receipt); // Firestore map-key ordering must not affect validation.
  record.clarification.issues[0].code = "arbitrary_private_string";
  await assert.rejects(s.read(receipt), /CONFIRMED_DRAFT_UNAVAILABLE/);
});

test("historical text-6 without clarification retries unchanged; explicit reconfirmation receives versioned issues", async () => {
  const s = setup(); const value = example("Clean my whole apartment"); const command = reviewed(s.args(value));
  const receipt = await confirmJobDraft(command); const record = [...s.records.values()][0]; delete record.clarification;
  const historical = structuredClone(record);
  const retry = await confirmJobDraft(command); assert.equal(retry.clarification, undefined);
  await s.read(retry); assert.deepEqual([...s.records.values()][0], historical);
  const next = await confirmJobDraft({ ...command, expectedVersion: 1 }); assert.equal(next.clarification.version, 1);
});
