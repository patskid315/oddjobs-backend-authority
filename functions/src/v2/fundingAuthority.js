"use strict";

const { commandPayloadDigest: digest } = require("./foundation");
const { readSelection } = require("./provisionalSelection");
const { readAgreedScope, POLICY: SCOPE_POLICY, validMinutes } = require("./hourlyFundedScope");

const ECONOMIC_POLICY = "ORDINARY_V2_USD_10_5_V1";
const ROUNDING_POLICY = "ORDINARY_V2_USD_HALF_UP_V1";
const FUNDING_POLICY = "ordinary-v2-funding-1";
const COLLECTION = "v2FundingObligations";
const safeId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

class FundingFailure extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
const defaultFail = reason => { throw new FundingFailure(reason); };

function minor(value, divisor, half, allowZero = true) {
  const result = (BigInt(value) + BigInt(half)) / BigInt(divisor);
  if ((!allowZero && result <= 0n) || result < 0n || result > BigInt(Number.MAX_SAFE_INTEGER)) defaultFail("monetary_snapshot_invalid");
  return Number(result);
}

function money(base, pricingMode, minutes = null) {
  if (!Number.isSafeInteger(base) || base <= 0 || !["FIXED", "HOURLY"].includes(pricingMode)) defaultFail("monetary_snapshot_invalid");
  const baseAmount = pricingMode === "FIXED" ? base : (() => {
    if (!validMinutes(minutes)) defaultFail("hourly_scope_unavailable");
    return minor(BigInt(base) * BigInt(minutes) + 30n, 60, 0, false);
  })();
  const posterFee = minor(BigInt(baseAmount) * 1000n + 5000n, 10000, 0);
  const workerFee = minor(BigInt(baseAmount) * 500n + 5000n, 10000, 0);
  const total = baseAmount + posterFee;
  const payout = baseAmount - workerFee;
  if (!Number.isSafeInteger(total) || payout <= 0 || !Number.isSafeInteger(payout)) defaultFail("monetary_snapshot_invalid");
  return { base_amount_minor: baseAmount, poster_fee_minor: posterFee, poster_funding_total_minor: total,
    worker_fee_minor: workerFee, worker_payout_basis_minor: payout,
    gross_platform_amount_minor: posterFee + workerFee, currency: "USD" };
}

function selectionRevision(selection) {
  return digest([selection.selection_ref, selection.source_job_version, selection.job_version, selection.response_ref,
    selection.worker_ref, selection.command_digest, selection.selected_at, selection.policy_version, selection.state]);
}

function publicProjection(record, clientSecret = undefined) {
  const projection = { schema_version: 1, attempt_ref: record.attempt_id, job_ref: record.job_ref,
    job_version: record.job_version, state: record.state, financial_state: record.financial_state,
    pricing_mode: record.snapshot.pricing_mode, base_amount_minor: record.snapshot.base_amount_minor,
    poster_fee_minor: record.snapshot.poster_fee_minor,
    poster_funding_total_minor: record.snapshot.poster_funding_total_minor,
    currency: "USD", funded: record.state === "FUNDED", assignment_created: false,
    work_authorized: false, transfer_created: false, worker_payout_created: false };
  if (record.snapshot.maximum_billable_minutes != null) projection.maximum_billable_minutes = record.snapshot.maximum_billable_minutes;
  if (clientSecret !== undefined) projection.payment_intent_client_secret = clientSecret;
  return projection;
}

async function buildBinding(tx, db, job, selection, fail = defaultFail) {
  const responseSnap = await tx.get(db.collection("v2PublishedJobs").doc(job.job_ref).collection("responses").doc(selection.response_ref));
  const response = responseSnap.exists ? responseSnap.data() : null;
  if (!response || response.status !== "SUBMITTED" || response.job_ref !== job.job_ref ||
      response.response_ref !== selection.response_ref || response.worker_ref !== selection.worker_ref ||
      response.job_version !== selection.source_job_version || response.decision?.outcome !== "ELIGIBLE") fail("worker_or_request_mismatch");
  const pricingMode = job.poster_offer?.pricing_mode;
  const rate = job.poster_offer?.poster_entered_amount_minor;
  if (job.poster_offer?.currency !== "USD" || !Number.isSafeInteger(rate) || rate <= 0) fail("monetary_snapshot_invalid");
  let scope = null;
  if (pricingMode === "HOURLY") scope = await readAgreedScope(tx, db, job, selection, fail);
  else if (pricingMode !== "FIXED") fail("monetary_snapshot_invalid");
  const amounts = money(rate, pricingMode, scope?.maximum_billable_minutes);
  const binding = { job_ref: job.job_ref, job_version: job.job_version, poster_ref: job.owner_ref,
    selection_ref: selection.selection_ref, selection_revision: selectionRevision(selection),
    response_ref: selection.response_ref, worker_ref: selection.worker_ref,
    offer_revision: digest(job.poster_offer), pricing_mode: pricingMode,
    authoritative_amount_minor: rate,
    ...(scope ? { hourly_scope_policy: SCOPE_POLICY, hourly_scope_version: scope.version,
      hourly_scope_digest: digest(scope), maximum_billable_minutes: scope.maximum_billable_minutes } : {}) };
  const snapshot = { snapshot_id: digest([FUNDING_POLICY, binding, amounts]), ...binding, ...amounts,
    economic_policy_version: ECONOMIC_POLICY, rounding_policy_version: ROUNDING_POLICY,
    authorized_adjustments: [], tax_treatment_ref: null, immutable: true, backend_derived: true };
  return { binding, snapshot };
}

function providerKey(attemptId) { return `oddjobs:v2:funding:${attemptId}`; }

async function createOrReuseAttempt({ db, uid, command, now, validateStanding, fail = defaultFail }) {
  return db.runTransaction(async tx => {
    const jobRef = db.collection("v2PublishedJobs").doc(command.job_ref);
    const jobSnap = await tx.get(jobRef); const job = jobSnap.exists ? jobSnap.data() : null;
    if (!job || job.record_type !== "V2_ORDINARY_PUBLISHED_JOB" || job.owner_ref !== uid) fail(job ? "not_permitted" : "job_not_actionable");
    if (job.job_lifecycle_state !== "SELECTION_PENDING_FUNDING" || !["FUNDING_REQUIRED", "PROCESSING", "UNKNOWN", "FUNDED"].includes(job.financial_state)) fail("job_not_actionable");
    if (job.task_type_id !== "general_cleaning" || !Number.isFinite(Date.parse(job.schedule_window?.end_at)) ||
        Date.parse(job.schedule_window.end_at) <= now.getTime()) fail("job_not_actionable");
    if (job.job_version !== command.job_version) fail("job_version_mismatch");
    const selection = await readSelection(tx, db, job, fail);
    if (!selection) fail("worker_or_request_mismatch");
    await validateStanding(tx, uid, now); await validateStanding(tx, selection.worker_ref, now);
    const { binding, snapshot } = await buildBinding(tx, db, job, selection, fail);
    const root = db.collection(COLLECTION).doc(job.job_ref);
    const existingSnap = await tx.get(root); const existing = existingSnap.exists ? existingSnap.data() : null;
    const commandRef = root.collection("commands").doc(digest([uid, command.operation, command.intent_key]));
    const receiptSnap = await tx.get(commandRef); const receipt = receiptSnap.exists ? receiptSnap.data() : null;
    const commandDigest = digest(command);
    if (receipt && receipt.command_digest !== commandDigest) fail("request_conflict");
    if (existing) {
      if (existing.binding_digest !== digest(binding) || existing.snapshot.snapshot_id !== snapshot.snapshot_id) fail("competing_live_obligation");
      if (!receipt) tx.create(commandRef, { command_digest: commandDigest, attempt_id: existing.attempt_id, created_at: now.toISOString() });
      return { record: existing, selection, job };
    }
    if (job.financial_state !== "FUNDING_REQUIRED") fail("job_not_actionable");
    const attemptId = digest([FUNDING_POLICY, job.job_ref, snapshot.snapshot_id]);
    const record = { schema_version: 1, record_type: "ORDINARY_JOB_FUNDING_ATTEMPT", policy_version: FUNDING_POLICY,
      attempt_id: attemptId, job_ref: job.job_ref, job_version: job.job_version, poster_ref: uid,
      binding, binding_digest: digest(binding), snapshot, provider: "STRIPE", capture_method: "AUTOMATIC",
      provider_idempotency_key: providerKey(attemptId), provider_payment_intent_ref: null,
      provider_customer_ref: null, connect_account_ref: null, provider_livemode: null,
      state: "PREPARING", financial_state: "FUNDING_REQUIRED",
      attempt_outcome: null, funding_evidence_source: null, payment_sheet_completion_authoritative: false,
      one_live_obligation_enforced: true, replacement_locked: true, created_at: now.toISOString(), updated_at: now.toISOString(),
      backend_authoritative: true };
    tx.create(root, record);
    tx.create(commandRef, { command_digest: commandDigest, attempt_id: attemptId, created_at: now.toISOString() });
    return { record, selection, job };
  });
}

function validateProviderIntent(record, intent, fail = defaultFail) {
  const metadata = intent?.metadata || {};
  if (!intent || intent.id !== record.provider_payment_intent_ref || intent.amount !== record.snapshot.poster_funding_total_minor ||
      intent.currency !== "usd" || intent.customer !== record.provider_customer_ref || intent.capture_method !== "automatic" ||
      metadata.oddjobs_v2_attempt !== record.attempt_id || metadata.oddjobs_v2_snapshot !== record.snapshot.snapshot_id ||
      metadata.oddjobs_v2_job !== record.job_ref || metadata.oddjobs_v2_selection !== record.binding.selection_ref ||
      intent.livemode !== record.provider_livemode) fail("provider_evidence_invalid");
}

function mapProviderState(status) {
  if (status === "succeeded") return { state: "FUNDED", financial: "FUNDED", outcome: null };
  if (status === "processing") return { state: "PROCESSING", financial: "PROCESSING", outcome: null };
  if (status === "requires_action") return { state: "ACTION_REQUIRED", financial: "FUNDING_REQUIRED", outcome: null };
  if (status === "requires_payment_method") return { state: "REQUIRES_PAYMENT", financial: "FUNDING_REQUIRED", outcome: null };
  if (status === "canceled") return { state: "FAILED", financial: "FUNDING_REQUIRED", outcome: "FAILED" };
  return { state: "UNKNOWN", financial: "UNKNOWN", outcome: null };
}

async function attachProviderIntent({ db, jobRef, attemptId, customerRef, connectRef, providerLivemode, intent, now, fail = defaultFail }) {
  return db.runTransaction(async tx => {
    const ref = db.collection(COLLECTION).doc(jobRef); const snap = await tx.get(ref); const record = snap.exists ? snap.data() : null;
    if (!record || record.attempt_id !== attemptId) fail("funding_unavailable");
    const attached = { ...record, provider_payment_intent_ref: intent.id, provider_customer_ref: customerRef,
      connect_account_ref: connectRef, provider_livemode: providerLivemode };
    validateProviderIntent(attached, intent, fail);
    const mapped = mapProviderState(intent.status);
    const next = { ...attached, state: mapped.state, financial_state: mapped.financial, attempt_outcome: mapped.outcome,
      provider_lease: null, updated_at: now.toISOString() };
    tx.set(ref, next); return next;
  });
}

async function markUnknown({ db, jobRef, attemptId, now }) {
  return db.runTransaction(async tx => {
    const ref = db.collection(COLLECTION).doc(jobRef); const snap = await tx.get(ref); const record = snap.exists ? snap.data() : null;
    if (!record || record.attempt_id !== attemptId || record.state === "FUNDED") return record;
    const jobRefDoc = db.collection("v2PublishedJobs").doc(jobRef); const jobSnap = await tx.get(jobRefDoc);
    const next = { ...record, state: "UNKNOWN", financial_state: "UNKNOWN", provider_lease: null, updated_at: now.toISOString() };
    tx.set(ref, next);
    if (jobSnap.exists) tx.set(jobRefDoc, { ...jobSnap.data(), financial_state: "UNKNOWN" });
    return next;
  });
}

async function claimPreparation({ db, jobRef, attemptId, leaseId, now, leaseMs = 120000, fail = defaultFail }) {
  return db.runTransaction(async tx => {
    const ref = db.collection(COLLECTION).doc(jobRef); const snap = await tx.get(ref); const record = snap.exists ? snap.data() : null;
    if (!record || record.attempt_id !== attemptId) fail("funding_unavailable");
    const active = record.provider_lease && Date.parse(record.provider_lease.expires_at) > now.getTime();
    if (active && record.provider_lease.lease_id !== leaseId) return { acquired: false, record };
    const next = { ...record, provider_lease: { lease_id: leaseId, expires_at: new Date(now.getTime() + leaseMs).toISOString() }, updated_at: now.toISOString() };
    tx.set(ref, next); return { acquired: true, record: next };
  });
}

async function releasePreparation({ db, jobRef, attemptId, leaseId, now }) {
  return db.runTransaction(async tx => {
    const ref = db.collection(COLLECTION).doc(jobRef); const snap = await tx.get(ref); const record = snap.exists ? snap.data() : null;
    if (!record || record.attempt_id !== attemptId || record.provider_lease?.lease_id !== leaseId || record.state === "FUNDED") return record;
    const next = { ...record, provider_lease: null, updated_at: now.toISOString() };
    tx.set(ref, next); return next;
  });
}

async function reconcileIntent({ db, jobRef, attemptId, intent, evidenceSource, providerEventCreated = 0, now, fail = defaultFail }) {
  return db.runTransaction(async tx => {
    const ref = db.collection(COLLECTION).doc(jobRef); const snap = await tx.get(ref); const record = snap.exists ? snap.data() : null;
    if (!record || record.attempt_id !== attemptId) fail("provider_evidence_invalid");
    validateProviderIntent(record, intent, fail);
    if (record.state === "FUNDED") return record;
    if (Number.isSafeInteger(record.last_provider_event_created) && providerEventCreated && providerEventCreated < record.last_provider_event_created) return record;
    const jobRefDoc = db.collection("v2PublishedJobs").doc(jobRef); const jobSnap = await tx.get(jobRefDoc); const job = jobSnap.exists ? jobSnap.data() : null;
    if (!job || job.job_version !== record.job_version || job.owner_ref !== record.poster_ref || job.provisional_selection_ref !== record.binding.selection_ref ||
        job.job_lifecycle_state !== "SELECTION_PENDING_FUNDING") fail("provider_evidence_invalid");
    const mapped = mapProviderState(intent.status);
    const next = { ...record, state: mapped.state, financial_state: mapped.financial, attempt_outcome: mapped.outcome,
      funding_evidence_source: mapped.state === "FUNDED" ? evidenceSource : null,
      last_provider_event_created: providerEventCreated || record.last_provider_event_created || 0, updated_at: now.toISOString() };
    tx.set(ref, next);
    tx.set(jobRefDoc, { ...job, financial_state: mapped.financial });
    return next;
  });
}

module.exports = { COLLECTION, ECONOMIC_POLICY, ROUNDING_POLICY, FUNDING_POLICY, FundingFailure, money,
  buildBinding, publicProjection, createOrReuseAttempt, attachProviderIntent, markUnknown, reconcileIntent,
  claimPreparation, releasePreparation, validateProviderIntent, mapProviderState };
