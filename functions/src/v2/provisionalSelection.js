"use strict";
const { commandPayloadDigest } = require("./foundation");
const COLLECTION = "v2ProvisionalSelections";
const POLICY = "OJNY-V2-GOV-1.0.0/provisional-selection-1";

function projection(record) {
  return { schema_version: 1, selection_ref: record.selection_ref, job_ref: record.job_ref,
    response_ref: record.response_ref, source_job_version: record.source_job_version,
    job_version: record.job_version, intent_key: record.intent_key,
    job_lifecycle_state: "SELECTION_PENDING_FUNDING", financial_state: "FUNDING_REQUIRED",
    assignment_created: false, selected_at: record.selected_at };
}
async function readSelection(tx, db, job, fail) {
  const snapshot = await tx.get(db.collection(COLLECTION).doc(job.job_ref));
  const record = snapshot.exists ? snapshot.data() : null;
  if (!record) {
    if (job.job_lifecycle_state === "SELECTION_PENDING_FUNDING") fail("job_unavailable");
    return null;
  }
  if (record.schema_version !== 1 || record.policy_version !== POLICY ||
      job.provisional_selection_ref !== record.selection_ref ||
      !Number.isSafeInteger(record.source_job_version) || record.source_job_version < 1 ||
      !Number.isFinite(Date.parse(record.selected_at)) || record.poster_ref !== job.owner_ref || record.job_ref !== job.job_ref ||
      record.job_version !== job.job_version || job.job_lifecycle_state !== "SELECTION_PENDING_FUNDING" ||
      job.financial_state !== "FUNDING_REQUIRED" || record.state !== "PROVISIONAL" ||
      record.job_version !== record.source_job_version + 1) fail("job_unavailable");
  return record;
}

// Called only inside the marketplace Firestore transaction. No financial snapshot,
// provider attempt, assignment, or permission to begin work is created here.
async function selectResponse({ tx, db, job, command, uid, now, fail, standing, validateOpenJob, responseId }) {
  if (job.owner_ref !== uid) fail("not_permitted");
  const prior = await readSelection(tx, db, job, fail);
  const digest = commandPayloadDigest(command);
  if (prior) {
    if (prior.intent_key === command.intent_key) {
      if (prior.command_digest !== digest) fail("request_conflict");
      return projection(prior);
    }
    fail("already_selected");
  }
  if (job.job_version !== command.job_version) fail("job_changed");
  if (job.financial_state !== "NOT_REQUIRED_YET" || job.job_lifecycle_version !== 2 ||
      job.financial_state_version !== 2 || !Number.isSafeInteger(job.job_version + 1)) fail("job_unavailable");
  await validateOpenJob();
  const ref = db.collection("v2PublishedJobs").doc(job.job_ref).collection("responses").doc(command.response_ref);
  const snapshot = await tx.get(ref); const response = snapshot.exists ? snapshot.data() : null;
  if (!response || response.response_ref !== command.response_ref || response.job_ref !== job.job_ref ||
      response.job_version !== job.job_version || response.status !== "SUBMITTED" ||
      typeof response.worker_ref !== "string" || response.worker_ref === uid ||
      responseId(job.job_ref, response.worker_ref) !== command.response_ref ||
      response.decision?.outcome !== "ELIGIBLE") fail("response_unavailable");
  const posterEvidence = await standing(uid);
  const workerEvidence = await standing(response.worker_ref);
  const record = { schema_version: 1, record_type: "V2_PROVISIONAL_SELECTION", state: "PROVISIONAL",
    selection_ref: commandPayloadDigest([POLICY, job.job_ref, uid, command.intent_key]),
    job_ref: job.job_ref, poster_ref: uid, worker_ref: response.worker_ref, response_ref: command.response_ref,
    source_job_version: job.job_version, job_version: job.job_version + 1, intent_key: command.intent_key,
    command_digest: digest, selected_at: now.toISOString(), policy_version: POLICY,
    standing_provenance: { poster: posterEvidence, worker: workerEvidence } };
  tx.create(db.collection(COLLECTION).doc(job.job_ref), record);
  tx.set(db.collection("v2PublishedJobs").doc(job.job_ref), { ...job, job_version: record.job_version,
    job_lifecycle_state: "SELECTION_PENDING_FUNDING", financial_state: "FUNDING_REQUIRED",
    provisional_selection_ref: record.selection_ref });
  return projection(record);
}
module.exports = { selectResponse, readSelection, selectionProjection: projection };
