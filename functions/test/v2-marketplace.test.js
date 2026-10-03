"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createMarketplaceCallable } = require("../src/v2/marketplace");
const { confirmJobDraft, readCurrentConfirmedCleaningDraft } = require("../src/v2/confirmedPostingDraft");
const { recordSafetyDecision } = require("../src/v2/standingSafetyAuthority");
const now = new Date("2026-10-02T12:00:00Z");
class HttpsError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }
async function setup() {
  const records = new Map();
  const collection = (path) => ({ path, doc: (id) => ({ id, path: `${path}/${id}`, collection: (name) => collection(`${path}/${id}/${name}`),
    get: async () => ({ exists: records.has(`${path}/${id}`), data: () => structuredClone(records.get(`${path}/${id}`)) }) }),
    orderBy: () => ({ path, limit: (limit) => ({ path, limit, startAfter: (after) => ({ path, limit, after }) }) }) });
  const db = { collection, runTransaction: async (work) => {
    const staged = new Map(records);
    const snapshot = (path) => ({ id: path.split("/").at(-1), exists: staged.has(path), data: () => structuredClone(staged.get(path)) });
    const result = await work({ get: async (ref) => ref.limit ? { docs: [...staged.keys()].filter((k) => k.startsWith(ref.path + "/") && k.split("/").length === ref.path.split("/").length + 1 && (!ref.after || k.split("/").at(-1) > ref.after)).sort().slice(0, ref.limit).map(snapshot) } : snapshot(ref.path),
      set: (ref, value) => staged.set(ref.path, structuredClone(value)),
      create: (ref, value) => { assert.ok(!staged.has(ref.path)); staged.set(ref.path, structuredClone(value)); } });
    records.clear(); for (const [k, v] of staged) records.set(k, v); return result;
  } };
  const auth = { getUser: async (uid) => ({ uid, disabled: false, email: "PRIVATE", phoneNumber: "PRIVATE", displayName: "PRIVATE" }) };
  await recordSafetyDecision({ db, operatorRef: "operator", subjectRef: "worker", state: "CLEAR", reasonCode: "reviewed",
    expectedVersion: 0, validUntil: new Date("2099-01-01"), authorizeSafetyOperator: async () => true, now });
  await recordSafetyDecision({ db, operatorRef: "operator", subjectRef: "poster", state: "CLEAR", reasonCode: "reviewed",
    expectedVersion: 0, validUntil: new Date("2099-01-01"), authorizeSafetyOperator: async () => true, now });
  const submission = { task_type_id: "general_cleaning", taxonomy_version: 2, title: "Clean bedroom",
    description: "Deep cleaning of bedroom.", additional_info: "", duration_minutes: 60,
    schedule_window: { start_at: "2099-10-02T14:00:00Z", end_at: "2099-10-02T15:00:00Z", time_zone: "America/New_York" },
    scope: { areas_items: ["bedroom"], cleaning_level: "DEEP", approximate_scale: "1 room" },
    risk_facts: Object.fromEntries(["medical_or_intimate_care", "hazardous_materials", "pest_control", "chemical_risk", "unknown_conditions"].map((k) => [k, "ABSENT_CONFIRMED"])),
    conflicting_facts: [], additional_task_type_ids: [], prohibited_scope_codes: [] };
  const receipt = await confirmJobDraft({ db, actorRef: "poster", intentKey: "synthetic-confirmation-key", expectedVersion: 0, taskSchemaVersion: 2, submission, now });
  const draft = await db.runTransaction((tx) => readCurrentConfirmedCleaningDraft(tx, db, receipt.draft_ref, "poster", receipt.draft_version));
  records.set("v2PublishedJobs/job", { record_type: "V2_ORDINARY_PUBLISHED_JOB", job_ref: "job", owner_ref: "poster", job_version: 1,
    job_lifecycle_state: "PUBLISHED_OPEN", discovery_visibility: "MARKETPLACE_OPEN", task_type_id: "general_cleaning", taxonomy_version: 2,
    title: "PRIVATE PROSE", description: "PRIVATE PROSE", schedule_window: submission.schedule_window,
    eligibility_geography: { borough_id: "nyc:borough:bronx" }, poster_offer: { pricing_mode: "FIXED", poster_entered_amount_minor: 5000, currency: "USD" },
    task_scope_policy_version: draft.policy_version, published_at: now.toISOString(), exact_address: "PRIVATE" });
  records.set("v2PublishedJobPrivate/job", { job_ref: "job", owner_ref: "poster", confirmed_posting_facts_ref: receipt.draft_ref,
    draft_version: receipt.draft_version, draft_digest: draft.content_digest, protected_fulfillment_location_ref: "PRIVATE" });
  const callable = createMarketplaceCallable({ db, auth, HttpsError, clock: () => now });
  const call = (data, uid = "worker") => callable(data, uid ? { auth: { uid } } : {});
  const command = { operation: "respond", job_ref: "job", job_version: 1, intent_key: "synthetic-response-key", message: "I am interested." };
  return { records, call, command, auth, db, draftReceipt: receipt };
}
const rejected = (promise, reason) => assert.rejects(promise, (e) => e.details.reason === reason);

test("eligible browse/detail expose only worker-safe structured projection", async () => {
  const { call } = await setup();
  const result = await call({ operation: "browse", cursor: null });
  assert.equal(result.jobs.length, 1); assert.equal(result.jobs[0].scope.cleaning_level, "DEEP");
  assert.equal(result.jobs[0].borough_id, "nyc:borough:bronx");
  const serialized = JSON.stringify(result);
  for (const forbidden of ["PRIVATE", "poster", "protected_fulfillment", "exact_address", "latitude", "worker_ref"]) assert.ok(!serialized.includes(forbidden));
  const detail = await call({ operation: "detail", job_ref: "job" });
  assert.deepEqual(detail.job, result.jobs[0]); assert.equal(detail.response, null);
});
test("unauthenticated reads and commands are rejected; spoofed identity is not accepted", async () => {
  const { call, command } = await setup();
  for (const data of [{ operation: "browse", cursor: null }, command]) await rejected(call(data, null), "authentication_required");
  await rejected(call({ ...command, worker_ref: "other" }), "invalid_request");
  await rejected(call({ ...command, owner_ref: "poster" }), "invalid_request");
});
test("successful response is versioned, audited, and visible only to poster and its worker", async () => {
  const { call, command, records } = await setup();
  const result = await call(command);
  assert.equal(result.response.status, "SUBMITTED"); assert.equal(result.response.created_at, now.toISOString());
  const row = [...records.values()].find((r) => r.response_ref);
  assert.equal(row.worker_ref, "worker"); assert.equal(row.decision.decision_type, "WORKER_INITIATED_REQUEST_ELIGIBILITY");
  const replies = await call({ operation: "responses", job_ref: "job", cursor: null }, "poster");
  assert.deepEqual(replies.responses, [result.response]); assert.ok(!JSON.stringify(replies).includes("PRIVATE"));
  assert.equal((await call({ operation: "detail", job_ref: "job" })).response.response_ref, result.response.response_ref);
  await rejected(call({ operation: "responses", job_ref: "job", cursor: null }, "other"), "not_permitted");
});
test("identical retries return original result; competing payloads cannot overwrite", async () => {
  const { call, command, records } = await setup();
  const first = await call(command); assert.deepEqual(await call(command), first);
  await rejected(call({ ...command, message: "Changed" }), "request_conflict");
  await rejected(call({ ...command, intent_key: "different-response-key" }), "already_responded");
  assert.equal([...records.values()].filter((r) => r.response_ref).length, 1);
  records.get("v2PublishedJobs/job").job_lifecycle_state = "CLOSED";
  assert.deepEqual(await call(command), first, "receipt replay does not recreate closed-job response");
});
test("self response, missing/closed/unsupported job and stale version are rejected", async () => {
  const { call, command, records } = await setup();
  await rejected(call(command, "poster"), "not_permitted");
  await rejected(call({ ...command, job_ref: "missing" }), "job_unavailable");
  await rejected(call({ ...command, job_version: 2 }), "job_changed");
  const job = records.get("v2PublishedJobs/job"); job.job_lifecycle_state = "CLOSED";
  await rejected(call(command), "job_unavailable"); job.job_lifecycle_state = "PUBLISHED_OPEN"; job.task_type_id = "unsupported";
  await rejected(call(command), "job_unavailable");
});
test("missing, expired, blocked, revoked or inconsistent safety fails closed", async () => {
  for (const mode of ["missing", "expired", "BLOCKED", "REVOKED", "audit"]) {
    const { call, command, records } = await setup();
    const current = records.get("v2Safety/worker"), audit = records.get("v2SafetyAudit/worker_1");
    if (mode === "missing") records.delete("v2Safety/worker");
    else if (mode === "expired") current.valid_until = audit.valid_until = new Date("2026-10-01");
    else if (mode === "audit") audit.version = 2;
    else current.state = audit.state = mode;
    await assert.rejects(call(command));
    assert.equal([...records.values()].filter((r) => r.response_ref).length, 0);
  }
});
test("disabled accounts cannot browse/respond and backend exceptions are sanitized", async () => {
  const { call, command, auth } = await setup();
  auth.getUser = async (uid) => ({ uid, disabled: true });
  await rejected(call(command), "account_unavailable");
  auth.getUser = async () => { throw new Error("PRIVATE provider detail"); };
  await assert.rejects(call({ operation: "browse", cursor: null }), (e) => e.details.reason === "temporarily_unavailable" && !e.message.includes("PRIVATE"));
});
test("poster list is owner-scoped and no exact/private data is projected", async () => {
  const { call } = await setup();
  assert.equal((await call({ operation: "posted", cursor: null }, "poster")).jobs.length, 1);
  assert.equal((await call({ operation: "posted", cursor: null }, "other")).jobs.length, 0);
});

test("poster safety revocation after publication blocks new discovery and response", async () => {
  for (const state of ["BLOCKED", "REVOKED"]) {
    const { call, command, records } = await setup();
    records.get("v2Safety/poster").state = records.get("v2SafetyAudit/poster_1").state = state;
    assert.deepEqual((await call({ operation: "browse", cursor: null })).jobs, []);
    await rejected(call(command), "not_permitted");
    assert.equal([...records.values()].filter((r) => r.response_ref).length, 0);
  }
});

test("bounded pagination can traverse an empty filtered page without hiding later jobs", async () => {
  const { call, records } = await setup();
  for (let n = 0; n < 20; n++) records.set(`v2PublishedJobs/a${String(n).padStart(3, "0")}`, { owner_ref: "worker" });
  const first = await call({ operation: "browse", cursor: null });
  assert.equal(first.jobs.length, 0); assert.equal(first.next_cursor, "a019");
  const next = await call({ operation: "browse", cursor: first.next_cursor });
  assert.equal(next.jobs.length, 1); assert.equal(next.next_cursor, null);
});

test("malformed command and incompatible confirmed evidence cannot create responses", async () => {
  const { call, command, records } = await setup();
  for (const bad of [{ ...command, message: "x".repeat(1001) }, { ...command, job_ref: "../private" },
    { ...command, job_version: 0 }, { ...command, created_at: now.toISOString() },
    { operation: "browse", cursor: "../private" }]) await rejected(call(bad), "invalid_request");
  records.get("v2PublishedJobPrivate/job").draft_digest = "changed";
  await rejected(call(command), "job_unavailable");
  assert.equal([...records.values()].filter((r) => r.response_ref).length, 0);
});

test("actual T01 producer output flows through discovery, response, and owner read without a second job schema", async () => {
  const { db, auth, records, call, draftReceipt: draft } = await setup();
  const { recordProtectedNYCAddress, PROVIDER_ID } = require("../src/v2/protectedLocationAuthority");
  const { publishGeneralCleaningJob, PUBLICATION_POLICY_VERSION } = require("../src/v2/publishOrdinaryJob");
  const { POLICY_VERSION } = require("../src/v2/taskScopePolicy");
  const { GEOGRAPHY_REGISTRY_VERSION } = require("../src/v2/publicationPrerequisites");
  records.delete("v2PublishedJobs/job"); records.delete("v2PublishedJobPrivate/job");
  const location = await recordProtectedNYCAddress({ db, authenticatedOwnerRef: "poster", intentKey: "actual-publication-location",
    address: { house_number: "123", street: "Example Street", zip_code: "10451" }, now,
    validator: { providerId: PROVIDER_ID, validateExactAddress: async (_, digest) => ({ provider_id: PROVIDER_ID,
      input_digest: digest, status: "EXACT_ADDRESS", dataset_version: "synthetic-1", provider_reference: "synthetic-location",
      matches: [{ geosupport_return_code: "00", input_match_confirmed: true, borough_code: "2" }] }) } });
  const command = { record_type: "ORDINARY_JOB_PUBLICATION_COMMAND", publication_idempotency_key: "actual-publication-intent",
    owner_ref: "poster", draft_ref: draft.draft_ref, draft_version: draft.draft_version,
    requested_discovery_visibility: "MARKETPLACE_OPEN", hire_again_relationship_ref: null,
    task_type_id: "general_cleaning", taxonomy_version: "2", confirmed_posting_facts_ref: draft.confirmed_posting_facts_ref,
    eligibility_geography: location.eligibility_geography, protected_fulfillment_location_ref: location.protected_ref,
    poster_offer: { pricing_mode: "FIXED", poster_entered_amount_minor: 5000, currency: "USD", pricing_policy_version: null, pricing_provenance: "POSTER_ENTERED" },
    policy_versions: { publication: PUBLICATION_POLICY_VERSION, task_scope: POLICY_VERSION, geography: GEOGRAPHY_REGISTRY_VERSION }, client_contract_version: 1 };
  const published = await publishGeneralCleaningJob({ db, auth, authContext: { uid: "poster" }, command,
    controls: { enabled: true, max_open_jobs: 2, max_daily_publications: 2 }, now });
  const result = await call({ operation: "browse", cursor: null });
  assert.equal(result.jobs.length, 1);
  const job = result.jobs[0]; const raw = records.get(`v2PublishedJobs/${published.job_ref}`);
  assert.equal(job.job_ref, published.job_ref); assert.equal(job.job_version, raw.job_version);
  assert.equal(raw.owner_ref, "poster"); assert.equal(raw.job_lifecycle_state, "PUBLISHED_OPEN");
  assert.deepEqual(job.schedule, raw.schedule_window); assert.equal(job.duration_minutes, raw.duration_minutes);
  assert.equal(job.borough_id, raw.eligibility_geography.borough_id);
  assert.equal(job.offer.amount_minor, raw.poster_offer.poster_entered_amount_minor);
  assert.equal(job.published_at, raw.published_at); assert.deepEqual(job.scope.areas_items, ["bedroom"]);
  const response = await call({ operation: "respond", job_ref: job.job_ref, job_version: job.job_version,
    intent_key: "actual-t01-response-intent", message: "Interested" });
  const received = await call({ operation: "responses", job_ref: job.job_ref, cursor: null }, "poster");
  assert.deepEqual(received.responses, [response.response]);
  assert.equal(raw.financial_state, "NOT_REQUIRED_YET");
});
