"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const admin = require("firebase-admin");
const { initializeTestEnvironment, assertFails } = require("@firebase/rules-unit-testing");
const { commandPayloadDigest } = require("../src/v2/foundation");
const { POLICY_VERSION } = require("../src/v2/taskScopePolicy");
const { GEOGRAPHY_REGISTRY_VERSION } = require("../src/v2/publicationPrerequisites");
const { recordSafetyDecision } = require("../src/v2/standingSafetyAuthority");
const { recordProtectedNYCAddress, PROVIDER_ID } = require("../src/v2/protectedLocationAuthority");
const { confirmGeneralCleaningDraft } = require("../src/v2/confirmedPostingDraft");
const { PUBLICATION_POLICY_VERSION, publishGeneralCleaningJob } = require("../src/v2/publishOrdinaryJob");
const { createPublicationCallable } = require("../src/v2/publicationCallable");

const now = new Date("2026-09-23T12:00:00Z");
const auth = { getUser: async (uid) => ({ uid, disabled: false }) };
const controls = { enabled: true, max_open_jobs: 2, max_daily_publications: 2 };
let env, app, db;

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: "oddjobs-v2-publication-test",
    firestore: { host: "127.0.0.1", port: 8080,
      rules: fs.readFileSync("../firestore.rules", "utf8") } });
  app = admin.initializeApp({ projectId: "oddjobs-v2-publication-test" }, "v2-publication-tests");
  db = app.firestore();
});
test.beforeEach(async () => env.clearFirestore());
test.after(async () => { await env.cleanup(); await app.delete(); });

function cleaningSubmission() {
  return { task_type_id: "general_cleaning", taxonomy_version: 2,
    title: "Clean kitchen and bathroom",
    description: "Standard cleaning of kitchen and bathroom. Poster provides supplies.",
    additional_info: "",
    duration_minutes: 120, schedule_window: { start_at: "2026-09-24T13:00:00Z",
      end_at: "2026-09-24T15:00:00Z", time_zone: "America/New_York" },
    scope: { areas_items: ["kitchen", "bathroom"], cleaning_level: "STANDARD",
      approximate_scale: "two rooms", room_count: 2,
      supplies_responsibility: "POSTER_PROVIDES", condition_hazards: "NONE_CONFIRMED" },
    risk_facts: { medical_or_intimate_care: "ABSENT_CONFIRMED",
      hazardous_materials: "ABSENT_CONFIRMED", pest_control: "ABSENT_CONFIRMED",
      chemical_risk: "ABSENT_CONFIRMED", unknown_conditions: "ABSENT_CONFIRMED" },
    conflicting_facts: [], additional_task_type_ids: [], prohibited_scope_codes: [] };
}

async function setup({ owner = "poster-1", submission = cleaningSubmission() } = {}) {
  await recordSafetyDecision({ db, operatorRef: "narrow-safety-operator", subjectRef: owner,
    state: "CLEAR", reasonCode: "REVIEWED_CLEAR", expectedVersion: 0,
    validUntil: new Date("2026-09-26T12:00:00Z"),
    authorizeSafetyOperator: async (ref) => ref === "narrow-safety-operator", now });
  const draft = await confirmGeneralCleaningDraft({ db, actorRef: owner,
    intentKey: `cleaning-draft-${owner}-1`, expectedVersion: 0, submission, now });
  const location = await recordProtectedNYCAddress({ db,
    authenticatedOwnerRef: owner, intentKey: `cleaning-location-${owner}-1`,
    address: { house_number: "123", street: "Example Street", zip_code: "10451" },
    validator: { providerId: PROVIDER_ID,
      validateExactAddress: async (_, inputDigest) => ({ provider_id: PROVIDER_ID,
        input_digest: inputDigest, status: "EXACT_ADDRESS", dataset_version: "emulator-test-1",
        provider_reference: "test-nyc-address", matches: [{ geosupport_return_code: "00",
          input_match_confirmed: true, borough_code: "2" }] }) }, now });
  const command = { record_type: "ORDINARY_JOB_PUBLICATION_COMMAND",
    publication_idempotency_key: `cleaning-publication-${owner}-1`, owner_ref: owner,
    draft_ref: draft.draft_ref, draft_version: draft.draft_version,
    requested_discovery_visibility: "MARKETPLACE_OPEN", hire_again_relationship_ref: null,
    task_type_id: "general_cleaning", taxonomy_version: "2",
    confirmed_posting_facts_ref: draft.confirmed_posting_facts_ref,
    eligibility_geography: location.eligibility_geography,
    protected_fulfillment_location_ref: location.protected_ref,
    poster_offer: { pricing_mode: "FIXED", poster_entered_amount_minor: 2500,
      currency: "USD", pricing_policy_version: null, pricing_provenance: "POSTER_ENTERED" },
    policy_versions: { publication: PUBLICATION_POLICY_VERSION,
      task_scope: POLICY_VERSION, geography: GEOGRAPHY_REGISTRY_VERSION },
    client_contract_version: 1 };
  return { draft, location, command };
}

function publish(command, overrides = {}) {
  return publishGeneralCleaningJob({ db, auth, authContext: { uid: "poster-1" },
    command, controls, now, ...overrides });
}

test("authenticated callable reaches the transaction; unauthenticated and forged owner do not", async () => {
  const { command } = await setup();
  class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const handler = createPublicationCallable({ db, auth, HttpsError, env: {
    ODDJOBS_V2_PUBLICATION_ENABLED: "true", ODDJOBS_V2_MAX_OPEN_JOBS: "2",
    ODDJOBS_V2_MAX_DAILY_PUBLICATIONS: "2" } });
  await assert.rejects(handler(command, {}), (error) => error.code === "unauthenticated");
  await assert.rejects(handler({ ...command, owner_ref: "poster-2" },
    { auth: { uid: "poster-1" } }), (error) => error.code === "invalid-argument");
  const receipt = await handler(command, { auth: { uid: "poster-1" } });
  assert.equal(receipt.job_lifecycle_state, "PUBLISHED_OPEN");
  assert.equal((await db.collection("v2PublishedJobs").get()).size, 1);
});

test("confirmed ordinary cleaning publishes one free, privacy-minimized V2 job", async () => {
  const { command } = await setup();
  const receipt = await publish(command);
  assert.equal(receipt.job_lifecycle_state, "PUBLISHED_OPEN");
  assert.equal(receipt.financial_state, "NOT_REQUIRED_YET");
  assert.equal(receipt.payment_or_funding_record_created, false);
  assert.equal(receipt.selected_worker_ref, null);
  assert.equal(receipt.proactive_notification_authorized, false);
  const job = (await db.collection("v2PublishedJobs").doc(receipt.job_ref).get()).data();
  assert.equal(job.eligibility_geography.borough_id, "nyc:borough:bronx");
  assert.equal(job.poster_offer.poster_entered_amount_minor, 2500);
  assert.equal(JSON.stringify(job).includes("Example Street"), false);
  assert.equal(JSON.stringify(job).includes("protected_fulfillment_location_ref"), false);
  assert.equal((await db.collection("v2PublishedJobPrivate").get()).size, 1);
  assert.equal((await db.collection("payments").get()).size, 0);
  assert.equal((await db.collection("stripe_customers").get()).size, 0);
  assert.equal((await db.collection("v2FundingSnapshots").get()).size, 0);
  assert.equal((await db.collection("jobPost").get()).size, 0);
  const client = env.authenticatedContext("poster-1").firestore();
  await assertFails(client.collection("v2PublishedJobs").doc(receipt.job_ref).set({ owner_ref: "poster-1" }));
  await assertFails(client.collection("v2PublishedJobPrivate").doc(receipt.job_ref).get());
  const otherClient = env.authenticatedContext("other-worker").firestore();
  await assertFails(otherClient.collection("v2PublishedJobPrivate").doc(receipt.job_ref).get());
});

test("retry returns the same receipt despite changed standing or disabled publication", async () => {
  const { command } = await setup();
  const first = await publish(command);
  await recordSafetyDecision({ db, operatorRef: "narrow-safety-operator", subjectRef: "poster-1",
    state: "BLOCKED", reasonCode: "SAFETY_BLOCK", expectedVersion: 1,
    validUntil: new Date("2026-09-26T12:00:00Z"),
    authorizeSafetyOperator: async () => true, now });
  const second = await publish(command, { controls: { ...controls, enabled: false } });
  assert.deepEqual(second, first);
  assert.equal((await db.collection("v2PublishedJobs").get()).size, 1);
  await assert.rejects(publish({ ...command,
    publication_idempotency_key: "cleaning-publication-poster-1-2" }),
  /PUBLICATION_DISABLED|PUBLICATION_STANDING_BLOCKED/);
});

test("unresolved free text, forged owner/geography, and disabled controls fail closed", async () => {
  const unsafe = cleaningSubmission();
  unsafe.description = "Also remove an unknown chemical container.";
  const { command } = await setup({ submission: unsafe });
  await assert.rejects(publish(command), /PUBLICATION_SCOPE_UNRESOLVED/);
  await assert.rejects(publish({ ...command, owner_ref: "poster-2" }), /PUBLICATION_COMMAND_INVALID/);
  await assert.rejects(publish(command, { controls: { ...controls, enabled: false } }),
    /PUBLICATION_DISABLED/);
  assert.equal((await db.collection("v2PublishedJobs").get()).size, 0);
});

test("forged geography cannot override the protected owner-bound borough", async () => {
  const { command } = await setup();
  await assert.rejects(publish({ ...command,
    eligibility_geography: { ...command.eligibility_geography,
      borough_id: "nyc:borough:manhattan" } }), /PUBLICATION_GEOGRAPHY_CONFLICT/);
  assert.equal((await db.collection("v2PublishedJobs").get()).size, 0);
});

test("a second idempotency key cannot publish the same confirmed draft", async () => {
  const { command } = await setup();
  await publish(command);
  await assert.rejects(publish({ ...command,
    publication_idempotency_key: "cleaning-publication-poster-1-2" }),
  /PUBLICATION_DUPLICATE_DRAFT/);
  assert.equal((await db.collection("v2PublishedJobs").get()).size, 1);
});

test("concurrent duplicate commands create exactly one job and one receipt", async () => {
  const { command } = await setup();
  const [first, second] = await Promise.all([publish(command), publish(command)]);
  assert.deepEqual(first, second);
  assert.equal((await db.collection("v2PublishedJobs").get()).size, 1);
  assert.equal((await db.collection("v2CommandReceipts").get()).size, 1);
  assert.equal((await db.collection("v2PublicationDraftClaims").get()).size, 1);
});

test("stale draft, invalidated location and disabled account each prevent publication", async () => {
  const { draft, location, command } = await setup();
  await confirmGeneralCleaningDraft({ db, actorRef: "poster-1",
    intentKey: "cleaning-draft-poster-1-1", expectedVersion: 1,
    submission: cleaningSubmission(), now: new Date("2026-09-23T12:01:00Z") });
  await assert.rejects(publish(command), /CONFIRMED_DRAFT_UNAVAILABLE/);
  const revised = { ...command, draft_version: draft.draft_version + 1,
    publication_idempotency_key: "cleaning-publication-revised" };
  await db.collection("v2ProtectedLocations").doc(location.protected_ref).update({
    derivation_state: "UNRESOLVED" });
  await assert.rejects(publish(revised), /Validated borough-level/);
  await db.collection("v2ProtectedLocations").doc(location.protected_ref).update({
    derivation_state: "VALIDATED" });
  const disabledAuth = { getUser: async (uid) => ({ uid, disabled: true }) };
  await assert.rejects(publish(revised, { auth: disabledAuth }),
    /PUBLICATION_STANDING_BLOCKED/);
  assert.equal((await db.collection("v2PublishedJobs").get()).size, 0);
});

test("server quotas and expired confirmed schedule fail closed without consuming draft", async () => {
  const { command } = await setup();
  await assert.rejects(publish(command, { controls: { ...controls, max_open_jobs: 0 } }),
    /PUBLICATION_DISABLED/);
  await db.collection("v2PublicationQuotas").doc("poster-1").set({ owner_ref: "poster-1",
    day: "2026-09-23", daily_count: 2, open_count: 0 });
  await assert.rejects(publish(command), /PUBLICATION_RATE_LIMITED/);
  await db.collection("v2PublicationQuotas").doc("poster-1").update({ daily_count: 0 });
  await assert.rejects(publish(command, { now: new Date("2026-09-25T00:00:00Z") }),
    /PUBLICATION_SCHEDULE_EXPIRED/);
  assert.equal((await db.collection("v2PublishedJobs").get()).size, 0);
  assert.equal((await db.collection("v2PublicationDraftClaims").get()).size, 0);
});
