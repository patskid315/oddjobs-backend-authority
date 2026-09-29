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
  assert.equal(record.text_rule_version, "cleaning-text-5");
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


test("current text revision preserves approved whole phrases independently in title and description", async () => {
  const phrases = ["General Apartment cleaning", "Apartment cleaning", "Need my apartment cleaned",
    "General cleaning", "Looking for someone to clean my kitchen and bathroom"];
  for (const phrase of phrases) {
    for (const field of ["title", "description"]) {
      const s = setup();
      const value = { ...submission(), title: "General Cleaning", description: "Standard cleaning of kitchen and bathroom.",
        scope: { areas_items: ["kitchen", "bathroom"], cleaning_level: "STANDARD", approximate_scale: "two rooms" },
        [field]: phrase };
      const original = structuredClone(value);
      const receipt = await confirmJobDraft(s.args(value));
      assert.equal(receipt.text_reconciliation_state, clear);
      const record = [...s.records.values()][0];
      assert.equal(record.text_rule_version, "cleaning-text-5");
      assert.equal(record.confirmed_facts.confirmation.fact_schema_version, 2);
      assert.equal(record.title, original.title); assert.equal(record.description, original.description);
      assert.equal(record.content_digest, commandPayloadDigest(original));
      assert.equal(record.text_digest, commandPayloadDigest({ title: original.title,
        description: original.description, additional_info: original.additional_info }));
      await s.read(receipt);
    }
  }
});

test("limited normalization and exact area sets; no clauses or unknown prose", async () => {
  const accepted = ["GENERAL   APARTMENT cleaning!", "Apartment cleaning?", "General cleaning.",
    "Looking for someone to clean my bathroom and kitchen", "General cleaning\n"];
  const rejected = ["Clean my apartment and remove black mold", "Clean the bathroom and spray for roaches",
    "General cleaning and help administer medication", "Apartment cleaning and babysitting",
    "Apartment cleaning. Also do laundry.", "Need my apartment cleaned except the kitchen",
    "Make everything nice", "General cleaning!!", "Looking for someone to clean my kitchen",
    "Looking for someone to clean my kitchen and bathroom and bedroom",
    "Looking for someone to clean my kitchen and kitchen", "Not general cleaning"];
  for (const text of [...accepted, ...rejected]) {
    for (const field of ["title", "description"]) {
      const s = setup(); const value = { ...submission(), title: "General cleaning", description: "Apartment cleaning",
        scope: { areas_items: ["kitchen", "bathroom"], cleaning_level: "STANDARD", approximate_scale: "two rooms" },
        [field]: text };
      const receipt = await confirmJobDraft(s.args(value));
      assert.equal(receipt.text_reconciliation_state, accepted.includes(text) ? clear : "UNRESOLVED", text);
    }
  }
});

test("generic text cannot replace structured facts, safety or explicit confirmation", async () => {
  for (const patch of [{ areas_items: [] }, { cleaning_level: "" }, { approximate_scale: "" }]) {
    const s = setup(); const value = submission();
    value.title = value.description = "General cleaning"; Object.assign(value.scope, patch);
    assert.equal((await confirmJobDraft(s.args(value))).text_reconciliation_state, "UNRESOLVED");
  }
  const s = setup(); const value = submission(); value.title = value.description = "General cleaning";
  value.risk_facts.chemical_risk = "UNKNOWN";
  assert.equal((await confirmJobDraft(s.args(value))).text_reconciliation_state, "UNRESOLVED");
  const fresh = setup(); const receipt = await confirmJobDraft(fresh.args());
  const record = [...fresh.records.values()][0]; record.confirmed_facts.confirmation.source = "CLIENT_INFERRED";
  await assert.rejects(fresh.read(receipt), /CONFIRMED_DRAFT_UNAVAILABLE/);
});

test("historical unresolved results replay unchanged; explicit reconfirmation uses new rule", async () => {
  const s = setup(); const value = submission(); value.title = value.description = "General Apartment cleaning";
  const current = await confirmJobDraft(s.args(value));
  const record = [...s.records.values()][0];
  // Schema-3/fact-schema-2 historical fixture with its original text-rule result.
  const { cleaningV2 } = require("../src/v2/generalCleaningValidator");
  assert.equal(cleaningV2.reconciledText(value), false);
  record.text_rule_version = "cleaning-text-2"; record.text_reconciliation_state = "UNRESOLVED";
  const snapshot = structuredClone(record);
  assert.equal((await s.read(current)).text_reconciliation_state, "UNRESOLVED");
  const retry = await confirmJobDraft(s.args(value));
  assert.equal(retry.draft_ref, current.draft_ref); assert.equal(retry.draft_version, 1);
  assert.equal(retry.text_reconciliation_state, "UNRESOLVED");
  assert.deepEqual([...s.records.values()][0], snapshot);
  const reconfirm = await confirmJobDraft({ ...s.args(value), expectedVersion: 1 });
  assert.equal(reconfirm.draft_ref, current.draft_ref); assert.equal(reconfirm.draft_version, 2);
  assert.equal(reconfirm.text_reconciliation_state, clear);
  assert.equal([...s.records.values()][0].text_rule_version, "cleaning-text-5");
  assert.deepEqual(await confirmJobDraft({ ...s.args(value), expectedVersion: 1 }), reconfirm);
});

test("historical cleared templates remain readable; unknown rule revisions fail closed", async () => {
  const s = setup(); const receipt = await confirmJobDraft(s.args());
  const record = [...s.records.values()][0]; record.text_rule_version = "cleaning-text-2";
  assert.equal((await s.read(receipt)).text_reconciliation_state, clear);
  for (const revision of ["cleaning-text-99", "cleaning-text-1", null, undefined]) {
    record.text_rule_version = revision;
    await assert.rejects(s.read(receipt), /CONFIRMED_DRAFT_UNAVAILABLE/);
    await assert.rejects(confirmJobDraft(s.args()), /CONFIRMED_DRAFT_UNAVAILABLE/);
  }
});

test("text revision 4 consumes bounded compositions independently in title and description", async () => {
  const accepted = ["I need cleaning", "I just need some cleaning for my apartment.",
    "I just need some deep cleaning for my apartment.", "I need deep cleaning for my home.",
    "Looking for someone to clean my bedroom", "Clean the bedroom", "Deep clean my bedroom",
    "Looking for someone to deep clean the bedroom", "I need general cleaning",
    " I JUST need\tsome deep cleaning for my apartment! "];
  const rejected = ["I need standard cleaning for my apartment", "Looking for someone to clean my bathroom",
    "Clean the bedroom and bathroom", "I need deep cleaning and mold removal",
    "Deep clean and spray for roaches", "Clean the bedroom and administer medication",
    "General cleaning and moving furniture", "General cleaning whenever you can",
    "I do not need deep cleaning", "I need cleaning please", "Please I need cleaning",
    "I need some thorough cleaning", "Clean the bedroom and bedroom", "Clean my apartment",
    "I need cleaning. Also do laundry.", "I need cleaning!!",
    "Deep cleaning of bedroom. Scope: two rooms.",
    "Deep cleaning of bedroom. Worker provides supplies."];
  for (const text of [...accepted, ...rejected]) {
    for (const field of ["title", "description"]) {
      const s = setup(); const value = { ...submission(), [field]: text };
      const original = structuredClone(value);
      const result = await confirmJobDraft(s.args(value));
      assert.equal(result.text_reconciliation_state, accepted.includes(text) ? clear : "UNRESOLVED", `${field}: ${text}`);
      const record = [...s.records.values()][0];
      assert.equal(record.text_rule_version, "cleaning-text-5");
      assert.equal(record.title, original.title); assert.equal(record.description, original.description);
      assert.equal(record.content_digest, commandPayloadDigest(original));
      assert.equal(record.text_digest, commandPayloadDigest({ title: original.title,
        description: original.description, additional_info: original.additional_info }));
      await s.read(result);
    }
  }
});

test("compositions cannot replace structured facts or override level, supply and scale", async () => {
  for (const patch of [{ areas_items: [] }, { cleaning_level: "" }, { approximate_scale: "" },
    { approximate_scale: "Bedroom" }, { condition_hazards: "UNKNOWN" }]) {
    const s = setup(); const value = submission(); value.description = "I need cleaning";
    Object.assign(value.scope, patch);
    assert.equal((await confirmJobDraft(s.args(value))).text_reconciliation_state, "UNRESOLVED");
  }
  for (const key of Object.keys(submission().risk_facts)) {
    const s = setup(); const value = submission(); value.description = "I need cleaning";
    value.risk_facts[key] = "UNKNOWN";
    assert.equal((await confirmJobDraft(s.args(value))).text_reconciliation_state, "UNRESOLVED");
  }
  for (const [description, scope, expected] of [
    ["I need standard cleaning", { cleaning_level: "STANDARD" }, clear],
    ["Deep clean my bedroom", { cleaning_level: "STANDARD" }, "UNRESOLVED"],
    ["Deep cleaning of bedroom. Scope: one room.", {}, clear],
    ["Deep cleaning of bedroom. Scope: two rooms.", {}, "UNRESOLVED"],
    ["Deep cleaning of bedroom. Worker provides supplies.", { supplies_responsibility: "WORKER_PROVIDES" }, clear],
    ["Deep cleaning of bedroom. Worker provides supplies.", { supplies_responsibility: "POSTER_PROVIDES" }, "UNRESOLVED"],
    ["Deep cleaning of bedroom. Worker provides supplies.", { supplies_responsibility: "UNKNOWN" }, "UNRESOLVED"]
  ]) {
    const s = setup(); const value = submission(); value.title = "General cleaning";
    value.description = description; Object.assign(value.scope, scope);
    assert.equal((await confirmJobDraft(s.args(value))).text_reconciliation_state, expected);
  }
});

test("historical text-2 and text-3 keep their interpretation and retry result until reconfirmation", async () => {
  const { cleaningV2, cleaningV2Text3 } = require("../src/v2/generalCleaningValidator");
  for (const validator of [cleaningV2, cleaningV2Text3]) {
    for (const description of ["Deep cleaning of bedroom.", "General Apartment cleaning", "I need cleaning"]) {
      const s = setup(); const value = submission(); value.description = description;
      const current = await confirmJobDraft(s.args(value)); const record = [...s.records.values()][0];
      record.text_rule_version = validator.textRuleVersion;
      record.text_reconciliation_state = validator.reconciledText(value) ? clear : "UNRESOLVED";
      const historical = structuredClone(record);
      assert.equal((await s.read(current)).text_reconciliation_state, historical.text_reconciliation_state);
      const retry = await confirmJobDraft(s.args(value));
      assert.equal(retry.draft_ref, current.draft_ref); assert.equal(retry.draft_version, 1);
      assert.equal(retry.text_reconciliation_state, historical.text_reconciliation_state);
      assert.deepEqual([...s.records.values()][0], historical);
      const fresh = await confirmJobDraft({ ...s.args(value), expectedVersion: 1 });
      assert.equal(fresh.draft_ref, current.draft_ref); assert.equal(fresh.draft_version, 2);
      assert.equal(fresh.text_reconciliation_state, clear);
      assert.equal([...s.records.values()][0].text_rule_version, "cleaning-text-5");
      assert.deepEqual(await confirmJobDraft({ ...s.args(value), expectedVersion: 1 }), fresh);
    }
  }
});

test("text-5 canonicalizes area comparison copies without changing original facts or digests", async () => {
  for (const areas of [["bedroom"], ["Bedroom"], ["bEdRoOm"], [" \tBedroom\n "]]) {
    for (const description of ["I just need some deep cleaning for my apartment.",
      "Looking for someone to clean my bedroom", "Deep cleaning of bedroom."]) {
      const s = setup(); const value = submission(); value.scope.areas_items = areas;
      value.title = "General Apartment Cleaning"; value.description = description;
      const original = structuredClone(value);
      const result = await confirmJobDraft(s.args(value));
      assert.equal(result.text_reconciliation_state, clear);
      const record = [...s.records.values()][0];
      assert.deepEqual(record.confirmed_facts.scope, original.scope);
      assert.equal(record.title, original.title); assert.equal(record.description, original.description);
      assert.equal(record.content_digest, commandPayloadDigest(original));
      assert.equal(record.text_digest, commandPayloadDigest({ title: original.title,
        description: original.description, additional_info: original.additional_info }));
      await s.read(result);
    }
  }
});

test("canonical identities reject duplicates and unknown areas and preserve room counting", async () => {
  for (const [areas, scale, roomCount, expected] of [
    [["Bedroom", "bedroom"], "two rooms", null, "UNRESOLVED"],
    [["Bedroom", " BEDROOM "], "two rooms", null, "UNRESOLVED"],
    [["Bedroom office thing"], "one room", null, "UNRESOLVED"],
    [["Bed room"], "one room", null, "UNRESOLVED"],
    [["Bedroom", "Bathroom"], "one room", null, "UNRESOLVED"],
    [["Bedroom", "Bathroom"], "two rooms", 1, "UNRESOLVED"],
    [["Bedroom", "Floors", "Counters"], "one room", 1, clear],
    [["Bedroom", "Bathroom"], "two rooms", 2, clear]
  ]) {
    const s = setup(); const value = submission(); value.title = value.description = "General cleaning";
    Object.assign(value.scope, { areas_items: areas, approximate_scale: scale, room_count: roomCount });
    assert.equal((await confirmJobDraft(s.args(value))).text_reconciliation_state, expected);
  }
  const s = setup(); const value = submission(); value.scope.areas_items = ["Bathroom", "Bedroom"];
  value.scope.approximate_scale = "two rooms"; value.title = "General cleaning";
  value.description = "Clean the bedroom and bathroom";
  assert.equal((await confirmJobDraft(s.args(value))).text_reconciliation_state, clear);
});

test("text-4 capitalization remains unresolved on historical read/retry until explicit text-5 reconfirmation", async () => {
  const { cleaningV2Text4 } = require("../src/v2/generalCleaningValidator");
  for (const area of ["Bedroom", "bedroom", " Bedroom "]) {
    const s = setup(); const value = submission(); value.scope.areas_items = [area];
    value.title = "General Apartment Cleaning";
    value.description = "I just need some deep cleaning for my apartment.";
    assert.equal(cleaningV2Text4.reconciledText(value), area === "bedroom");
    const first = await confirmJobDraft(s.args(value)); const record = [...s.records.values()][0];
    record.text_rule_version = "cleaning-text-4";
    record.text_reconciliation_state = area === "bedroom" ? clear : "UNRESOLVED";
    const snapshot = structuredClone(record);
    assert.equal((await s.read(first)).text_reconciliation_state, snapshot.text_reconciliation_state);
    const retry = await confirmJobDraft(s.args(value));
    assert.equal(retry.draft_version, 1); assert.equal(retry.draft_ref, first.draft_ref);
    assert.equal(retry.text_reconciliation_state, snapshot.text_reconciliation_state);
    assert.deepEqual([...s.records.values()][0], snapshot);
    const next = await confirmJobDraft({ ...s.args(value), expectedVersion: 1 });
    assert.equal(next.draft_version, 2); assert.equal(next.text_reconciliation_state, clear);
    assert.equal([...s.records.values()][0].text_rule_version, "cleaning-text-5");
  }
});
