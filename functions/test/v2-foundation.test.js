"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  INITIAL_PUBLICATION_STATE, COMMAND_KINDS, commandIdentity,
  commandPayloadDigest, assertSameCommandPayload,
  assertInitialPublicationState, classifyPublicationRecord
} = require("../src/v2/foundation");

const receipt = () => ({
  record_type: "ORDINARY_JOB_PUBLICATION_RECEIPT",
  publication_receipt_id: "receipt-1",
  publication_idempotency_key: "intent-1234567890",
  job_ref: "job-1",
  owner_ref: "poster-1",
  job_version: 1,
  published_at: "2026-09-23T00:00:00Z",
  discovery_visibility: "MARKETPLACE_OPEN",
  hire_again_relationship_ref: null,
  ...INITIAL_PUBLICATION_STATE,
  selected_worker_ref: null,
  assignment_created: false,
  payout_eligible: false,
  payment_or_funding_record_created: false,
  backend_authoritative: true,
  stripe_customer_required: false,
  saved_payment_method_required: false,
  payment_intent_created: false,
  charge_created: false,
  proactive_notification_authorized: false
});

test("initial publication keeps lifecycle and financial state separate", () => {
  assert.equal(INITIAL_PUBLICATION_STATE.job_lifecycle_state, "PUBLISHED_OPEN");
  assert.equal(INITIAL_PUBLICATION_STATE.financial_state, "NOT_REQUIRED_YET");
  assert.equal(assertInitialPublicationState(receipt()), true);
  for (const [field, value] of Object.entries({
    job_lifecycle_state: "active", financial_state: "FUNDED",
    job_lifecycle_version: 1, financial_state_version: 1,
    selected_worker_ref: "worker-1", assignment_created: true,
    payout_eligible: true, payment_or_funding_record_created: true
  })) {
    assert.throws(() => assertInitialPublicationState({ ...receipt(), [field]: value }), field);
  }
});

test("command identity is stable, owner-scoped and domain-separated", () => {
  const input = { kind: COMMAND_KINDS.PUBLICATION, actorRef: "poster-1", idempotencyKey: "intent-1234567890" };
  const identity = commandIdentity(input);
  assert.match(identity, /^[0-9a-f]{64}$/);
  assert.equal(commandIdentity(input), identity);
  assert.notEqual(commandIdentity({ ...input, actorRef: "poster-2" }), identity);
  assert.notEqual(commandIdentity({ ...input, idempotencyKey: "intent-1234567891" }), identity);
  assert.notEqual(commandIdentity({ ...input, kind: COMMAND_KINDS.SELECTION_FUNDING }), identity);
  assert.notEqual(commandIdentity({ ...input, actorRef: "poster-1:a" }),
    commandIdentity({ ...input, actorRef: "poster-1", idempotencyKey: "a:intent-1234567890" }));
});

test("malformed command identities fail closed", () => {
  const input = { kind: COMMAND_KINDS.PUBLICATION, actorRef: "poster-1", idempotencyKey: "intent-1234567890" };
  for (const patch of [
    { kind: "LEGACY_POST" }, { actorRef: "" }, { actorRef: " poster-1" },
    { idempotencyKey: "short" }, { idempotencyKey: "x".repeat(201) }
  ]) assert.throws(() => commandIdentity({ ...input, ...patch }));
});

test("same command key cannot silently change its payload", () => {
  const first = { owner_ref: "poster-1", draft_version: 1, policy_versions: { b: "2", a: "1" } };
  const reordered = { policy_versions: { a: "1", b: "2" }, draft_version: 1, owner_ref: "poster-1" };
  const digest = commandPayloadDigest(first);
  assert.equal(commandPayloadDigest(reordered), digest);
  assert.equal(assertSameCommandPayload(digest, reordered), true);
  assert.throws(() => assertSameCommandPayload(digest, { ...first, draft_version: 2 }));
  for (const invalid of [{ amount: 0.1 }, { missing: undefined }, { amount: Infinity }]) {
    assert.throws(() => commandPayloadDigest(invalid));
  }
});

test("legacy records cannot be promoted by a matching status string", () => {
  assert.equal(classifyPublicationRecord({ progressStatus: "active" }), "LEGACY_OR_UNRECOGNIZED");
  assert.equal(classifyPublicationRecord({ ...receipt(), record_type: "LEGACY_JOB" }), "LEGACY_OR_UNRECOGNIZED");
  assert.equal(classifyPublicationRecord(receipt()), "V2_PUBLICATION_RECEIPT");
  assert.throws(() => classifyPublicationRecord({ ...receipt(), financial_state: "FUNDED" }));
  assert.throws(() => classifyPublicationRecord({ ...receipt(), backend_authoritative: false }));
  assert.throws(() => classifyPublicationRecord({ ...receipt(), payment_intent_created: true }));
  assert.throws(() => classifyPublicationRecord({ ...receipt(), publication_receipt_id: undefined }));
  assert.throws(() => classifyPublicationRecord({ ...receipt(), street_address: "private" }));
  assert.throws(() => classifyPublicationRecord({ ...receipt(), published_at: "yesterday" }));
});
