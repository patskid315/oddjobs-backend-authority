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

test("required reviewed-refinement matrix and deterministic bounded reasons", async () => {
  const rows = [
    [example("Deep clean my bedroom", ["Bedroom"], "DEEP"), "COMPATIBLE"],
    [example("Clean my bedroom"), "COMPATIBLE"],
    [example("Clean my bedroom", ["Bedroom"], "DEEP"), "COMPATIBLE"],
    [example("Clean my apartment", ["Bedroom", "Bathroom"], "STANDARD", "2 rooms"), "COMPATIBLE"],
    [example("Clean my apartment", ["Bedroom", "Bathroom", "Kitchen"], "STANDARD", "small apartment"), "COMPATIBLE"],
    [example("Deep clean my bedroom"), "EXPLICIT_CONTRADICTION"],
    [example("Clean my bedroom", ["Kitchen"]), "EXPRESSED_SCOPE_MISSING"],
    [example("Clean my bedroom", ["Bedroom", "Bathroom"], "STANDARD", "2 rooms"), "COMPATIBLE"],
    [example("Clean my bedroom only", ["Bedroom", "Bathroom"], "STANDARD", "2 rooms"), "EXCLUSIVITY_CONFLICT"],
    [example("Clean my bedroom only"), "COMPATIBLE"],
    [example("Clean my bedroom", ["Bedroom", "Bathroom"], "STANDARD", "small apartment"), "COMPATIBLE"],
    [example("Standard cleaning for my kitchen", ["Kitchen"], "STANDARD", "300 square feet"), "COMPATIBLE"],
    [example("Clean my whole apartment"), "EXTENT_COVERAGE_UNRESOLVED"],
    [example("Clean mold off my bedroom wall"), "UNCLASSIFIED_MATERIAL_CONTENT"],
    [example("Clean my bedroom and assemble my desk"), "UNCLASSIFIED_MATERIAL_CONTENT"],
    [example("Need some help tomorrow", ["Bedroom"], "STANDARD", "1 room", "Bedroom cleaning"), "COMPATIBLE"],
    [example("Some unknown task please"), "UNCLASSIFIED_MATERIAL_CONTENT"],
    [example("Standard cleaning for my kitchen", ["Kitchen"]), "COMPATIBLE"],
    [example("Clean my bedroom", ["Bedroom"], "STANDARD", "2 rooms"), "EXPLICIT_CONTRADICTION"],
    [example("Clean two bedrooms", ["Bedroom"], "STANDARD", "1 room"), "EXPLICIT_CONTRADICTION"],
    [example("Clean two bedrooms", ["Bedroom"], "STANDARD", "200 square feet"), "ROOM_QUANTITY_UNRESOLVED"]
  ];
  for (const [value, reason] of rows) {
    const original = structuredClone(value); const p = provenance(value);
    assert.equal(reconcileReviewedCleaning(value, p).reason, reason, value.description);
    assert.deepEqual(reconcileReviewedCleaning(value, p), reconcileReviewedCleaning(value, p));
    const s = setup(); const result = await confirmJobDraft(reviewed(s.args(value)));
    assert.equal(result.text_reconciliation_state, reason === "COMPATIBLE" ? clear : "UNRESOLVED", value.description);
    const record = [...s.records.values()][0]; assert.equal(record.text_rule_version, "cleaning-text-7");
    assert.equal(record.title, original.title); assert.equal(record.description, original.description);
    assert.equal(record.content_digest, commandPayloadDigest(original));
    assert.equal(record.text_digest, commandPayloadDigest({ title: original.title, description: original.description, additional_info: "" }));
    await s.read(result); assert.deepEqual(await confirmJobDraft(reviewed(s.args(value))), result);
  }
});

test("complete context, courtesy and exclusive evidence; unknown clauses in either field fail closed", () => {
  for (const context of ["Need some help tomorrow", "Thank you!", "Please.", "Thanks"]) {
    const value = example(context, ["bedroom"], "STANDARD", "1 room", "Bedroom cleaning");
    assert.equal(reconcileReviewedCleaning(value, provenance(value)).compatible, true);
  }
  for (const text of ["Need some help tomorrow and move a desk", "Thanks and spray for roaches", "Clean my bedroom only and bathroom",
    "Clean my bedroom except the floor", "Do not clean my bedroom", "Bedroom cleaning and medication",
    "Clean my bedroom!!", "Need some help whenever", "Clean my bedroom and remove mold"]) {
    for (const field of ["title", "description"]) {
      const value = { ...example("Clean my bedroom"), [field]: text };
      assert.equal(reconcileReviewedCleaning(value, provenance(value)).compatible, false, text);
    }
  }
  const noScope = example("Thanks", ["bedroom"], "STANDARD", "1 room", "Please");
  assert.equal(reconcileReviewedCleaning(noScope, provenance(noScope)).reason, "CLEANING_INTENT_UNRESOLVED");
  const conflict = example("Standard cleaning for my bedroom", ["bedroom"], "STANDARD", "1 room", "Deep clean my bedroom");
  assert.equal(reconcileReviewedCleaning(conflict, provenance(conflict)).reason, "EXPLICIT_CONTRADICTION");
});

test("legacy full templates still constrain supply and scale; facts and safety stay independently required", async () => {
  for (const [description, scope, expected] of [
    ["Deep cleaning of bedroom. Scope: 300 square feet.", { approximate_scale: "300 square feet" }, true],
    ["Deep cleaning of bedroom. Scope: two rooms.", {}, false],
    ["Deep cleaning of bedroom. Worker provides supplies.", { supplies_responsibility: "WORKER_PROVIDES" }, true],
    ["Deep cleaning of bedroom. Worker provides supplies.", { supplies_responsibility: "UNKNOWN" }, false]
  ]) {
    const value = example(description, ["bedroom"], "DEEP"); Object.assign(value.scope, scope);
    assert.equal(reconcileReviewedCleaning(value, provenance(value)).compatible, expected);
  }
  for (const key of Object.keys(submission().risk_facts)) {
    const value = example("Clean my bedroom"); value.risk_facts[key] = "UNKNOWN";
    const s = setup(); const result = await confirmJobDraft(reviewed(s.args(value)));
    assert.equal(result.policy_outcome, "ESCALATION_REQUIRED"); assert.equal(result.text_reconciliation_state, "UNRESOLVED");
  }
  for (const patch of [{ areas_items: [] }, { cleaning_level: "" }, { approximate_scale: "Bedroom" },
    { areas_items: ["Bedroom", "bedroom"] }, { condition_hazards: "UNKNOWN" }]) {
    const value = example("Clean my apartment"); Object.assign(value.scope, patch);
    assert.equal(reconcileReviewedCleaning(value, provenance(value)).compatible, false);
  }
});

test("only verified contract-v2 review can obtain text-6; no authority from proposals or arbitrary facts", async () => {
  const value = example("Clean my apartment");
  for (const p of [undefined, {}, { confirmation_contract_version: 2 },
    { confirmation_contract_version: 2, scope_review: { version: 1, scope_digest: "0".repeat(64) } }]) {
    assert.equal(reconcileReviewedCleaning(value, p).reason, "REVIEW_REQUIRED");
  }
  const s = setup(); const legacy = await confirmJobDraft(s.args(value));
  assert.equal(legacy.text_reconciliation_state, "UNRESOLVED");
  assert.equal([...s.records.values()][0].text_rule_version, "cleaning-text-5");
  for (const acknowledgment of [undefined, { version: 1, scope_digest: "0".repeat(64) }]) {
    await assert.rejects(confirmJobDraft({ ...s.args(value), confirmationContractVersion: 2, scopeReview: acknowledgment }), /DRAFT_INPUT_INVALID/);
  }
  const fresh = await confirmJobDraft(reviewed({ ...s.args(value), expectedVersion: 1 }));
  assert.equal(fresh.text_reconciliation_state, clear); assert.equal(fresh.draft_version, 2);
  assert.equal([...s.records.values()][0].text_rule_version, "cleaning-text-7");
});

test("historical revisions 2/3/4/5 and reviewed schema-4 text-5 remain stable on reads and exact retries", async () => {
  for (const validator of [cleaningV2, cleaningV2Text3, cleaningV2Text4, cleaningV2Text5]) {
    for (const description of ["Deep cleaning of bedroom.", "Clean my apartment"]) {
      const s = setup(); const value = submission(); value.description = description;
      const command = validator === cleaningV2Text5 ? reviewed(s.args(value)) : s.args(value);
      const receipt = await confirmJobDraft(command); const record = [...s.records.values()][0];
      record.text_rule_version = validator.textRuleVersion;
      delete record.clarification; // historical fixture predates clarification receipts
      record.text_reconciliation_state = validator.reconciledText(value) ? clear : "UNRESOLVED";
      const snapshot = structuredClone(record);
      assert.equal((await s.read(receipt)).text_reconciliation_state, snapshot.text_reconciliation_state);
      assert.equal((await confirmJobDraft(command)).text_reconciliation_state, snapshot.text_reconciliation_state);
      assert.deepEqual([...s.records.values()][0], snapshot);
      const next = await confirmJobDraft(reviewed({ ...s.args(value), expectedVersion: 1 }));
      assert.equal(next.text_reconciliation_state, clear);
      assert.equal([...s.records.values()][0].text_rule_version, "cleaning-text-7");
    }
  }
});

test("unknown revisions, forged legacy text-6, and unsupported task types fail closed", async () => {
  const s = setup(); const value = example("Clean my apartment"); const receipt = await confirmJobDraft(s.args(value));
  const record = [...s.records.values()][0];
  for (const revision of ["cleaning-text-99", "cleaning-text-6"]) {
    record.text_rule_version = revision; record.text_reconciliation_state = clear;
    await assert.rejects(s.read(receipt), /CONFIRMED_DRAFT_UNAVAILABLE/);
  }
  value.task_type_id = "unsupported_task";
  await assert.rejects(confirmJobDraft(reviewed(s.args(value))), /DRAFT_INPUT_INVALID/);
});

test("text-7 resolves bounded room ambiguity only through explicitly reviewed scope", async () => {
  const { cleaningV2Text7 } = require("../src/v2/generalCleaningReconciliationV6");
  const { cleaningClarification } = require("../src/v2/cleaningClarification");
  for (const description of ["Just need someone to deep clean my room", "Deep clean my room only", "Clean my room"]) {
    for (const area of ["bedroom", "bathroom", "kitchen"]) {
      const value = example(description, [area], "DEEP", "1 room", "General cleaning");
      const s = setup(); const command = reviewed(s.args(value));
      const receipt = await confirmJobDraft(command);
      assert.equal(receipt.text_reconciliation_state, clear);
      const record = [...s.records.values()][0];
      assert.equal(record.text_rule_version, "cleaning-text-7");
      assert.equal(record.description, description);
      assert.equal(record.content_digest, commandPayloadDigest(value));
      assert.deepEqual(record.scope_review, review(value.scope));
      await s.read(receipt); assert.deepEqual(await confirmJobDraft(command), receipt);
      assert.equal(cleaningV2Text7.reconciledText(value), false);
    }
  }
  for (const [description, areas, level, scale] of [
    ["Deep clean my room only", ["bedroom", "bathroom"], "DEEP", "2 rooms"],
    ["Deep clean my room", ["bedroom"], "STANDARD", "1 room"],
    ["Deep clean my room", ["bedroom"], "DEEP", "2 rooms"],
    ["Deep clean my room", ["floors"], "DEEP", "1 room"],
    ["Deep clean my room and fix my sink", ["bedroom"], "DEEP", "1 room"],
    ["Deep clean my room and remove mold", ["bedroom"], "DEEP", "1 room"]]) {
    const value = example(description, areas, level, scale); const s = setup();
    assert.equal((await confirmJobDraft(reviewed(s.args(value)))).text_reconciliation_state, "UNRESOLVED");
  }
  const value = example("Just need someone to deep clean my room", [], "DEEP", "1 room");
  assert.deepEqual(cleaningClarification(value, provenance(value), "cleaning-text-7").issues,
    [{ code: "missing_area", field: "areas", action: "select_areas" }]);
  value.scope.areas_items = ["bedroom"]; value.risk_facts.hazardous_materials = "UNKNOWN";
  const s = setup(); assert.equal((await confirmJobDraft(reviewed(s.args(value)))).text_reconciliation_state, "UNRESOLVED");
});

test("historical text-6 generic room rejection, clarification and exact retry do not silently upgrade", async () => {
  const { cleaningClarification } = require("../src/v2/cleaningClarification");
  const value = example("Just need someone to deep clean my room", ["bedroom"], "DEEP", "1 room");
  assert.equal(reconcileReviewedCleaning(value, provenance(value)).reason, "UNCLASSIFIED_MATERIAL_CONTENT");
  const s = setup(); const command = reviewed(s.args(value)); const receipt = await confirmJobDraft(command);
  const record = [...s.records.values()][0];
  record.text_rule_version = "cleaning-text-6"; record.text_reconciliation_state = "UNRESOLVED";
  record.clarification = cleaningClarification(value, provenance(value));
  assert.deepEqual(record.clarification.issues, [{ code: "unclassified_scope", field: "scope", action: "review_job_description" }]);
  const snapshot = structuredClone(record);
  assert.equal((await s.read(receipt)).text_reconciliation_state, "UNRESOLVED");
  assert.equal((await confirmJobDraft(command)).text_reconciliation_state, "UNRESOLVED");
  assert.deepEqual([...s.records.values()][0], snapshot);
  const reconfirmed = await confirmJobDraft({ ...command, expectedVersion: 1 });
  assert.equal(reconfirmed.text_reconciliation_state, clear);
  assert.equal([...s.records.values()][0].text_rule_version, "cleaning-text-7");
});
