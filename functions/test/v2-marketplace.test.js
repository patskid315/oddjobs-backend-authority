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
    job_lifecycle_state: "PUBLISHED_OPEN", job_lifecycle_version: 2, financial_state: "NOT_REQUIRED_YET", financial_state_version: 2, discovery_visibility: "MARKETPLACE_OPEN", task_type_id: "general_cleaning", taxonomy_version: 2,
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
    poster_offer: { pricing_mode: "HOURLY", poster_entered_amount_minor: 5000, currency: "USD", pricing_policy_version: null, pricing_provenance: "POSTER_ENTERED" },
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
  const selection = await call({ operation: "select", job_ref: job.job_ref, job_version: job.job_version,
    response_ref: response.response.response_ref, intent_key: "actual-t01-selection-intent" }, "poster");
  const selectedRead = await call({ operation: "responses", job_ref: job.job_ref, cursor: null }, "poster");
  assert.deepEqual(selectedRead.selection, selection.selection);
  assert.equal(raw.financial_state, "NOT_REQUIRED_YET");
  const proposed = await call({ operation: "propose_scope", job_ref: job.job_ref, job_version: selection.selection.job_version,
    expected_scope_version: 0, maximum_billable_minutes: 90, intent_key: "actual-hourly-proposal" }, "poster");
  const agreed = await call({ operation: "accept_scope", job_ref: job.job_ref, job_version: selection.selection.job_version,
    expected_scope_version: proposed.hourly_scope.proposal_version, intent_key: "actual-hourly-acceptance" });
  assert.equal(agreed.hourly_scope.state, "AGREED");
  const fundedScope = (await call({ operation: "detail", job_ref: job.job_ref }, "poster")).job;
  assert.equal(fundedScope.funding_scope_ready, true);
  assert.equal(fundedScope.hourly_scope.selection_ref, selection.selection.selection_ref);
  assert.equal(fundedScope.hourly_scope.hourly_rate_minor_per_hour, 5000);
  assert.equal(records.get(`v2PublishedJobs/${job.job_ref}`).financial_state, "FUNDING_REQUIRED");

});

function photoBucket() {
  const objects = new Map(); let generation = 100;
  return { objects, file(path, options = {}) {
    const value = () => {
      const object = objects.get(path);
      if (!object || (options.generation && options.generation !== object.generation)) throw Object.assign(new Error("missing"), { code: 404 });
      return object;
    };
    return {
      exists: async () => [objects.has(path)],
      getMetadata: async () => { const v = value(); return [{ generation: v.generation, size: v.bytes.length, contentType: v.type }]; },
      download: async () => [Buffer.from(value().bytes)],
      save: async (bytes, config) => {
        assert.equal(config.preconditionOpts.ifGenerationMatch, 0);
        if (objects.has(path)) throw Object.assign(new Error("exists"), { code: 412 });
        objects.set(path, { bytes: Buffer.from(bytes), generation: String(++generation), type: config.metadata.contentType });
      },
      getSignedUrl: async (config) => { value(); assert.equal(config.version, "v4"); return [`https://storage.googleapis.com/synthetic/${path}?synthetic=only`]; }
    };
  } };
}
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
async function photoSetup() {
  const environment = await setup();
  const authority = require("../src/v2/jobPhotoAuthority");
  const bucket = photoBucket();
  bucket.objects.set("job_post_drafts/poster/photo-flow/photo_0.jpg", { bytes: jpeg, generation: "42", type: "image/jpeg" });
  const storage = authority.storageAdapter(bucket);
  const request = { schema_version: 1, draft_ref: environment.draftReceipt.draft_ref,
    draft_version: environment.draftReceipt.draft_version, flow_id: "photo-flow", photos: [{ index: 0, generation: "42" }] };
  const finalize = (r = request, owner = "poster") => authority.finalizePhotos({ db: environment.db, storage, owner, request: r, now });
  return { ...environment, authority, bucket, storage, request, finalize };
}

test("job media finalization freezes owner bytes; draft overwrite/delete and exact retry cannot change identity", async () => {
  const f = await photoSetup(); const media = await f.finalize(); const ref = media.refs[0];
  assert.equal(media.schema_version, 1); assert.match(ref, /^[a-f0-9]{64}$/);
  const path = `v2PublishedJobMedia/${ref}.jpg`;
  f.bucket.objects.get("job_post_drafts/poster/photo-flow/photo_0.jpg").bytes = Buffer.from("changed");
  f.bucket.objects.delete("job_post_drafts/poster/photo-flow/photo_0.jpg");
  assert.deepEqual(await f.finalize(), media);
  assert.deepEqual(f.bucket.objects.get(path).bytes, jpeg);
  assert.equal(f.records.get(`v2JobMedia/${ref}`).state, "FINALIZED");
});
test("foreign owners, external URLs, arbitrary paths, unsupported metadata, stale generations and excess photos fail closed", async () => {
  const f = await photoSetup();
  await assert.rejects(f.finalize(f.request, "worker"));
  for (const change of [{ source: "https://example.invalid/image.jpg" }, { path: "job_post_drafts/other/x/photo_0.jpg" },
    { flow_id: "../other" }, { photos: [{ index: 0, generation: "999" }] },
    { photos: [0, 1, 2, 3].map((index) => ({ index, generation: "42" })) }]) await assert.rejects(f.finalize({ ...f.request, ...change }));
  f.bucket.objects.get("job_post_drafts/poster/photo-flow/photo_0.jpg").type = "image/png";
  await assert.rejects(f.finalize());
  f.bucket.objects.get("job_post_drafts/poster/photo-flow/photo_0.jpg").type = "image/jpeg";
  f.bucket.objects.get("job_post_drafts/poster/photo-flow/photo_0.jpg").bytes = Buffer.from("not a JPEG");
  await assert.rejects(f.finalize());
});
test("media callable authentication and forged owner are rejected with generic errors", async () => {
  const f = await photoSetup(); const handler = f.authority.createFinalizePhotosCallable({ ...f, HttpsError });
  await assert.rejects(handler(f.request, {}), (e) => e.code === "unauthenticated");
  await assert.rejects(handler({ ...f.request, owner_ref: "poster" }, { auth: { uid: "worker" } }), (e) => e.code === "failed-precondition");
  assert.deepEqual(await handler(f.request, { auth: { uid: "poster" } }), await f.finalize());
});
test("media references reject malformed, unknown, duplicate, foreign, reused, and wrong-draft identities", async () => {
  const f = await photoSetup(); const media = await f.finalize();
  const read = (m, owner = "poster", draft = f.request.draft_ref) => f.db.runTransaction((tx) => f.authority.readPublicationPhotos(tx, f.db, m, owner, draft));
  for (const value of [{ schema_version: 2, refs: [] }, { schema_version: 1, refs: ["https://example.invalid"] },
    { schema_version: 1, refs: ["a".repeat(64)] }, { ...media, refs: [media.refs[0], media.refs[0]] },
    { schema_version: 1, refs: ["a", "b", "c", "d"].map((s) => s.repeat(64)) }]) await assert.rejects(read(value));
  await assert.rejects(read(media, "worker")); await assert.rejects(read(media, "poster", "different-draft"));
  assert.equal((await read(media)).length, 1); assert.deepEqual(await read(undefined), []);
  f.records.get(`v2JobMedia/${media.refs[0]}`).state = "PUBLISHED";
  await assert.rejects(read(media));
});
test("photo finalization → protected location → T01 publication → browse/detail/posted carries only safe media and immutable retry", async () => {
  const f = await photoSetup(); const { db, auth, records, draftReceipt: draft } = f;
  const media = await f.finalize();
  const { recordProtectedNYCAddress, PROVIDER_ID } = require("../src/v2/protectedLocationAuthority");
  const { publishGeneralCleaningJob, PUBLICATION_POLICY_VERSION } = require("../src/v2/publishOrdinaryJob");
  const { POLICY_VERSION } = require("../src/v2/taskScopePolicy");
  const { GEOGRAPHY_REGISTRY_VERSION } = require("../src/v2/publicationPrerequisites");
  records.delete("v2PublishedJobs/job"); records.delete("v2PublishedJobPrivate/job");
  const location = await recordProtectedNYCAddress({ db, authenticatedOwnerRef: "poster", intentKey: "photo-location-intent",
    address: { house_number: "123", street: "Example Street", zip_code: "10451" }, now,
    validator: { providerId: PROVIDER_ID, validateExactAddress: async (_, digest) => ({ provider_id: PROVIDER_ID,
      input_digest: digest, status: "EXACT_ADDRESS", dataset_version: "synthetic-1", provider_reference: "synthetic-location",
      matches: [{ geosupport_return_code: "00", input_match_confirmed: true, borough_code: "2" }] }) } });
  const command = { record_type: "ORDINARY_JOB_PUBLICATION_COMMAND", publication_idempotency_key: "photo-publication-intent",
    owner_ref: "poster", draft_ref: draft.draft_ref, draft_version: draft.draft_version,
    requested_discovery_visibility: "MARKETPLACE_OPEN", hire_again_relationship_ref: null,
    task_type_id: "general_cleaning", taxonomy_version: "2", confirmed_posting_facts_ref: draft.confirmed_posting_facts_ref,
    eligibility_geography: location.eligibility_geography, protected_fulfillment_location_ref: location.protected_ref,
    poster_offer: { pricing_mode: "FIXED", poster_entered_amount_minor: 5000, currency: "USD", pricing_policy_version: null, pricing_provenance: "POSTER_ENTERED" },
    policy_versions: { publication: PUBLICATION_POLICY_VERSION, task_scope: POLICY_VERSION, geography: GEOGRAPHY_REGISTRY_VERSION }, client_contract_version: 1, media };
  const args = { db, auth, authContext: { uid: "poster" }, command, controls: { enabled: true, max_open_jobs: 2, max_daily_publications: 2 }, now };
  const receipt = await publishGeneralCleaningJob(args);
  assert.deepEqual(await publishGeneralCleaningJob(args), receipt);
  assert.deepEqual(records.get(`v2PublishedJobs/${receipt.job_ref}`).media, media);
  assert.equal(records.get(`v2JobMedia/${media.refs[0]}`).job_ref, receipt.job_ref);
  const handler = createMarketplaceCallable({ db, auth, storage: f.storage, HttpsError, clock: () => now });
  for (const [input, uid] of [[{ operation: "browse", cursor: null }, "worker"], [{ operation: "detail", job_ref: receipt.job_ref }, "worker"], [{ operation: "posted", cursor: null }, "poster"], [{ operation: "detail", job_ref: receipt.job_ref }, "poster"]]) {
    const result = await handler(input, { auth: { uid } }); const job = result.job || result.jobs[0];
    assert.equal(job.media.photos[0].media_ref, media.refs[0]);
    assert.deepEqual(Object.keys(job.media.photos[0]).sort(), ["expires_at", "media_ref", "url"]);
    for (const forbidden of ["PRIVATE", "owner_ref", "draft_ref", "flow_id", "source_generation", "job_post_drafts", "protected_fulfillment", "Example Street"]) assert.ok(!JSON.stringify(result).includes(forbidden));
  }
  const noSigning = createMarketplaceCallable({ db, auth, storage: { presentation: async () => { throw new Error("signer down"); } }, HttpsError, clock: () => now });
  const response = await noSigning({ operation: "respond", job_ref: receipt.job_ref, job_version: 1,
    intent_key: "photo-worker-response", message: "Interested" }, { auth: { uid: "worker" } });
  assert.equal(response.response.status, "SUBMITTED");
  assert.equal(f.bucket.objects.size, 2);
});

async function selectionSetup() {
  const f = await setup();
  const response = (await f.call(f.command)).response;
  return { ...f, select: { operation: "select", job_ref: "job", job_version: 1,
    response_ref: response.response_ref, intent_key: "synthetic-selection-key" } };
}
test("poster selection is provisional, idempotent, private, reloadable, and closes worker discovery", async () => {
  const f = await selectionSetup();
  const result = await f.call(f.select, "poster");
  assert.deepEqual(await f.call(f.select, "poster"), result);
  assert.equal(result.selection.job_lifecycle_state, "SELECTION_PENDING_FUNDING");
  assert.equal(result.selection.financial_state, "FUNDING_REQUIRED");
  assert.equal(result.selection.assignment_created, false); assert.equal(result.selection.job_version, 2);
  assert.equal(f.records.get("v2ProvisionalSelections/job").worker_ref, "worker");
  assert.equal(f.records.get("v2PublishedJobs/job").job_version, 2);
  assert.equal((await f.call({ operation: "browse", cursor: null })).jobs.length, 0);
  const posted = await f.call({ operation: "posted", cursor: null }, "poster");
  assert.deepEqual(posted.jobs[0].selection, result.selection);
  const read = await f.call({ operation: "responses", job_ref: "job", cursor: null }, "poster");
  assert.deepEqual(read.selection, result.selection); assert.equal(read.selected_response.response_ref, f.select.response_ref);
  assert.equal(read.responses.length, 1);
  assert.deepEqual((await f.call({ operation: "detail", job_ref: "job" }, "poster")).job.selection, result.selection);
  for (const key of ["worker_ref", "poster_ref", "standing_provenance", "command_digest"]) assert.ok(!JSON.stringify(read).includes(key));
  assert.equal([...f.records.keys()].filter((k) => k.startsWith("v2ProvisionalSelections/")).length, 1);
  assert.ok(![...f.records.values()].some((v) => v.record_type === "ORDINARY_JOB_FUNDING_ATTEMPT" || v.record_type === "ORDINARY_JOB_ASSIGNMENT_RECEIPT"));
});
test("selection rejects forged identities, nonowner, wrong job, nonexistent response, stale version and changed command", async () => {
  const f = await selectionSetup();
  await rejected(f.call(f.select, null), "authentication_required");
  await rejected(f.call(f.select, "worker"), "not_permitted");
  await rejected(f.call(f.select, "other"), "not_permitted");
  for (const extra of [{ worker_ref: "worker" }, { owner_ref: "poster" }]) await rejected(f.call({ ...f.select, ...extra }, "poster"), "invalid_request");
  await rejected(f.call({ ...f.select, job_ref: "missing" }, "poster"), "job_unavailable");
  await rejected(f.call({ ...f.select, job_version: 2 }, "poster"), "job_changed");
  await rejected(f.call({ ...f.select, response_ref: "missing" }, "poster"), "response_unavailable");
  const response = f.records.get(`v2PublishedJobs/job/responses/${f.select.response_ref}`);
  for (const patch of [{ job_ref: "another-job" }, { worker_ref: "poster" }, { job_version: 2 }, { status: "WITHDRAWN" }, { decision: { outcome: "INELIGIBLE" } }]) {
    f.records.set(`v2PublishedJobs/job/responses/${f.select.response_ref}`, { ...response, ...patch });
    await rejected(f.call(f.select, "poster"), "response_unavailable");
  }
  f.records.set(`v2PublishedJobs/job/responses/${f.select.response_ref}`, response);
  await f.call(f.select, "poster");
  await rejected(f.call({ ...f.select, response_ref: "different" }, "poster"), "request_conflict");
  await rejected(f.call({ ...f.select, intent_key: "different-selection-key" }, "poster"), "already_selected");
});
test("current safety and expired job block new selection without modifying responses", async () => {
  const f = await selectionSetup();
  f.records.get("v2Safety/worker").state = "BLOCKED";
  await assert.rejects(f.call(f.select, "poster"));
  assert.equal(f.records.has("v2ProvisionalSelections/job"), false);
  f.records.get("v2Safety/worker").state = "CLEAR";
  f.records.get("v2PublishedJobs/job").schedule_window.end_at = "2020-01-01T00:00:00Z";
  await rejected(f.call(f.select, "poster"), "job_unavailable");
  assert.equal(f.records.get(`v2PublishedJobs/job/responses/${f.select.response_ref}`).status, "SUBMITTED");
});

async function hourlySetup() {
  const f = await setup(); f.records.get("v2PublishedJobs/job").poster_offer.pricing_mode = "HOURLY";
  const response = (await f.call(f.command)).response;
  await f.call({ operation: "select", job_ref: "job", job_version: 1, response_ref: response.response_ref, intent_key: "hourly-select-command" }, "poster");
  return { ...f, propose: { operation: "propose_scope", job_ref: "job", job_version: 2,
    expected_scope_version: 0, maximum_billable_minutes: 90, intent_key: "hourly-propose-command" },
    accept: { operation: "accept_scope", job_ref: "job", job_version: 2, expected_scope_version: 1, intent_key: "hourly-accept-command" } };
}
test("hourly minute policy boundaries and explicit bilateral acceptance", async () => {
  for (const minutes of [0, -1, 721, 1.5, "60", null]) {
    const f = await hourlySetup(); await rejected(f.call({ ...f.propose, maximum_billable_minutes: minutes }, "poster"), "invalid_maximum_minutes");
    assert.equal(f.records.has("v2HourlyScopes/job"), false);
  }
  for (const minutes of [1, 719, 720]) {
    const f = await hourlySetup();
    assert.equal((await f.call({ operation: "detail", job_ref: "job" }, "poster")).job.funding_scope_ready, false);
    const command = { ...f.propose, maximum_billable_minutes: minutes };
    const first = await f.call(command, "poster"); assert.deepEqual(await f.call(command, "poster"), first);
    assert.equal(first.hourly_scope.maximum_billable_minutes, minutes);
    const selected = await f.call({ operation: "selected_jobs", cursor: null });
    assert.equal(selected.jobs.length, 1); assert.equal(selected.jobs[0].selected_for_you, true);
    for (const key of ["worker_ref", "poster_ref", "standing_provenance", "binding_digest"]) assert.ok(!JSON.stringify(selected).includes(key));
    const agreed = await f.call(f.accept); assert.deepEqual(await f.call(f.accept), agreed);
    assert.equal(agreed.hourly_scope.state, "AGREED");
    assert.deepEqual(await f.call(command, "poster"), first);
    assert.equal((await f.call({ operation: "detail", job_ref: "job" })).job.funding_scope_ready, true);
    assert.equal(f.records.get("v2PublishedJobs/job").financial_state, "FUNDING_REQUIRED");
    assert.equal(f.records.get("v2PublishedJobs/job").job_lifecycle_state, "SELECTION_PENDING_FUNDING");
    assert.equal([...f.records.keys()].filter(k => k.startsWith("v2HourlyScopes/job/commands/")).length, 2);
  }
});
test("hourly authorization, exact payloads, decline and supersession fail closed", async () => {
  const f = await hourlySetup();
  await rejected(f.call(f.propose), "not_permitted");
  await rejected(f.call(f.propose, "other"), "not_permitted");
  await rejected(f.call(f.propose, null), "authentication_required");
  await f.call(f.propose, "poster");
  await rejected(f.call(f.accept, "other"), "not_permitted");
  await rejected(f.call(f.accept, "poster"), "not_permitted");
  await rejected(f.call({ ...f.accept, maximum_billable_minutes: 120 }), "invalid_request");
  await rejected(f.call({ ...f.propose, worker_ref: "other" }, "poster"), "invalid_request");
  await rejected(f.call({ ...f.propose, maximum_billable_minutes: 120 }, "poster"), "request_conflict");
  const next = { ...f.propose, intent_key: "second-proposal-command", expected_scope_version: 1, maximum_billable_minutes: 120 };
  await f.call(next, "poster");
  assert.equal(f.records.get("v2HourlyScopes/job/history/1").state, "SUPERSEDED");
  await rejected(f.call(f.accept), "stale_scope");
  const declined = { ...f.accept, operation: "decline_scope", expected_scope_version: 2 };
  assert.equal((await f.call(declined)).hourly_scope.state, "DECLINED");
  assert.equal((await f.call({ operation: "detail", job_ref: "job" }, "poster")).job.funding_scope_ready, false);
  await rejected(f.call({ ...f.accept, expected_scope_version: 2 }), "request_conflict");
  assert.equal(f.records.get("v2ProvisionalSelections/job").state, "PROVISIONAL");
});
test("changed controlling facts invalidate hourly agreement; fixed price needs no hourly proposal", async () => {
  for (const edit of [
    f => { f.records.get("v2PublishedJobs/job").poster_offer.poster_entered_amount_minor += 1; },
    f => { f.records.get("v2PublishedJobs/job").job_version += 1; },
    f => { f.records.get("v2ProvisionalSelections/job").response_ref = "changed-response"; },
    f => { f.records.get("v2ProvisionalSelections/job").worker_ref = "different-worker"; }
  ]) {
    const f = await hourlySetup(); await f.call(f.propose, "poster"); await f.call(f.accept); edit(f);
    await assert.rejects(f.call(f.accept));
    try { assert.equal((await f.call({ operation: "detail", job_ref: "job" }, "poster")).job.funding_scope_ready, false); }
    catch (e) { assert.equal(e.details?.reason, "job_unavailable"); }
  }
  const f = await selectionSetup(); await f.call(f.select, "poster");
  const read = (await f.call({ operation: "detail", job_ref: "job" }, "poster")).job;
  assert.equal(read.funding_scope_ready, true); assert.equal(read.hourly_scope, undefined);
  await rejected(f.call({ operation: "propose_scope", job_ref: "job", job_version: 2,
    expected_scope_version: 0, maximum_billable_minutes: 60, intent_key: "fixed-proposal-invalid" }, "poster"), "hourly_scope_unavailable");
});
