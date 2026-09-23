"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const admin = require("firebase-admin");
const { initializeTestEnvironment, assertFails } = require("@firebase/rules-unit-testing");
const { FirestoreV2CommandRepository } = require("../src/v2/firestoreCommandRepository");
const { COMMAND_KINDS } = require("../src/v2/foundation");
const { readPublicationStanding, readEligibilityGeography } = require("../src/v2/publicationPrerequisites");
const { recordSafetyDecision } = require("../src/v2/standingSafetyAuthority");
const { recordProtectedNYCAddress } = require("../src/v2/protectedLocationAuthority");
const { confirmGeneralCleaningDraft, readCurrentConfirmedCleaningDraft } = require("../src/v2/confirmedPostingDraft");

const projectId = "oddjobs-v2-command-test";
let env, app, db, repository;

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { host: "127.0.0.1", port: 8080, rules: fs.readFileSync("../firestore.v2.rules", "utf8") }
  });
  app = admin.initializeApp({ projectId }, "v2-command-tests");
  db = app.firestore();
  repository = new FirestoreV2CommandRepository({ db, clock: () => new Date("2026-09-23T00:00:00Z") });
});
test.beforeEach(async () => env.clearFirestore());
test.after(async () => { await env.cleanup(); await app.delete(); });

function command(overrides = {}) {
  return {
    kind: COMMAND_KINDS.PUBLICATION,
    authenticatedActorRef: "poster-1",
    idempotencyKey: "publication-intent-1",
    payload: { draft_ref: "draft-1", draft_version: 1 },
    schemaVersion: 1,
    policyVersion: "policy-v1",
    transactionWork: async (tx, { commandId }) => {
      tx.create(db.collection("v2TestJobs").doc(commandId), { owner_ref: "poster-1", state: "PUBLISHED_OPEN" });
      return { receipt_id: commandId, job_ref: commandId, financial_state: "NOT_REQUIRED_YET" };
    },
    ...overrides
  };
}

test("first command atomically persists one result and provenance", async () => {
  const result = await repository.execute(command());
  assert.equal(result.created, true);
  assert.equal((await db.collection("v2TestJobs").get()).size, 1);
  const persisted = (await db.collection("v2CommandReceipts").doc(result.commandId).get()).data();
  assert.equal(persisted.actor_ref, "poster-1");
  assert.equal(persisted.schema_version, 1);
  assert.equal(persisted.policy_version, "policy-v1");
  assert.equal(persisted.result.receipt_id, result.commandId);
  assert.equal((await db.collection("payments").get()).size, 0);
  assert.equal((await db.collection("settlements").get()).size, 0);
});

test("identical and concurrent retries return the immutable first result", async () => {
  const first = await repository.execute(command());
  const replay = await repository.execute(command({ transactionWork: () => { throw new Error("must not mutate"); } }));
  assert.deepEqual(replay, { created: false, commandId: first.commandId, result: first.result });
  const parallel = await Promise.all([
    repository.execute(command()), repository.execute(command())
  ]);
  assert.equal(parallel.filter((item) => item.created).length, 0);
  assert.equal((await db.collection("v2CommandReceipts").get()).size, 1);
  assert.equal((await db.collection("v2TestJobs").get()).size, 1);
});

test("concurrent first attempts commit one command and one result", async () => {
  const results = await Promise.all([
    repository.execute(command()), repository.execute(command())
  ]);
  assert.equal(results.filter((item) => item.created).length, 1);
  assert.equal(results[0].commandId, results[1].commandId);
  assert.deepEqual(results[0].result, results[1].result);
  assert.equal((await db.collection("v2CommandReceipts").get()).size, 1);
  assert.equal((await db.collection("v2TestJobs").get()).size, 1);
});

test("changed payload or version cannot reuse a command identity", async () => {
  await repository.execute(command());
  await assert.rejects(repository.execute(command({ payload: { draft_ref: "draft-2", draft_version: 1 } })), /replay/);
  await assert.rejects(repository.execute(command({ policyVersion: "policy-v2" })), /replay/);
  assert.equal((await db.collection("v2CommandReceipts").get()).size, 1);
});

test("owner and command kind are isolated", async () => {
  const first = await repository.execute(command());
  const second = await repository.execute(command({
    authenticatedActorRef: "poster-2",
    transactionWork: async () => ({ receipt_id: "owner-2" })
  }));
  assert.notEqual(first.commandId, second.commandId);
  assert.equal((await db.collection("v2CommandReceipts").get()).size, 2);
});

test("failed transaction leaves neither mutation nor receipt", async () => {
  await assert.rejects(repository.execute(command({
    transactionWork: async (tx, { commandId }) => {
      tx.create(db.collection("v2TestJobs").doc(commandId), { state: "PUBLISHED_OPEN" });
      throw new Error("policy denied");
    }
  })), /policy denied/);
  assert.equal((await db.collection("v2TestJobs").get()).size, 0);
  assert.equal((await db.collection("v2CommandReceipts").get()).size, 0);
});

test("invalid backend result rolls back transactional writes", async () => {
  await assert.rejects(repository.execute(command({
    transactionWork: async (tx, { commandId }) => {
      tx.create(db.collection("v2TestJobs").doc(commandId), { state: "PUBLISHED_OPEN" });
      return null;
    }
  })), /result object/);
  assert.equal((await db.collection("v2TestJobs").get()).size, 0);
  assert.equal((await db.collection("v2CommandReceipts").get()).size, 0);
});

test("clients cannot read or author backend receipts", async () => {
  const client = env.authenticatedContext("poster-1").firestore();
  await assertFails(client.collection("v2CommandReceipts").doc("forged").set({ result: "success" }));
  await assertFails(client.collection("v2CommandReceipts").doc("forged").get());
});

test("live Auth and audited safety decision, not seeded markers or client claims, govern posting", async () => {
  const actorRef = "poster-1";
  let disabled = false;
  const auth = { getUser: async (uid) => ({ uid, disabled }) };
  const now = new Date("2026-09-23T12:00:00Z");
  const check = () => db.runTransaction((tx) => readPublicationStanding(tx, db, actorRef, { auth, now }));
  assert.equal((await check()).allowed, false);
  await db.collection("v2Standing").doc(actorRef).set({
    authority: "BACKEND_DOMAIN", subject_ref: actorRef, policy_version: "v1", publication_allowed: true
  });
  assert.equal((await check()).allowed, false);
  await recordSafetyDecision({ db, operatorRef: "safety-op-1", subjectRef: actorRef,
    state: "CLEAR", reasonCode: "REVIEW_CLEAR", expectedVersion: 0,
    validUntil: new Date("2026-09-24T12:00:00Z"), now,
    authorizeSafetyOperator: async (uid) => uid === "safety-op-1" });
  assert.equal((await check()).allowed, true);
  assert.equal((await db.collection("v2SafetyAudit").get()).size, 1);
  const client = env.authenticatedContext(actorRef).firestore();
  await assertFails(client.collection("v2Standing").doc(actorRef).set({ publication_allowed: true }));
  await assertFails(client.collection("v2Safety").doc(actorRef).set({ publication_clear: true }));
  await assertFails(client.collection("v2Safety").doc(actorRef).get());
  await assertFails(client.collection("v2SafetyAudit").doc(`${actorRef}_1`).get());
  await assertFails(client.collection("v2SafetyAudit").doc(`${actorRef}_2`).set({ state: "CLEAR" }));
  disabled = true;
  assert.equal((await check()).allowed, false);
  disabled = false;
  await recordSafetyDecision({ db, operatorRef: "safety-op-1", subjectRef: actorRef,
    state: "REVOKED", reasonCode: "REVIEW_REVOKED", expectedVersion: 1,
    validUntil: new Date("2026-09-24T12:00:00Z"), now,
    authorizeSafetyOperator: async () => true });
  assert.equal((await check()).allowed, false);
  await assert.rejects(recordSafetyDecision({ db, operatorRef: "safety-op-1", subjectRef: actorRef,
    state: "CLEAR", reasonCode: "REVIEW_CLEAR", expectedVersion: 1,
    validUntil: new Date("2026-09-24T12:00:00Z"), now,
    authorizeSafetyOperator: async () => true }), /VERSION_CONFLICT/);
  assert.equal((await db.collection("v2SafetyAudit").get()).size, 2);
});

test("protected location producer derives borough, isolates exact address, and rejects client writes", async () => {
  const address = { house_number: "123", street: "Example Street", zip_code: "10451", unit: "Apt 2" };
  let calls = 0;
  const validator = { providerId: "NYC_GEOCLIENT_V2", validateExactAddress: async (providerAddress, digest) => {
    calls++;
    assert.equal(Object.hasOwn(providerAddress, "unit"), false);
    return { provider_id: "NYC_GEOCLIENT_V2", input_digest: digest, status: "EXACT_ADDRESS",
      dataset_version: "test-dataset", provider_reference: "provider-record-1",
      matches: [{ geosupport_return_code: "00", input_match_confirmed: true, borough_code: "2" }] };
  } };
  const args = { db, authenticatedOwnerRef: "poster-1", intentKey: "location-intent-123", address,
    validator, now: new Date("2026-09-23T10:00:00Z") };
  const first = await recordProtectedNYCAddress(args);
  assert.equal(first.eligibility_geography.borough_id, "nyc:borough:bronx");
  assert.equal(JSON.stringify(first).includes("Example Street"), false);
  const stored = (await db.collection("v2ProtectedLocations").doc(first.protected_ref).get()).data();
  assert.equal(stored.exact_address.street, "Example Street");
  assert.equal(stored.owner_ref, "poster-1");
  assert.equal(stored.source, "NYC_GEOCLIENT_V2");
  const repeat = await recordProtectedNYCAddress(args);
  assert.deepEqual(repeat, first);
  assert.equal(calls, 1);
  await assert.rejects(recordProtectedNYCAddress({ ...args, address: { ...address, street: "Different Street" } }), /LOCATION_INTENT_CONFLICT/);
  const geography = await db.runTransaction((tx) => readEligibilityGeography(tx, db, first.protected_ref, "poster-1"));
  assert.equal(geography.borough_id, "nyc:borough:bronx");
  assert.equal(JSON.stringify(geography).includes("Example Street"), false);
  await assert.rejects(db.runTransaction((tx) => readEligibilityGeography(tx, db, first.protected_ref, "poster-2")), /ownership/);
  const client = env.authenticatedContext("poster-1").firestore();
  await assertFails(client.collection("v2ProtectedLocations").doc(first.protected_ref).get());
  await assertFails(client.collection("v2ProtectedLocations").doc("location-2").set({ street_address: "forged" }));
});

test("ambiguous, mismatched, unavailable and non-NYC validation cannot create protected authority", async () => {
  const address = { house_number: "123", street: "Example Street", zip_code: "10451" };
  const base = { db, authenticatedOwnerRef: "poster-1", intentKey: "location-intent-456", address };
  const result = (digest) => ({ provider_id: "NYC_GEOCLIENT_V2", input_digest: digest,
    status: "EXACT_ADDRESS", dataset_version: "test-dataset", provider_reference: "record",
    matches: [{ geosupport_return_code: "00", input_match_confirmed: true, borough_code: "2" }] });
  const provider = (change) => ({ providerId: "NYC_GEOCLIENT_V2",
    validateExactAddress: async (_, digest) => change(result(digest)) });
  const invalid = [
    provider((r) => ({ ...r, matches: [r.matches[0], r.matches[0]] })),
    provider((r) => ({ ...r, input_digest: "wrong" })),
    provider((r) => ({ ...r, matches: [{ ...r.matches[0], borough_code: "9" }] })),
    provider((r) => ({ ...r, matches: [{ ...r.matches[0], input_match_confirmed: false }] })),
    provider((r) => ({ ...r, status: "AMBIGUOUS" }))
  ];
  for (const validator of invalid) {
    await assert.rejects(recordProtectedNYCAddress({ ...base, validator }), /LOCATION_VALIDATION_UNRESOLVED/);
  }
  await assert.rejects(recordProtectedNYCAddress({ ...base, validator: null }), /LOCATION_AUTHORITY_UNAVAILABLE/);
  await assert.rejects(recordProtectedNYCAddress({ ...base, validator: { providerId: "CLIENT", validateExactAddress: async () => result("x") } }), /LOCATION_AUTHORITY_UNAVAILABLE/);
  await assert.rejects(recordProtectedNYCAddress({ ...base, validator: { providerId: "NYC_GEOCLIENT_V2", validateExactAddress: async () => { throw new Error("sensitive provider detail"); } } }), /LOCATION_VALIDATION_UNAVAILABLE/);
  assert.equal((await db.collection("v2ProtectedLocations").get()).size, 0);
});

test("conflicting concurrent borough validation invalidates protected geography", async () => {
  const address = { house_number: "123", street: "Example Street", zip_code: "10451" };
  const input = { db, authenticatedOwnerRef: "poster-1", intentKey: "location-intent-race", address };
  let arrivals = 0;
  let release;
  const bothValidating = new Promise((resolve) => { release = resolve; });
  const validator = (boroughCode) => ({ providerId: "NYC_GEOCLIENT_V2",
    validateExactAddress: async (_, digest) => {
      arrivals++;
      if (arrivals === 2) release();
      await bothValidating;
      return { provider_id: "NYC_GEOCLIENT_V2",
      input_digest: digest, status: "EXACT_ADDRESS", dataset_version: "test-dataset",
      provider_reference: `record-${boroughCode}`,
      matches: [{ geosupport_return_code: "00", input_match_confirmed: true, borough_code: boroughCode }] };
    } });
  const results = await Promise.allSettled([
    recordProtectedNYCAddress({ ...input, validator: validator("2") }),
    recordProtectedNYCAddress({ ...input, validator: validator("3") })
  ]);
  assert.equal(arrivals, 2);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason.message === "LOCATION_VALIDATION_UNRESOLVED").length, 1);
  const protectedRef = results.find((result) => result.status === "fulfilled").value.protected_ref;
  const stored = (await db.collection("v2ProtectedLocations").doc(protectedRef).get()).data();
  assert.equal((await db.collection("v2ProtectedLocations").get()).size, 1);
  assert.equal(stored.derivation_state, "UNRESOLVED");
  assert.equal(stored.conflict_reason_code, "PROVIDER_BOROUGH_CONFLICT");
  await assert.rejects(db.runTransaction((tx) => readEligibilityGeography(tx, db, protectedRef, "poster-1")), /Validated borough/);
});

function cleaningSubmission() {
  return { task_type_id: "general_cleaning", taxonomy_version: 2,
    title: "Clean two rooms", description: "Clean the kitchen and bathroom.", additional_info: "",
    duration_minutes: 120, schedule_window: { start_at: "2026-09-24T13:00:00Z",
      end_at: "2026-09-24T15:00:00Z", time_zone: "America/New_York" },
    scope: { areas_items: ["kitchen", "bathroom"], cleaning_level: "STANDARD",
      approximate_scale: "two rooms", room_count: 2, supplies_responsibility: "POSTER_PROVIDES",
      condition_hazards: "NONE_CONFIRMED" },
    risk_facts: { medical_or_intimate_care: "ABSENT_CONFIRMED",
      hazardous_materials: "ABSENT_CONFIRMED", pest_control: "ABSENT_CONFIRMED",
      chemical_risk: "ABSENT_CONFIRMED", unknown_conditions: "ABSENT_CONFIRMED" },
    conflicting_facts: [], additional_task_type_ids: [], prohibited_scope_codes: [] };
}

test("owner-bound confirmed cleaning draft is versioned, replay-safe and client-protected", async () => {
  const base = { db, actorRef: "poster-1", intentKey: "cleaning-draft-intent-1",
    expectedVersion: 0, submission: cleaningSubmission(), now: new Date("2026-09-23T10:00:00Z") };
  const first = await confirmGeneralCleaningDraft(base);
  assert.equal(first.draft_version, 1);
  assert.equal(first.policy_outcome, "SUPPORTED_ADVISORY");
  assert.equal(first.text_reconciliation_state, "UNRESOLVED");
  assert.deepEqual(await confirmGeneralCleaningDraft(base), first);
  const current = await db.runTransaction((tx) => readCurrentConfirmedCleaningDraft(tx, db,
    first.draft_ref, "poster-1", 1));
  assert.equal(current.confirmed_facts.confirmation.source, "POSTER_CONFIRMED");
  assert.equal(current.policy_outcome, "SUPPORTED_ADVISORY");
  assert.equal(current.text_reconciliation_state, "UNRESOLVED");
  await assert.rejects(db.runTransaction((tx) => readCurrentConfirmedCleaningDraft(tx, db,
    first.draft_ref, "poster-2", 1)), /CONFIRMED_DRAFT_UNAVAILABLE/);
  const revised = await confirmGeneralCleaningDraft({ ...base, expectedVersion: 1,
    submission: { ...cleaningSubmission(), title: "Revised cleaning scope" } });
  assert.equal(revised.draft_version, 2);
  await assert.rejects(db.runTransaction((tx) => readCurrentConfirmedCleaningDraft(tx, db,
    first.draft_ref, "poster-1", 1)), /CONFIRMED_DRAFT_UNAVAILABLE/);
  await assert.rejects(confirmGeneralCleaningDraft({ ...base, submission: {
    ...cleaningSubmission(), title: "Conflicting retry" } }), /DRAFT_VERSION_CONFLICT/);
  const client = env.authenticatedContext("poster-1").firestore();
  await assertFails(client.collection("v2PostingDrafts").doc(first.draft_ref).get());
  await assertFails(client.collection("v2PostingDrafts").doc(first.draft_ref).set({ owner_ref: "poster-1", policy_outcome: "SUPPORTED_ADVISORY" }));
  assert.equal((await db.collection("v2PostingDrafts").get()).size, 1);
  assert.equal((await db.collection("v2TestJobs").get()).size, 0);
  assert.equal((await db.collection("payments").get()).size, 0);
});

test("draft preserves uncertain scope but never promotes it into a safe posting fact", async () => {
  const base = { db, actorRef: "poster-1", intentKey: "cleaning-draft-intent-2",
    expectedVersion: 0, now: new Date("2026-09-23T10:00:00Z") };
  const conflicted = cleaningSubmission();
  conflicted.conflicting_facts = ["description may include another task"];
  const first = await confirmGeneralCleaningDraft({ ...base, submission: conflicted });
  assert.equal(first.policy_outcome, "ESCALATION_REQUIRED");
  const prohibited = cleaningSubmission();
  prohibited.prohibited_scope_codes = ["HAZARDOUS_MATERIALS"];
  const second = await confirmGeneralCleaningDraft({ ...base,
    intentKey: "cleaning-draft-intent-3", submission: prohibited });
  assert.equal(second.policy_outcome, "UNSUPPORTED_WITHHOLD");
  await assert.rejects(confirmGeneralCleaningDraft({ ...base,
    intentKey: "cleaning-draft-intent-4", submission: { ...cleaningSubmission(),
      policy_outcome: "SUPPORTED_ADVISORY" } }), /DRAFT_INPUT_INVALID/);
  assert.equal((await db.collection("v2TestJobs").get()).size, 0);
});

test("draft rejects unbounded or unknown nested inputs before persistence", async () => {
  const base = { db, actorRef: "poster-1", intentKey: "cleaning-draft-input-bounds",
    expectedVersion: 0, now: new Date("2026-09-23T10:00:00Z") };
  for (const change of [
    { scope: { ...cleaningSubmission().scope, areas_items: ["x".repeat(121)] } },
    { scope: { ...cleaningSubmission().scope, extra: "unrelated private data" } },
    { risk_facts: { ...cleaningSubmission().risk_facts, extra: "unrelated private data" } },
    { conflicting_facts: Array(21).fill("conflict") },
    { additional_task_type_ids: [{ nested: Array(1000).fill("x") }] }
  ]) {
    await assert.rejects(confirmGeneralCleaningDraft({ ...base,
      submission: { ...cleaningSubmission(), ...change } }), /DRAFT_INPUT_INVALID/);
  }
  assert.equal((await db.collection("v2PostingDrafts").get()).size, 0);
});

test("draft replay fails closed if stored derived policy or text is tampered", async () => {
  const base = { db, actorRef: "poster-1", intentKey: "cleaning-draft-tamper",
    expectedVersion: 0, submission: cleaningSubmission(),
    now: new Date("2026-09-23T10:00:00Z") };
  const first = await confirmGeneralCleaningDraft(base);
  const ref = db.collection("v2PostingDrafts").doc(first.draft_ref);
  await ref.update({ policy_outcome: "UNSUPPORTED_WITHHOLD" });
  await assert.rejects(confirmGeneralCleaningDraft(base), /CONFIRMED_DRAFT_UNAVAILABLE/);
  await ref.update({ policy_outcome: "SUPPORTED_ADVISORY", text_digest: "tampered" });
  await assert.rejects(confirmGeneralCleaningDraft(base), /CONFIRMED_DRAFT_UNAVAILABLE/);
});
