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

test("generic dispatch records schema, validator, text, policy and poster provenance", async () => {
  const { args, records, read, db } = setup();
  const result = await confirmJobDraft(args());
  assert.equal(result.text_reconciliation_state, clear);
  assert.equal(result.confirmed_posting_facts_ref, result.draft_ref);
  const record = [...records.values()][0];
  assert.equal(record.schema_version, 3);
  assert.equal(record.taxonomy_version, 2);
  assert.equal(record.task_type_id, "general_cleaning");
  assert.equal(record.task_validator_version, "general-cleaning-2");
  assert.equal(record.text_rule_version, "cleaning-text-2");
  assert.equal(record.policy_version, POLICY_VERSION);
  assert.deepEqual(record.confirmed_facts.confirmation, { source: "POSTER_CONFIRMED",
    confirmed_at: now.toISOString(), fact_schema_version: 2 });
  assert.deepEqual(record.confirmed_facts.scope, submission().scope);
  assert.equal((await read(result)).title, "Clean bedroom");
  const publicationInput = await db.runTransaction((tx) =>
    readCurrentConfirmedCleaningDraft(tx, db, result.draft_ref, "poster-1", 1));
  assert.equal(publicationInput.text_reconciliation_state, clear);
  assert.equal(publicationInput.policy_outcome, "SUPPORTED_ADVISORY");
  assert.ok([...records.keys()].every((key) => key.startsWith("v2PostingDrafts/")));
});

test("varied areas, levels, scales and optional room/supply fields clear without fixture assumptions", async () => {
  const variants = [
    {},
    { title: "General Cleaning", description: "Deep cleaning of bedroom. Scope: 300 square feet.",
      scope: { areas_items: ["bedroom"], cleaning_level: "DEEP", approximate_scale: "300 square feet", room_count: null, supplies_responsibility: "UNKNOWN" } },
    { title: "Standard cleaning of living room and hallway", description: "Standard cleaning of living room and hallway. Worker provides supplies.",
      scope: { areas_items: ["living room", "hallway"], cleaning_level: "STANDARD", approximate_scale: "small apartment", room_count: 3, supplies_responsibility: "WORKER_PROVIDES" } }
  ];
  for (const variant of variants) {
    const { args } = setup();
    assert.equal((await confirmJobDraft(args({ ...submission(), ...variant }))).text_reconciliation_state, clear);
  }
});

test("missing required keys reject; empty/unknown required values never clear", async () => {
  for (const key of ["areas_items", "cleaning_level", "approximate_scale"]) {
    const { args, records } = setup(); const value = submission(); delete value.scope[key];
    await assert.rejects(confirmJobDraft(args(value)), /DRAFT_INPUT_INVALID/);
    assert.equal(records.size, 0);
  }
  for (const patch of [{ areas_items: [] }, { cleaning_level: "UNKNOWN" }, { approximate_scale: "" }]) {
    const { args } = setup(); const value = submission(); Object.assign(value.scope, patch);
    const result = await confirmJobDraft(args(value));
    assert.equal(result.policy_outcome, "ESCALATION_REQUIRED");
    assert.equal(result.text_reconciliation_state, "UNRESOLVED");
  }
});

test("all supplied safety uncertainty and explicit prohibited/mixed/conflicting scope fail closed", async () => {
  for (const risk of Object.keys(submission().risk_facts)) {
    for (const state of ["UNKNOWN", "PRESENT_CONFIRMED", ""]) {
      const { args } = setup(); const value = submission(); value.risk_facts[risk] = state;
      const result = await confirmJobDraft(args(value));
      assert.notEqual(result.policy_outcome, "SUPPORTED_ADVISORY");
      assert.equal(result.text_reconciliation_state, "UNRESOLVED");
    }
  }
  for (const patch of [{ conflicting_facts: ["different scope"] }, { additional_task_type_ids: ["move_items"] },
    { prohibited_scope_codes: ["HAZARDOUS_MATERIALS"] }, { prohibited_scope_codes: ["CHILD_CARE"] },
    { scope: { ...submission().scope, condition_hazards: "UNKNOWN" } }]) {
    const { args } = setup(); const result = await confirmJobDraft(args({ ...submission(), ...patch }));
    assert.notEqual(result.policy_outcome, "SUPPORTED_ADVISORY");
    assert.equal(result.text_reconciliation_state, "UNRESOLVED");
    if (patch.prohibited_scope_codes) assert.equal(result.policy_outcome, "UNSUPPORTED_WITHHOLD");
  }
});

test("unmatched text and conflicts cannot bypass structured facts, including interpolated scope attacks", async () => {
  const variants = [
    { title: "Clean bathroom" }, { description: "Standard cleaning of bedroom." },
    { additional_info: "Also remove asbestos" }, { description: "Deep cleaning of bedroom. Also babysit." },
    { description: "Deep cleaning of bedroom. Poster provides supplies." },
    { scope: { ...submission().scope, room_count: 2 } },
    { scope: { ...submission().scope, areas_items: ["kitchen", "bathroom"] },
      title: "Clean kitchen and bathroom", description: "Deep cleaning of kitchen and bathroom." },
    { scope: { ...submission().scope, supplies_responsibility: "WORKER_PROVIDES" },
      description: "Deep cleaning of bedroom. Poster provides supplies." },
    { scope: { ...submission().scope, approximate_scale: "one room plus medical care" } },
    { scope: { ...submission().scope, areas_items: ["bedroom and remove asbestos"] },
      title: "Clean bedroom and remove asbestos", description: "Deep cleaning of bedroom and remove asbestos." },
    { title: "Clean bedroom\n", description: "Deep cleaning of bedroom.\n" },
    { title: "Clean medical equipment", description: "Deep cleaning of medical equipment.",
      scope: { ...submission().scope, areas_items: ["medical equipment"] } }
  ];
  for (const patch of variants) {
    const { args, read } = setup();
    const result = await confirmJobDraft(args({ ...submission(), ...patch }));
    assert.equal(result.text_reconciliation_state, "UNRESOLVED");
    assert.equal((await read(result)).text_reconciliation_state, "UNRESOLVED");
  }
});

test("unsupported task/schema/taxonomy and client authority claims reject without writes", async () => {
  const { args, records } = setup();
  for (const task of ["mount_tv", "research_study", "home_organizing", "House chores", "__proto__", "unknown"]) {
    await assert.rejects(confirmJobDraft(args({ ...submission(), task_type_id: task })), /DRAFT_INPUT_INVALID/);
  }
  for (const version of [undefined, 1, 3, "2"]) {
    await assert.rejects(confirmJobDraft({ ...args(), taskSchemaVersion: version }), /DRAFT_INPUT_INVALID/);
  }
  for (const patch of [{ taxonomy_version: 1 }, { policy_outcome: "SUPPORTED_ADVISORY" },
    { confirmation: { source: "POSTER_CONFIRMED" } }, { task_validator_version: "general-cleaning-2" }]) {
    await assert.rejects(confirmJobDraft(args({ ...submission(), ...patch })), /DRAFT_INPUT_INVALID/);
  }
  assert.equal(records.size, 0);
});

test("owner-scoped replay, uncertain response recovery, revisions and conflicts preserve identity", async () => {
  const { args, records, read } = setup();
  const first = await confirmJobDraft(args()); // response may have been lost
  assert.deepEqual(await confirmJobDraft({ ...args(), now: new Date("2100-01-01T00:00:00Z") }), first);
  assert.equal(records.size, 1);
  const changed = submission(); changed.title = "General Cleaning";
  await assert.rejects(confirmJobDraft(args(changed)), /DRAFT_VERSION_CONFLICT/);
  const second = await confirmJobDraft({ ...args(changed), expectedVersion: 1 });
  assert.equal(second.draft_ref, first.draft_ref); assert.equal(second.draft_version, 2);
  assert.deepEqual(await confirmJobDraft({ ...args(changed), expectedVersion: 1 }), second);
  await assert.rejects(read(first), /CONFIRMED_DRAFT_UNAVAILABLE/);
  await assert.rejects(read(second, "poster-2"), /CONFIRMED_DRAFT_UNAVAILABLE/);
  const other = await confirmJobDraft({ ...args(), actorRef: "poster-2" });
  assert.notEqual(other.draft_ref, first.draft_ref);
});

test("tampered versions, provenance, digests and derived decisions block reads and replay", async () => {
  for (const patch of [{ task_validator_version: "forged" }, { text_rule_version: "forged" },
    { schema_version: 99 }, { policy_version: "forged" }, { request_digest: "forged" },
    { content_digest: "forged" }, { policy_outcome: "UNSUPPORTED_WITHHOLD" },
    { text_reconciliation_state: "UNRESOLVED" }]) {
    const { args, records, read } = setup(); const first = await confirmJobDraft(args());
    Object.assign([...records.values()][0], patch);
    await assert.rejects(read(first), /CONFIRMED_DRAFT_UNAVAILABLE/);
    await assert.rejects(confirmJobDraft(args()), /CONFIRMED_DRAFT_UNAVAILABLE|DRAFT_VERSION_CONFLICT/);
  }
});

test("old callable delegates to same authority with unchanged envelope and receipt", async () => {
  const { db, records } = setup();
  const generic = createJobDraftCallable({ db, HttpsError });
  const legacy = createConfirmedDraftCallable({ db, HttpsError });
  const body = request(); const { task_schema_version, ...oldBody } = body;
  const first = await legacy(oldBody, ctx);
  assert.deepEqual(await generic(body, ctx), first);
  assert.deepEqual(Object.keys(first).sort(), ["draft_ref", "confirmed_posting_facts_ref", "draft_version",
    "policy_outcome", "policy_version", "text_reconciliation_state"].sort());
  assert.equal(records.size, 1);
  assert.equal([...records.values()][0].task_validator_version, "general-cleaning-2");
  assert.equal(first.policy_version, "OJNY-V2-GOV-1.0.0/task-scope-1");
});

test("generic callable requires authenticated owner and exact versioned request", async () => {
  const { db, records } = setup(); const handler = createJobDraftCallable({ db, HttpsError });
  await assert.rejects(handler(request(), {}), (e) => e.code === "unauthenticated");
  for (const body of [{ ...request(), owner_ref: "poster-2" }, { ...request(), expected_version: Number.MAX_SAFE_INTEGER },
    { ...request(), task_schema_version: 1 }, { ...request(), task_schema_version: "2" },
    { intent_key: "confirmed-job-intent-1", expected_version: 0, submission: submission() }]) {
    await assert.rejects(handler(body, ctx), (e) => e.code === "invalid-argument");
  }
  assert.equal(records.size, 0);
});

test("pre-refactor schema-2 drafts replay and read without migration or broadened text clearance", async () => {
  const { args, records, read } = setup();
  const content = submission();
  content.scope = { areas_items: ["kitchen", "bathroom"], cleaning_level: "STANDARD", approximate_scale: "two rooms",
    room_count: 2, supplies_responsibility: "POSTER_PROVIDES", condition_hazards: "NONE_CONFIRMED" };
  content.title = "Clean kitchen and bathroom";
  content.description = "Standard cleaning of kitchen and bathroom. Poster provides supplies.";
  const first = await confirmGeneralCleaningDraft(args(content));
  const record = [...records.values()][0];
  record.schema_version = 2; record.confirmed_facts.confirmation.fact_schema_version = 1;
  delete record.task_validator_version; delete record.text_rule_version; delete record.request_digest;
  const before = structuredClone(record);
  assert.equal(record.content_digest, commandPayloadDigest(content));
  assert.deepEqual(await confirmGeneralCleaningDraft(args(content)), first);
  assert.equal((await read(first)).text_reconciliation_state, clear);
  assert.deepEqual([...records.values()][0], before);
  const changed = { ...content, title: "General Cleaning" };
  const updated = await confirmGeneralCleaningDraft({ ...args(changed), expectedVersion: 1 });
  assert.equal(updated.draft_version, 2);
  assert.equal([...records.values()][0].schema_version, 3);
});

test("legacy records cannot gain broader clearance merely by being read or retried", async () => {
  const { args, records, read } = setup();
  const content = submission();
  Object.assign(content.scope, { room_count: 1, supplies_responsibility: "POSTER_PROVIDES", condition_hazards: "NONE_CONFIRMED" });
  const first = await confirmJobDraft(args(content));
  const record = [...records.values()][0];
  record.schema_version = 2; record.confirmed_facts.confirmation.fact_schema_version = 1;
  delete record.task_validator_version; delete record.text_rule_version; delete record.request_digest;
  await assert.rejects(read(first), /CONFIRMED_DRAFT_UNAVAILABLE/); // V1 never cleared this text
  record.text_reconciliation_state = "UNRESOLVED";
  const replay = await confirmGeneralCleaningDraft(args(content));
  assert.equal(replay.text_reconciliation_state, "UNRESOLVED");
  assert.equal((await read(first)).text_reconciliation_state, "UNRESOLVED");
  assert.equal([...records.values()][0].schema_version, 2);
});
