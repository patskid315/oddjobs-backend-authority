"use strict";
const { commandPayloadDigest: digest } = require("./foundation");
const POLICY = "hourly-funded-scope-1-minutes-1-720";
const validMinutes = n => Number.isSafeInteger(n) && n >= 1 && n <= 720;
function binding(job, selection) {
  return { job_ref: job.job_ref, job_version: job.job_version, offer_revision: digest(job.poster_offer),
    selection_ref: selection.selection_ref, selection_revision: digest([selection.selection_ref, selection.source_job_version, selection.job_version,
      selection.response_ref, selection.worker_ref, selection.command_digest, selection.selected_at, selection.policy_version, selection.state]), response_ref: selection.response_ref,
    worker_ref: selection.worker_ref, poster_ref: job.owner_ref, hourly_rate_minor_per_hour: job.poster_offer.poster_entered_amount_minor };
}
function matches(record, job, selection) {
  return record?.policy_version === POLICY && digest(record.binding) === record.binding_digest && record.binding_digest === digest(binding(job, selection)) &&
    validMinutes(record.maximum_billable_minutes) && Number.isSafeInteger(record.version) && record.version > 0;
}
function project(record) {
  return { policy_version: POLICY, proposal_version: record.version, job_ref: record.binding.job_ref,
    job_version: record.binding.job_version, selection_ref: record.binding.selection_ref,
    response_ref: record.binding.response_ref, hourly_rate_minor_per_hour: record.binding.hourly_rate_minor_per_hour,
    maximum_billable_minutes: record.maximum_billable_minutes, state: record.state };
}
async function readScope(tx, db, job, selection) {
  if (!selection) return {};
  const offer = job.poster_offer;
  const validMoney = offer?.currency === "USD" && Number.isSafeInteger(offer.poster_entered_amount_minor) && offer.poster_entered_amount_minor > 0;
  if (offer?.pricing_mode === "FIXED") return { funding_scope_ready: validMoney };
  const snap = await tx.get(db.collection("v2HourlyScopes").doc(job.job_ref));
  const record = snap.exists ? snap.data() : null;
  const current = record && matches(record, job, selection) && ["PROPOSED", "AGREED", "DECLINED"].includes(record.state);
  const agreed = current && record.state === "AGREED" && record.poster_confirmation?.actor_ref === job.owner_ref && record.poster_confirmation?.proposal_version === record.version &&
    record.worker_confirmation?.actor_ref === selection.worker_ref && record.worker_confirmation?.proposal_version === record.version;
  return { hourly_scope_revision: record?.version || 0, hourly_scope: current ? project(record) : null,
    funding_scope_ready: validMoney && offer?.pricing_mode === "HOURLY" && Boolean(agreed) };
}
async function readAgreedScope(tx, db, job, selection, fail) {
  if (job.poster_offer?.pricing_mode !== "HOURLY") return null;
  const snap = await tx.get(db.collection("v2HourlyScopes").doc(job.job_ref));
  const record = snap.exists ? snap.data() : null;
  if (!record || !matches(record, job, selection) || record.state !== "AGREED" ||
      record.poster_confirmation?.actor_ref !== job.owner_ref || record.poster_confirmation?.proposal_version !== record.version ||
      record.worker_confirmation?.actor_ref !== selection.worker_ref || record.worker_confirmation?.proposal_version !== record.version) {
    fail("hourly_scope_unavailable");
  }
  return record;
}
async function mutateScope({ tx, db, job, selection, command, uid, now, fail }) {
  const propose = command.operation === "propose_scope";
  if (!selection || (propose ? uid !== job.owner_ref : uid !== selection.worker_ref)) fail("not_permitted");
  if (job.poster_offer?.pricing_mode !== "HOURLY" || job.poster_offer.currency !== "USD" ||
      !Number.isSafeInteger(job.poster_offer.poster_entered_amount_minor) || job.poster_offer.poster_entered_amount_minor <= 0) fail("hourly_scope_unavailable");
  if (job.job_version !== command.job_version) fail("job_changed");
  if (propose && !validMinutes(command.maximum_billable_minutes)) fail("invalid_maximum_minutes");
  const root = db.collection("v2HourlyScopes").doc(job.job_ref);
  const oldSnap = await tx.get(root); const old = oldSnap.exists ? oldSnap.data() : null;
  const commandRef = root.collection("commands").doc(digest([uid, command.intent_key]));
  const replay = await tx.get(commandRef);
  if (replay.exists) {
    const prior = replay.data();
    if (prior.command_digest !== digest(command)) fail("request_conflict");
    if (!old || prior.proposal_version !== old.version || !matches(old, job, selection)) fail("stale_scope");
    return prior.result;
  }
  if (command.expected_scope_version !== (old?.version || 0)) fail("stale_scope");
  let next;
  if (propose) {
    if (old && matches(old, job, selection) && old.state === "AGREED") fail("scope_already_agreed");
    const version = (old?.version || 0) + 1;
    if (!Number.isSafeInteger(version)) fail("hourly_scope_unavailable");
    const bound = binding(job, selection);
    next = { schema_version: 1, policy_version: POLICY, version, state: "PROPOSED", binding: bound,
      binding_digest: digest(bound), maximum_billable_minutes: command.maximum_billable_minutes,
      poster_confirmation: { actor_ref: uid, confirmed_at: now.toISOString(), proposal_version: version }, worker_confirmation: null };
    if (old) tx.set(root.collection("history").doc(String(old.version)), { ...old, state: "SUPERSEDED" });
  } else {
    if (!old || !matches(old, job, selection) || old.state !== "PROPOSED") fail("stale_scope");
    next = { ...old, state: command.operation === "accept_scope" ? "AGREED" : "DECLINED",
      worker_confirmation: { actor_ref: uid, confirmed_at: now.toISOString(), proposal_version: old.version } };
  }
  tx.set(root, next);
  tx.create(commandRef, { command_digest: digest(command), proposal_version: next.version, result: project(next) });
  return project(next);
}
module.exports = { POLICY, validMinutes, readScope, readAgreedScope, mutateScope };
