"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const admin = require("firebase-admin");
const { initializeTestEnvironment, assertFails } = require("@firebase/rules-unit-testing");
const { createMarketplaceCallable } = require("../src/v2/marketplace");
const { confirmJobDraft, readCurrentConfirmedCleaningDraft } = require("../src/v2/confirmedPostingDraft");
const { recordSafetyDecision } = require("../src/v2/standingSafetyAuthority");
const now = new Date("2026-10-02T12:00:00Z");
class HttpsError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }
let env, app, db, call, choices;
test.before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-oddjobs-selection", firestore: {
    host: "127.0.0.1", port: 8080, rules: fs.readFileSync("../firestore.rules", "utf8") } });
  app = admin.initializeApp({ projectId: "demo-oddjobs-selection" }, "selection-test"); db = app.firestore();
});
test.after(async () => { await env?.cleanup(); await app?.delete(); });
test.beforeEach(async () => {
  await env.clearFirestore();
  const auth = { getUser: async (uid) => ({ uid, disabled: false }) };
  for (const subjectRef of ["poster", "worker", "other-worker"]) await recordSafetyDecision({ db, operatorRef: "operator",
    subjectRef, state: "CLEAR", reasonCode: "reviewed", expectedVersion: 0, validUntil: new Date("2099-01-01"),
    authorizeSafetyOperator: async () => true, now });
  const submission = { task_type_id: "general_cleaning", taxonomy_version: 2, title: "Clean bedroom",
    description: "Deep cleaning of bedroom.", additional_info: "", duration_minutes: 60,
    schedule_window: { start_at: "2099-10-02T14:00:00Z", end_at: "2099-10-02T15:00:00Z", time_zone: "America/New_York" },
    scope: { areas_items: ["bedroom"], cleaning_level: "DEEP", approximate_scale: "1 room" },
    risk_facts: Object.fromEntries(["medical_or_intimate_care", "hazardous_materials", "pest_control", "chemical_risk", "unknown_conditions"].map((k) => [k, "ABSENT_CONFIRMED"])),
    conflicting_facts: [], additional_task_type_ids: [], prohibited_scope_codes: [] };
  const receipt = await confirmJobDraft({ db, actorRef: "poster", intentKey: "synthetic-confirmation-key", expectedVersion: 0, taskSchemaVersion: 2, submission, now });
  const draft = await db.runTransaction((tx) => readCurrentConfirmedCleaningDraft(tx, db, receipt.draft_ref, "poster", receipt.draft_version));
  await db.doc("v2PublishedJobs/job").set( { record_type: "V2_ORDINARY_PUBLISHED_JOB", job_ref: "job", owner_ref: "poster", job_version: 1,
    job_lifecycle_state: "PUBLISHED_OPEN", job_lifecycle_version: 2, financial_state: "NOT_REQUIRED_YET", financial_state_version: 2, discovery_visibility: "MARKETPLACE_OPEN", task_type_id: "general_cleaning", taxonomy_version: 2,
    title: "PRIVATE PROSE", description: "PRIVATE PROSE", schedule_window: submission.schedule_window,
    eligibility_geography: { borough_id: "nyc:borough:bronx" }, poster_offer: { pricing_mode: "FIXED", poster_entered_amount_minor: 5000, currency: "USD" },
    task_scope_policy_version: draft.policy_version, published_at: now.toISOString(), exact_address: "PRIVATE" });
  await db.doc("v2PublishedJobPrivate/job").set( { job_ref: "job", owner_ref: "poster", confirmed_posting_facts_ref: receipt.draft_ref,
    draft_version: receipt.draft_version, draft_digest: draft.content_digest, protected_fulfillment_location_ref: "PRIVATE" });
  const handler = createMarketplaceCallable({ db, auth, HttpsError, clock: () => now });
  call = (command, uid = "poster") => handler(command, { auth: { uid } });
  choices = [];
  for (const worker of ["worker", "other-worker"]) {
    const result = await call({ operation: "respond", job_ref: "job", job_version: 1, intent_key: `response-key-${worker}`, message: "Interested" }, worker);
    choices.push({ operation: "select", job_ref: "job", job_version: 1, response_ref: result.response.response_ref, intent_key: `selection-key-${worker}` });
  }
});
test("two simultaneous identical selection requests create exactly one authoritative selection", async () => {
  const results = await Promise.all([call(choices[0]), call(choices[0])]);
  assert.deepEqual(results[0], results[1]);
  assert.equal((await db.collection("v2ProvisionalSelections").get()).size, 1);
  assert.equal((await db.doc("v2PublishedJobs/job").get()).data().job_version, 2);
  assert.equal((await call({ operation: "responses", job_ref: "job", cursor: null })).selection.response_ref, choices[0].response_ref);
});
test("simultaneous conflicting responses cannot both become selected", async () => {
  const results = await Promise.allSettled(choices.map((c) => call(c)));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.details.reason, "already_selected");
  const winner = results.find((r) => r.status === "fulfilled").value.selection;
  const reloaded = await call({ operation: "responses", job_ref: "job", cursor: null });
  assert.equal(reloaded.selection.response_ref, winner.response_ref); assert.equal(reloaded.responses.length, 2);
});
test("clients cannot forge or read private selection records directly", async () => {
  await call(choices[0]);
  for (const uid of ["poster", "worker"]) {
    const ref = env.authenticatedContext(uid).firestore().doc("v2ProvisionalSelections/job");
    await assertFails(ref.get()); await assertFails(ref.set({ worker_ref: uid })); await assertFails(ref.delete());
  }
});

async function hourlyCommands() {
  await db.doc("v2PublishedJobs/job").update({ "poster_offer.pricing_mode": "HOURLY" });
  await call(choices[0]);
  return { propose: { operation: "propose_scope", job_ref: "job", job_version: 2, expected_scope_version: 0,
    maximum_billable_minutes: 90, intent_key: "hourly-proposal-command" },
    accept: { operation: "accept_scope", job_ref: "job", job_version: 2, expected_scope_version: 1, intent_key: "hourly-accept-command" } };
}
test("concurrent proposal and acceptance retries create one bilateral hourly agreement", async () => {
  const { propose, accept } = await hourlyCommands();
  const proposals = await Promise.all([call(propose), call(propose)]);
  assert.deepEqual(proposals[0], proposals[1]);
  const accepted = await Promise.all([call(accept, "worker"), call(accept, "worker")]);
  assert.deepEqual(accepted[0], accepted[1]);
  assert.equal((await db.collection("v2HourlyScopes").get()).size, 1);
  assert.equal((await db.collection("v2HourlyScopes/job/commands").get()).size, 2);
  assert.equal((await call({ operation: "detail", job_ref: "job" }, "worker")).job.funding_scope_ready, true);
  for (const uid of ["poster", "worker"]) {
    const client = env.authenticatedContext(uid).firestore();
    for (const path of ["v2HourlyScopes/job", "v2HourlyScopes/job/history/1", "v2HourlyScopes/job/commands/forged"]) {
      await assertFails(client.doc(path).get()); await assertFails(client.doc(path).set({ state: "AGREED" }));
    }
  }
});
test("concurrent different proposals and acceptance versus supersession have a single serialized winner", async () => {
  const { propose, accept } = await hourlyCommands();
  const attempts = [propose, { ...propose, maximum_billable_minutes: 120, intent_key: "different-proposal-key" }];
  const results = await Promise.allSettled(attempts.map(c => call(c)));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.find(r => r.status === "rejected").reason.details.reason, "stale_scope");
  const revise = { ...propose, expected_scope_version: 1, maximum_billable_minutes: 150, intent_key: "superseding-proposal-key" };
  const race = await Promise.allSettled([call(accept, "worker"), call(revise)]);
  assert.equal(race.filter(r => r.status === "fulfilled").length, 1);
  const current = (await db.doc("v2HourlyScopes/job").get()).data();
  assert.ok((current.version === 1 && current.state === "AGREED") || (current.version === 2 && current.state === "PROPOSED"));
});
