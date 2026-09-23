"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const admin = require("firebase-admin");
const { initializeTestEnvironment, assertFails } = require("@firebase/rules-unit-testing");
const { FirestoreV2CommandRepository } = require("../src/v2/firestoreCommandRepository");
const { COMMAND_KINDS } = require("../src/v2/foundation");
const { readPublicationStanding, readEligibilityGeography } = require("../src/v2/publicationPrerequisites");

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

test("standing and safety are read from protected backend records, not client claims", async () => {
  const actorRef = "poster-1";
  const check = () => db.runTransaction((tx) => readPublicationStanding(tx, db, actorRef));
  assert.equal((await check()).allowed, false);
  await db.collection("v2Standing").doc(actorRef).set({
    authority: "BACKEND_DOMAIN", subject_ref: actorRef, policy_version: "v1", publication_allowed: true
  });
  await db.collection("v2Safety").doc(actorRef).set({
    authority: "BACKEND_DOMAIN", subject_ref: actorRef, policy_version: "v1", publication_clear: true
  });
  assert.equal((await check()).allowed, true);
  const client = env.authenticatedContext(actorRef).firestore();
  await assertFails(client.collection("v2Standing").doc(actorRef).set({ publication_allowed: true }));
  await assertFails(client.collection("v2Safety").doc(actorRef).set({ publication_clear: true }));
  await db.collection("v2Safety").doc(actorRef).update({ publication_clear: false });
  assert.equal((await check()).allowed, false);
});

test("protected location read yields only borough projection and rejects client writes", async () => {
  await db.collection("v2ProtectedLocations").doc("location-1").set({
    authority: "BACKEND_VALIDATED_LOCATION", registry_version: "v2-planning-1",
    applicability: "IN_PERSON", borough_id: "nyc:borough:bronx", neighborhood_id: null,
    protected_ref: "location-1", owner_ref: "poster-1", street_address: "private", unit: "private"
  });
  const geography = await db.runTransaction((tx) => readEligibilityGeography(tx, db, "location-1", "poster-1"));
  assert.equal(geography.borough_id, "nyc:borough:bronx");
  assert.equal(JSON.stringify(geography).includes("private"), false);
  await assert.rejects(db.runTransaction((tx) => readEligibilityGeography(tx, db, "location-1", "poster-2")), /ownership/);
  const client = env.authenticatedContext("poster-1").firestore();
  await assertFails(client.collection("v2ProtectedLocations").doc("location-1").get());
  await assertFails(client.collection("v2ProtectedLocations").doc("location-2").set({ street_address: "forged" }));
});
