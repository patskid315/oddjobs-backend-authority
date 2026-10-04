"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { money, createOrReuseAttempt, reconcileIntent, publicProjection, FundingFailure } = require("../src/v2/fundingAuthority");
const { mutateScope } = require("../src/v2/hourlyFundedScope");
const { createFundingCallable } = require("../src/v2/fundingCallable");
const { createFundingWebhookHandler } = require("../src/v2/fundingWebhook");
const { StripeFundingFailure } = require("../src/v2/stripeFundingProvider");

const now = new Date("2026-10-04T12:00:00Z");
class HttpsError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }

function store() {
  const records = new Map();
  const collection = path => ({ path, doc: key => ({ id: key, path: `${path}/${key}`,
    collection: name => collection(`${path}/${key}/${name}`),
    get: async () => ({ exists: records.has(`${path}/${key}`), data: () => structuredClone(records.get(`${path}/${key}`)),
      get: field => structuredClone(records.get(`${path}/${key}`)?.[field]) }),
    set: async (value, options) => records.set(`${path}/${key}`, options?.merge ? { ...(records.get(`${path}/${key}`) || {}), ...structuredClone(value) } : structuredClone(value)) }) });
  const db = { collection, runTransaction: async work => {
    const staged = new Map(records); const snap = ref => ({ exists: staged.has(ref.path), data: () => structuredClone(staged.get(ref.path)) });
    const result = await work({ get: async ref => snap(ref), set: (ref, value) => staged.set(ref.path, structuredClone(value)),
      create: (ref, value) => { if (staged.has(ref.path)) throw new Error("already exists"); staged.set(ref.path, structuredClone(value)); } });
    records.clear(); for (const [key, value] of staged) records.set(key, value); return result;
  } };
  return { db, records };
}

async function fixture(mode = "FIXED") {
  const f = store();
  const job = { record_type: "V2_ORDINARY_PUBLISHED_JOB", job_ref: "job", owner_ref: "poster", job_version: 2,
    job_lifecycle_state: "SELECTION_PENDING_FUNDING", financial_state: "FUNDING_REQUIRED", provisional_selection_ref: "selection",
    task_type_id: "general_cleaning", schedule_window: { end_at: "2099-10-04T12:00:00Z" },
    poster_offer: { pricing_mode: mode, poster_entered_amount_minor: 10000, currency: "USD" } };
  const selection = { schema_version: 1, policy_version: "OJNY-V2-GOV-1.0.0/provisional-selection-1", state: "PROVISIONAL",
    selection_ref: "selection", job_ref: "job", poster_ref: "poster", worker_ref: "worker", response_ref: "response",
    source_job_version: 1, job_version: 2, intent_key: "selection-command", command_digest: "selection-digest",
    selected_at: now.toISOString() };
  const response = { response_ref: "response", job_ref: "job", job_version: 1, worker_ref: "worker", status: "SUBMITTED",
    decision: { outcome: "ELIGIBLE" } };
  f.records.set("v2PublishedJobs/job", job); f.records.set("v2ProvisionalSelections/job", selection);
  f.records.set("v2PublishedJobs/job/responses/response", response);
  if (mode === "HOURLY") {
    const propose = { operation: "propose_scope", job_ref: "job", job_version: 2, expected_scope_version: 0,
      maximum_billable_minutes: 90, intent_key: "hourly-proposal-command" };
    await f.db.runTransaction(tx => mutateScope({ tx, db: f.db, job, selection, command: propose, uid: "poster", now,
      fail: reason => { throw new FundingFailure(reason); } }));
    await f.db.runTransaction(tx => mutateScope({ tx, db: f.db, job, selection,
      command: { operation: "accept_scope", job_ref: "job", job_version: 2, expected_scope_version: 1, intent_key: "hourly-acceptance-key" },
      uid: "worker", now, fail: reason => { throw new FundingFailure(reason); } }));
  }
  return { ...f, job, selection, command: { operation: "prepare", job_ref: "job", job_version: 2, intent_key: "funding-command-key" } };
}

const standing = async () => ({ allowed: true });
const attempt = f => createOrReuseAttempt({ db: f.db, uid: "poster", command: f.command, now, validateStanding: async () => {} });

test("authoritative fixed/hourly integer math and half-up boundaries", () => {
  assert.deepEqual(money(10000, "FIXED"), { base_amount_minor: 10000, poster_fee_minor: 1000,
    poster_funding_total_minor: 11000, worker_fee_minor: 500, worker_payout_basis_minor: 9500,
    gross_platform_amount_minor: 1500, currency: "USD" });
  assert.deepEqual(money(10000, "HOURLY", 90), { base_amount_minor: 15000, poster_fee_minor: 1500,
    poster_funding_total_minor: 16500, worker_fee_minor: 750, worker_payout_basis_minor: 14250,
    gross_platform_amount_minor: 2250, currency: "USD" });
  assert.equal(money(1, "HOURLY", 30).base_amount_minor, 1);
  for (const bad of [0, -1, 1.5, Number.MAX_SAFE_INTEGER]) assert.throws(() => money(bad, "FIXED"));
  for (const bad of [0, 721, 1.5]) assert.throws(() => money(100, "HOURLY", bad));
});

test("attempt derives owner, selection, worker and money and rejects client authority", async () => {
  const f = await fixture(); const first = await attempt(f); const retry = await attempt(f);
  assert.equal(first.record.attempt_id, retry.record.attempt_id);
  assert.equal(first.record.snapshot.worker_ref, "worker"); assert.equal(first.record.snapshot.response_ref, "response");
  assert.equal(first.record.snapshot.poster_funding_total_minor, 11000);
  await assert.rejects(createOrReuseAttempt({ db: f.db, uid: "worker", command: f.command, now, validateStanding: async () => {} }),
    error => error.reason === "not_permitted");
  assert.equal(f.records.get("v2PublishedJobs/job").financial_state, "FUNDING_REQUIRED");
  assert.equal(f.records.has("assignments/job"), false);
});

test("hourly funding requires the current bilateral agreement and exact cap", async () => {
  const agreed = await fixture("HOURLY"); const prepared = await attempt(agreed);
  assert.equal(prepared.record.snapshot.maximum_billable_minutes, 90);
  assert.equal(prepared.record.snapshot.base_amount_minor, 15000);
  for (const mutate of [
    f => f.records.delete("v2HourlyScopes/job"),
    f => { f.records.get("v2HourlyScopes/job").state = "DECLINED"; },
    f => { f.records.get("v2HourlyScopes/job").binding.selection_ref = "other"; },
    f => { f.records.get("v2PublishedJobs/job").poster_offer.poster_entered_amount_minor = 10001; }
  ]) {
    const f = await fixture("HOURLY"); mutate(f);
    await assert.rejects(attempt(f), error => ["hourly_scope_unavailable", "job_unavailable"].includes(error.reason));
  }
});

function mockProvider() {
  let creates = 0; let status = "requires_payment_method"; let saved;
  const intent = () => ({ id: "pi_test", amount: 11000, currency: "usd", customer: "cus_test", capture_method: "automatic",
    livemode: false, status, client_secret: "pi_test_secret_safe", metadata: { oddjobs_v2_attempt: "", oddjobs_v2_snapshot: "",
      oddjobs_v2_job: "job", oddjobs_v2_selection: "selection" } });
  return { livemode: false, customer: async () => "cus_test", connectReady: async () => "acct_test",
    createIntent: async record => { creates++; const value = intent(); value.metadata.oddjobs_v2_attempt = record.attempt_id;
      value.metadata.oddjobs_v2_snapshot = record.snapshot.snapshot_id; saved = value; return value; },
    retrieveIntent: async () => ({ ...saved, status }), setStatus: value => { status = value; }, get creates() { return creates; }, intent };
}

test("callable prepares once, treats client callback as nonauthority, then reconciles provider success", async () => {
  const f = await fixture(); const provider = mockProvider();
  const callable = createFundingCallable({ db: f.db, auth: { getUser: async uid => ({ uid, disabled: false }) },
    providerFactory: () => provider, HttpsError, clock: () => now, standing });
  const call = (data, uid = "poster") => callable(data, uid ? { auth: { uid } } : {});
  await assert.rejects(call(f.command, null), error => error.details.reason === "authentication_required");
  await assert.rejects(call(f.command, "worker"), error => error.details.reason === "not_permitted");
  const quoted = await call({ ...f.command, operation: "quote" });
  assert.equal(quoted.funding.poster_funding_total_minor, 11000); assert.equal(quoted.funding.payment_intent_client_secret, undefined);
  assert.equal(provider.creates, 0);
  const prepared = await call(f.command); assert.equal(prepared.funding.state, "REQUIRES_PAYMENT");
  for (const field of ["base_amount_minor", "poster_fee_minor", "worker_fee_minor", "poster_funding_total_minor", "worker_ref"]) {
    await assert.rejects(call({ ...f.command, [field]: 1 }), error => error.details.reason === "invalid_request");
  }
  assert.equal(prepared.funding.payment_intent_client_secret, "pi_test_secret_safe"); assert.equal(provider.creates, 1);
  const retried = await call(f.command); assert.equal(retried.funding.attempt_ref, prepared.funding.attempt_ref); assert.equal(provider.creates, 1);
  await assert.rejects(call({ operation: "status", job_ref: "job", payment_sheet_completed: true }), error => error.details.reason === "invalid_request");
  assert.equal(f.records.get("v2PublishedJobs/job").financial_state, "FUNDING_REQUIRED");
  const record = f.records.get("v2FundingObligations/job");
  provider.setStatus("succeeded"); const succeeded = provider.intent();
  succeeded.metadata.oddjobs_v2_attempt = record.attempt_id; succeeded.metadata.oddjobs_v2_snapshot = record.snapshot.snapshot_id;
  provider.retrieveIntent = async () => succeeded;
  const funded = await call({ operation: "status", job_ref: "job" });
  assert.equal(funded.funding.state, "FUNDED"); assert.equal(f.records.get("v2PublishedJobs/job").financial_state, "FUNDED");
  assert.equal(f.records.get("v2PublishedJobs/job").job_lifecycle_state, "SELECTION_PENDING_FUNDING");
  assert.equal(funded.funding.assignment_created, false); assert.equal(funded.funding.transfer_created, false);
  assert.equal(funded.funding.worker_payout_created, false); assert.equal(f.records.has("assignments/job"), false);
  const alreadyFunded = await call(f.command);
  assert.equal(alreadyFunded.funding.state, "FUNDED"); assert.equal(provider.creates, 1);
  assert.equal(publicProjection(record).payment_intent_client_secret, undefined);
});

test("deterministic pre-payment readiness failure releases the preparation lease for safe retry", async () => {
  const f = await fixture(); const provider = mockProvider(); let ready = false;
  provider.connectReady = async () => {
    if (!ready) throw new StripeFundingFailure("connect_not_ready");
    return "acct_test";
  };
  const callable = createFundingCallable({ db: f.db, auth: { getUser: async uid => ({ uid, disabled: false }) },
    providerFactory: () => provider, HttpsError, clock: () => now, standing, leaseId: () => "stable-lease" });
  await assert.rejects(callable(f.command, { auth: { uid: "poster" } }), error => error.details.reason === "connect_not_ready");
  assert.equal(f.records.get("v2FundingObligations/job").provider_lease, null); assert.equal(provider.creates, 0);
  ready = true;
  const retried = await callable(f.command, { auth: { uid: "poster" } });
  assert.equal(retried.funding.state, "REQUIRES_PAYMENT"); assert.equal(provider.creates, 1);
});

test("mismatched evidence, failures and action required remain not funded", async () => {
  for (const status of ["requires_action", "requires_payment_method", "processing", "canceled"]) {
    const f = await fixture(); const record = (await attempt(f)).record;
    record.provider_payment_intent_ref = "pi_test"; record.provider_customer_ref = "cus_test"; record.provider_livemode = false;
    f.records.set("v2FundingObligations/job", record);
    const intent = { id: "pi_test", amount: 11000, currency: "usd", customer: "cus_test", capture_method: "automatic",
      livemode: false, status, metadata: { oddjobs_v2_attempt: record.attempt_id, oddjobs_v2_snapshot: record.snapshot.snapshot_id,
        oddjobs_v2_job: "job", oddjobs_v2_selection: "selection" } };
    const result = await reconcileIntent({ db: f.db, jobRef: "job", attemptId: record.attempt_id, intent,
      evidenceSource: "AUTHORITATIVE_PROVIDER_RETRIEVAL", now });
    assert.notEqual(result.state, "FUNDED"); assert.notEqual(f.records.get("v2PublishedJobs/job").financial_state, "FUNDED");
  }
  const f = await fixture(); const record = (await attempt(f)).record;
  record.provider_payment_intent_ref = "pi_test"; record.provider_customer_ref = "cus_test"; record.provider_livemode = false;
  f.records.set("v2FundingObligations/job", record);
  const bad = { id: "pi_test", amount: 1, currency: "usd", customer: "cus_test", capture_method: "automatic", livemode: false,
    status: "succeeded", metadata: { oddjobs_v2_attempt: record.attempt_id, oddjobs_v2_snapshot: record.snapshot.snapshot_id,
      oddjobs_v2_job: "job", oddjobs_v2_selection: "selection" } };
  await assert.rejects(reconcileIntent({ db: f.db, jobRef: "job", attemptId: record.attempt_id, intent: bad,
    evidenceSource: "SIGNED_WEBHOOK", now }), error => error.reason === "provider_evidence_invalid");
  assert.equal(f.records.get("v2PublishedJobs/job").financial_state, "FUNDING_REQUIRED");
});

test("signed webhook deduplicates success and stale failure cannot demote funded", async () => {
  const f = await fixture(); const record = (await attempt(f)).record;
  record.provider_payment_intent_ref = "pi_test"; record.provider_customer_ref = "cus_test"; record.provider_livemode = false;
  f.records.set("v2FundingObligations/job", record);
  let claims = 0; let completed = 0;
  const intent = { id: "pi_test", amount: 11000, currency: "usd", customer: "cus_test", capture_method: "automatic", livemode: false,
    status: "succeeded", metadata: { oddjobs_v2_attempt: record.attempt_id, oddjobs_v2_snapshot: record.snapshot.snapshot_id,
      oddjobs_v2_job: "job", oddjobs_v2_selection: "selection" } };
  const eventRepository = { claim: async () => ++claims === 1 ? { kind: "acquired" } : { kind: "duplicate", record: { status: "processed" } },
    complete: async () => { completed++; }, fail: async () => {} };
  const handler = createFundingWebhookHandler({ stripe: { webhooks: { constructEvent: () => ({ id: "evt_test", type: "payment_intent.succeeded",
    created: 2, livemode: false, data: { object: intent } }) } }, webhookSecret: "whsec_synthetic", eventRepository, db: f.db, clock: () => now });
  await handler({ rawBody: Buffer.from("safe"), signature: "safe" }); await handler({ rawBody: Buffer.from("safe"), signature: "safe" });
  assert.equal(completed, 1); assert.equal(f.records.get("v2FundingObligations/job").state, "FUNDED");
  const stale = { ...intent, status: "requires_payment_method" };
  await reconcileIntent({ db: f.db, jobRef: "job", attemptId: record.attempt_id, intent: stale,
    evidenceSource: "SIGNED_WEBHOOK", providerEventCreated: 1, now });
  assert.equal(f.records.get("v2FundingObligations/job").state, "FUNDED");
});
test("invalid webhook signature is rejected before event persistence", async () => {
  let claimed = false;
  const handler = createFundingWebhookHandler({ stripe: { webhooks: { constructEvent: () => { throw new Error("bad signature"); } } },
    webhookSecret: "whsec_synthetic", eventRepository: { claim: async () => { claimed = true; } }, db: store().db });
  await assert.rejects(handler({ rawBody: Buffer.from("safe"), signature: "invalid" }));
  assert.equal(claimed, false);
});
