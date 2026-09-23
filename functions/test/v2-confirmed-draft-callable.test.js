"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createConfirmedDraftCallable } = require("../src/v2/confirmedDraftCallable");
const { POLICY_VERSION } = require("../src/v2/taskScopePolicy");
class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const context = { auth: { uid: "poster-1" } };
const request = () => ({ intent_key: "cleaning-draft-intent-1", expected_version: 0,
  submission: cleaningSubmission() });
// Sequential unit store exercises the real authority, not Firestore concurrency.
function setup() {
  const records = new Map();
  const db = {
    collection: (name) => ({ doc: (id) => ({ key: `${name}/${id}` }) }),
    runTransaction: async (work) => work({
      get: async (ref) => ({ exists: records.has(ref.key), data: () => records.get(ref.key) }),
      set: (ref, data) => records.set(ref.key, data)
    })
  };
  return { records, handler: createConfirmedDraftCallable({ db, HttpsError }) };
}
const code = (expected) => (error) => error.code === expected;

function cleaningSubmission() {
  return { task_type_id: "general_cleaning", taxonomy_version: 2,
    title: "Clean kitchen and bathroom",
    description: "Standard cleaning of kitchen and bathroom. Poster provides supplies.",
    additional_info: "",
    duration_minutes: 120, schedule_window: { start_at: "2099-09-24T13:00:00Z",
      end_at: "2099-09-24T15:00:00Z", time_zone: "America/New_York" },
    scope: { areas_items: ["kitchen", "bathroom"], cleaning_level: "STANDARD",
      approximate_scale: "two rooms", room_count: 2,
      supplies_responsibility: "POSTER_PROVIDES", condition_hazards: "NONE_CONFIRMED" },
    risk_facts: { medical_or_intimate_care: "ABSENT_CONFIRMED",
      hazardous_materials: "ABSENT_CONFIRMED", pest_control: "ABSENT_CONFIRMED",
      chemical_risk: "ABSENT_CONFIRMED", unknown_conditions: "ABSENT_CONFIRMED" },
    conflicting_facts: [], additional_task_type_ids: [], prohibited_scope_codes: [] };
}


test("authentication is required before any draft authority call", async () => {
  let calls = 0;
  const handler = createConfirmedDraftCallable({ db: {}, HttpsError,
    confirm: async () => { calls++; } });
  for (const auth of [undefined, {}, { auth: {} }, { auth: { uid: "" } }]) {
    await assert.rejects(handler(request(), auth), code("unauthenticated"));
  }
  assert.equal(calls, 0);
});

test("verified UID and server time are forwarded; minimum authority receipt is returned", async () => {
  let received;
  const result = { draft_ref: "draft", confirmed_posting_facts_ref: "draft",
    draft_version: 1, policy_outcome: "SUPPORTED", policy_version: POLICY_VERSION,
    text_reconciliation_state: "CLEARED_EXACT_TEMPLATE_V1" };
  const handler = createConfirmedDraftCallable({ db: {}, HttpsError,
    confirm: async (args) => { received = args; return result; } });
  const body = request();
  assert.deepEqual(await handler(body, context), result);
  assert.equal(received.actorRef, context.auth.uid);
  assert.equal(received.intentKey, body.intent_key);
  assert.equal(received.expectedVersion, 0);
  assert.equal(received.submission, body.submission);
  assert.ok(received.now instanceof Date);
});

test("request envelope rejects ownership, authority overrides and invalid intent/version", async () => {
  let calls = 0;
  const handler = createConfirmedDraftCallable({ db: {}, HttpsError,
    confirm: async () => { calls++; } });
  for (const body of [null, [], {}, ...["owner_ref", "actorRef", "draft_ref", "policy_outcome",
    "policy_version", "now", "backend_authoritative"].map((key) => ({ ...request(), [key]: "forged" })),
    { ...request(), intent_key: "short" }, { ...request(), intent_key: " xxxxxxxxxxxxxxxx" },
    { ...request(), intent_key: "x".repeat(201) },
    ...[-1, 0.5, "0", Number.MAX_SAFE_INTEGER + 1].map((v) => ({ ...request(), expected_version: v }))]) {
    await assert.rejects(handler(body, context), code("invalid-argument"));
  }
  assert.equal(calls, 0);
});

test("real authority binds drafts to owner and preserves replay and version semantics", async () => {
  const { handler, records } = setup();
  const body = request();
  const first = await handler(body, context);
  assert.deepEqual(Object.keys(first).sort(), ["draft_ref", "confirmed_posting_facts_ref",
    "draft_version", "policy_outcome", "policy_version", "text_reconciliation_state"].sort());
  assert.equal(first.draft_version, 1);
  assert.equal(first.confirmed_posting_facts_ref, first.draft_ref);
  assert.equal(first.text_reconciliation_state, "CLEARED_EXACT_TEMPLATE_V1");
  assert.deepEqual(await handler(body, context), first);
  assert.equal(records.size, 1);
  const other = await handler(body, { auth: { uid: "poster-2" } });
  assert.notEqual(other.draft_ref, first.draft_ref);
  assert.equal(records.get(`v2PostingDrafts/${first.draft_ref}`).owner_ref, "poster-1");
  assert.equal(records.get(`v2PostingDrafts/${other.draft_ref}`).owner_ref, "poster-2");
  const changed = request(); changed.submission.title = "Needs clarification";
  await assert.rejects(handler(changed, context), code("failed-precondition"));
  const updated = await handler({ ...changed, expected_version: 1 }, context);
  assert.equal(updated.draft_version, 2);
  assert.equal(updated.text_reconciliation_state, "UNRESOLVED");
  assert.deepEqual(await handler({ ...changed, expected_version: 1 }, context), updated);
  assert.ok([...records.keys()].every((key) => key.startsWith("v2PostingDrafts/")));
});

test("only existing cleaning fact shape is accepted; client policy claims cannot be persisted", async () => {
  const { handler, records } = setup();
  for (const mutate of [
    (s) => { s.task_type_id = "mount_tv"; },
    (s) => { s.taxonomy_version = "2"; },
    (s) => { s.policy_outcome = "SUPPORTED"; },
    (s) => { s.confirmation = { source: "BACKEND" }; },
    (s) => { s.scope.extra = true; },
    (s) => { delete s.risk_facts; },
    (s) => { s.duration_minutes = 1; }
  ]) {
    const body = request(); mutate(body.submission);
    await assert.rejects(handler(body, context), code("invalid-argument"));
  }
  assert.equal(records.size, 0);
  const body = request(); body.submission.risk_facts.unknown_conditions = "UNKNOWN";
  const result = await handler(body, context);
  assert.equal(result.text_reconciliation_state, "UNRESOLVED");
  assert.equal(result.policy_outcome, [...records.values()][0].policy_outcome);
  assert.equal(result.policy_version, POLICY_VERSION);
});

test("expired schedules fail without writes and errors never expose internal facts", async () => {
  const { handler, records } = setup();
  const body = request();
  body.submission.schedule_window.start_at = "2000-01-01T13:00:00Z";
  body.submission.schedule_window.end_at = "2000-01-01T15:00:00Z";
  await assert.rejects(handler(body, context), code("failed-precondition"));
  assert.equal(records.size, 0);
  for (const message of ["DRAFT_VERSION_CONFLICT", "PRIVATE_DATABASE_DETAILS", "CONFIRMED_DRAFT_UNAVAILABLE"]) {
    const failing = createConfirmedDraftCallable({ db: {}, HttpsError,
      confirm: async () => { throw new Error(message); } });
    await assert.rejects(failing(request(), context), (error) =>
      error.code === "failed-precondition" && !error.message.includes(message) &&
      !error.message.includes("saved"));
  }
});
