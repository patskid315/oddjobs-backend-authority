"use strict";

const crypto = require("node:crypto");
const { verifyScopeReview } = require("./scopeReview");
const { commandPayloadDigest } = require("./foundation");
const { TAXONOMY_VERSION } = require("./publicationPrerequisites");
const { POLICY_VERSION, OUTCOME, evaluateTaskScopePolicy } = require("./taskScopePolicy");

const { plain, exactKeys, validText } = require("./confirmedFactValidation");
const { taskValidator } = require("./taskValidatorRegistry");

// Shared authenticated confirmation authority. Publication remains a separate
// command. No caller-supplied policy, source stamp, or derived version is trusted.
const DRAFT_SCHEMA_VERSION = 3;
const REVIEWED_DRAFT_SCHEMA_VERSION = 4;
const COLLECTION = "v2PostingDrafts";

function validRef(value) {
  return typeof value === "string" && value.trim() === value &&
    value.length > 0 && value.length <= 128 && !value.includes("/") &&
    value !== "." && value !== "..";
}

function validSchedule(window, duration) {
  return exactKeys(window, ["start_at", "end_at", "time_zone"]) &&
    validText(window.start_at, 40) && validText(window.end_at, 40) &&
    window.time_zone === "America/New_York" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(window.start_at) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(window.end_at) &&
    Number.isFinite(Date.parse(window.start_at)) &&
    Date.parse(window.end_at) - Date.parse(window.start_at) === duration * 60_000;
}

function draftRefFor(actorRef, intentKey) {
  const joined = ["v2-posting-draft-1", actorRef, intentKey]
    .map((value) => `${Buffer.byteLength(value, "utf8")}:${value}`).join("");
  return crypto.createHash("sha256").update(joined).digest("hex");
}

function normalizedSubmission(submission, validator) {
  if (!exactKeys(submission, ["task_type_id", "taxonomy_version", "title", "description",
    "additional_info", "duration_minutes", "schedule_window", "scope", "risk_facts", "conflicting_facts",
    "additional_task_type_ids", "prohibited_scope_codes"]) ||
      !validator || submission.task_type_id !== validator.taskTypeId ||
      submission.taxonomy_version !== TAXONOMY_VERSION ||
      !validText(submission.title, 160) || !validText(submission.description, 5000) ||
      !validText(submission.additional_info, 5000, true) ||
      !Number.isSafeInteger(submission.duration_minutes) ||
      submission.duration_minutes < 30 || submission.duration_minutes > 720 ||
      !validSchedule(submission.schedule_window, submission.duration_minutes) ||
      !validator.validShape(submission.scope, submission.risk_facts) ||
      ![submission.conflicting_facts, submission.additional_task_type_ids,
        submission.prohibited_scope_codes].every((values) => Array.isArray(values) &&
          values.length <= 20 && values.every((value) => validText(value, 120)))) {
    throw new Error("DRAFT_INPUT_INVALID");
  }
  // Copy through JSON-only canonical serialization; no prototypes, undefined,
  // timestamps, or caller-owned object references can be persisted as facts.
  commandPayloadDigest(submission);
  if (Buffer.byteLength(JSON.stringify(submission), "utf8") > 16_384) {
    throw new Error("DRAFT_INPUT_INVALID");
  }
  const clone = JSON.parse(JSON.stringify(submission));
  return clone;
}

function factsForPolicy(submission, confirmedAt, schemaVersion) {
  return { confirmation: { source: "POSTER_CONFIRMED", confirmed_at: confirmedAt,
    fact_schema_version: schemaVersion }, scope: submission.scope,
  risk_facts: submission.risk_facts, conflicting_facts: submission.conflicting_facts,
  additional_task_type_ids: submission.additional_task_type_ids,
  prohibited_scope_codes: submission.prohibited_scope_codes };
}

function receipt(record) {
  return Object.freeze({ draft_ref: record.draft_ref,
    confirmed_posting_facts_ref: record.draft_ref,
    draft_version: record.draft_version, policy_outcome: record.policy_outcome,
    policy_version: record.policy_version,
    text_reconciliation_state: record.text_reconciliation_state });
}

async function confirmJobDraft({ db, actorRef, intentKey, expectedVersion,
  submission, taskSchemaVersion, confirmationContractVersion, scopeReview, now = new Date() }) {
  if (!db || typeof db.runTransaction !== "function" || !validRef(actorRef) ||
      typeof intentKey !== "string" || intentKey.trim() !== intentKey ||
      intentKey.length < 16 || intentKey.length > 200 ||
      !Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || expectedVersion === Number.MAX_SAFE_INTEGER ||
      !(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("DRAFT_AUTHORITY_UNAVAILABLE");
  }
  let validator = taskValidator(submission && submission.task_type_id,
    submission && submission.taxonomy_version, taskSchemaVersion);
  // Schema 1 is retained only to verify/replay existing persisted records.
  if (!validator || !validator.acceptsConfirmation) throw new Error("DRAFT_INPUT_INVALID");
  const content = normalizedSubmission(submission, validator);
  const reviewed = confirmationContractVersion !== undefined;
  if (reviewed) {
    if (confirmationContractVersion !== 2 || content.task_type_id !== "general_cleaning") throw new Error("DRAFT_INPUT_INVALID");
    verifyScopeReview(content.scope, scopeReview);
    validator = taskValidator(content.task_type_id, content.taxonomy_version, taskSchemaVersion, "cleaning-text-6");
    if (!validator) throw new Error("DRAFT_INPUT_INVALID");
  } else if (scopeReview !== undefined) throw new Error("DRAFT_INPUT_INVALID");
  const reviewFields = reviewed ? { confirmation_contract_version: 2, scope_review: JSON.parse(JSON.stringify(scopeReview)) } : {};
  const contentDigest = commandPayloadDigest(content);
  const requestDigest = commandPayloadDigest({ task_schema_version: taskSchemaVersion, submission: content, ...reviewFields });
  const draftRef = draftRefFor(actorRef, intentKey);
  const ref = db.collection(COLLECTION).doc(draftRef);
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const prior = snapshot.exists ? snapshot.data() : null;
    if (prior && (prior.record_type !== "V2_CONFIRMED_POSTING_DRAFT" ||
        prior.owner_ref !== actorRef || prior.draft_ref !== draftRef ||
        !Number.isSafeInteger(prior.draft_version) || prior.draft_version < 1)) {
      throw new Error("DRAFT_VERSION_CONFLICT");
    }
    if (prior && prior.draft_version === expectedVersion + 1 &&
        prior.content_digest === contentDigest &&
        ((prior.schema_version === 2 && !reviewed) || prior.request_digest === requestDigest)) {
      await readCurrentConfirmedDraft(tx, db, draftRef, actorRef, prior.draft_version);
      return receipt(prior);
    }
    if ((prior ? prior.draft_version : 0) !== expectedVersion) {
      throw new Error("DRAFT_VERSION_CONFLICT");
    }
    if (Date.parse(content.schedule_window.end_at) <= now.getTime()) {
      throw new Error("DRAFT_SCHEDULE_EXPIRED");
    }
    const confirmedAt = now.toISOString();
    const policy = evaluateTaskScopePolicy({ policyVersion: POLICY_VERSION,
      taskTypeId: content.task_type_id, taxonomyVersion: content.taxonomy_version,
      confirmedFacts: factsForPolicy(content, confirmedAt, validator.schemaVersion) });
    const record = { record_type: "V2_CONFIRMED_POSTING_DRAFT",
      draft_ref: draftRef, owner_ref: actorRef, draft_version: expectedVersion + 1,
      schema_version: reviewed ? REVIEWED_DRAFT_SCHEMA_VERSION : DRAFT_SCHEMA_VERSION, ...reviewFields, policy_version: POLICY_VERSION,
      task_validator_version: validator.validatorVersion,
      text_rule_version: validator.textRuleVersion,
      task_type_id: content.task_type_id, taxonomy_version: content.taxonomy_version,
      content_digest: contentDigest,
      request_digest: requestDigest,
      text_digest: commandPayloadDigest({ title: content.title,
        description: content.description, additional_info: content.additional_info }),
      title: content.title, description: content.description,
      additional_info: content.additional_info,
      duration_minutes: content.duration_minutes,
      schedule_window: content.schedule_window,
      confirmed_facts: factsForPolicy(content, confirmedAt, validator.schemaVersion),
      policy_outcome: policy.outcome, policy_reason_codes: [...policy.reason_codes],
      text_reconciliation_state: policy.outcome === OUTCOME.SUPPORTED &&
        validator.reconciledText(content, reviewFields) ? "CLEARED_EXACT_TEMPLATE_V1" : "UNRESOLVED",
      confirmed_at: confirmedAt, updated_at: now,
      created_at: prior ? prior.created_at : now };
    tx.set(ref, record);
    return receipt(record);
  });
}

async function readCurrentConfirmedDraft(tx, db, draftRef, actorRef, expectedVersion) {
  if (!tx || !db || !validRef(draftRef) || !validRef(actorRef) ||
      !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error("CONFIRMED_DRAFT_UNAVAILABLE");
  }
  const snapshot = await tx.get(db.collection(COLLECTION).doc(draftRef));
  const record = snapshot.exists ? snapshot.data() : null;
  if (!record || record.record_type !== "V2_CONFIRMED_POSTING_DRAFT" ||
      record.draft_ref !== draftRef || record.owner_ref !== actorRef ||
      record.draft_version !== expectedVersion ||
      ![2, DRAFT_SCHEMA_VERSION, REVIEWED_DRAFT_SCHEMA_VERSION].includes(record.schema_version) ||
      record.policy_version !== POLICY_VERSION ||
      record.taxonomy_version !== TAXONOMY_VERSION ||
      !["UNRESOLVED", "CLEARED_EXACT_TEMPLATE_V1"].includes(record.text_reconciliation_state) ||
      !validText(record.title, 160) || !validText(record.description, 5000) ||
      !validText(record.additional_info, 5000, true) ||
      !Number.isSafeInteger(record.duration_minutes) ||
      record.duration_minutes < 30 || record.duration_minutes > 720 ||
      !validSchedule(record.schedule_window, record.duration_minutes) ||
      record.text_digest !== commandPayloadDigest({ title: record.title,
        description: record.description, additional_info: record.additional_info }) ||
      !exactKeys(record.confirmed_facts, ["confirmation", "scope", "risk_facts",
        "conflicting_facts", "additional_task_type_ids", "prohibited_scope_codes"]) ||
      !plain(record.confirmed_facts.confirmation) ||
      record.confirmed_facts.confirmation.source !== "POSTER_CONFIRMED" ||
      record.confirmed_facts.confirmation.confirmed_at !== record.confirmed_at) {
    throw new Error("CONFIRMED_DRAFT_UNAVAILABLE");
  }
  const validator = taskValidator(record.task_type_id, record.taxonomy_version,
    record.confirmed_facts.confirmation.fact_schema_version,
    record.schema_version === 2 ? "cleaning-text-1" : record.text_rule_version);
  if (!validator || (record.text_rule_version === "cleaning-text-6" && record.schema_version !== REVIEWED_DRAFT_SCHEMA_VERSION) ||
      (record.schema_version === 2 ? validator.schemaVersion !== 1 :
    !validator.acceptsConfirmation || record.task_validator_version !== validator.validatorVersion ||
    record.text_rule_version !== validator.textRuleVersion)) throw new Error("CONFIRMED_DRAFT_UNAVAILABLE");
  const submission = { task_type_id: record.task_type_id,
    taxonomy_version: record.taxonomy_version, title: record.title,
    description: record.description, additional_info: record.additional_info,
    duration_minutes: record.duration_minutes, schedule_window: record.schedule_window,
    scope: record.confirmed_facts.scope, risk_facts: record.confirmed_facts.risk_facts,
    conflicting_facts: record.confirmed_facts.conflicting_facts,
    additional_task_type_ids: record.confirmed_facts.additional_task_type_ids,
    prohibited_scope_codes: record.confirmed_facts.prohibited_scope_codes };
  try { normalizedSubmission(submission, validator); }
  catch { throw new Error("CONFIRMED_DRAFT_UNAVAILABLE"); }
  let reviewFields = {};
  if (record.schema_version === REVIEWED_DRAFT_SCHEMA_VERSION) {
    try {
      if (record.confirmation_contract_version !== 2) throw new Error();
      verifyScopeReview(submission.scope, record.scope_review);
      reviewFields = { confirmation_contract_version: 2, scope_review: record.scope_review };
    } catch { throw new Error("CONFIRMED_DRAFT_UNAVAILABLE"); }
  } else if (record.scope_review !== undefined || record.confirmation_contract_version !== undefined) {
    throw new Error("CONFIRMED_DRAFT_UNAVAILABLE");
  }
  if (record.content_digest !== commandPayloadDigest(submission) ||
      record.schema_version >= DRAFT_SCHEMA_VERSION && record.request_digest !==
        commandPayloadDigest({ task_schema_version: validator.schemaVersion, submission, ...reviewFields })) {
    throw new Error("CONFIRMED_DRAFT_UNAVAILABLE");
  }
  const policy = evaluateTaskScopePolicy({ policyVersion: POLICY_VERSION,
    taskTypeId: record.task_type_id, taxonomyVersion: record.taxonomy_version,
    confirmedFacts: record.confirmed_facts });
  if (policy.outcome !== record.policy_outcome ||
      JSON.stringify(policy.reason_codes) !== JSON.stringify(record.policy_reason_codes) ||
      record.text_reconciliation_state !== (policy.outcome === OUTCOME.SUPPORTED &&
        validator.reconciledText(submission, reviewFields) ? "CLEARED_EXACT_TEMPLATE_V1" : "UNRESOLVED")) {
    throw new Error("CONFIRMED_DRAFT_UNAVAILABLE");
  }
  return { draft_ref: draftRef, draft_version: expectedVersion,
    owner_ref: actorRef, task_type_id: record.task_type_id, title: record.title, description: record.description,
    additional_info: record.additional_info,
    duration_minutes: record.duration_minutes, schedule_window: record.schedule_window,
    confirmed_facts: record.confirmed_facts,
    content_digest: record.content_digest, policy_outcome: policy.outcome,
    policy_version: POLICY_VERSION,
    text_reconciliation_state: record.text_reconciliation_state };
}

// Compatibility adapters for the existing cleaning callable and T01 reader.
// The legacy clearance token remains a wire token for deterministic template
// reconciliation; persisted validator/text-rule versions identify the grammar.
function confirmGeneralCleaningDraft(args) {
  if (!args || !args.submission || args.submission.task_type_id !== "general_cleaning") {
    throw new Error("DRAFT_INPUT_INVALID");
  }
  return confirmJobDraft({ ...args, taskSchemaVersion: 2 });
}
async function readCurrentConfirmedCleaningDraft(...args) {
  const record = await readCurrentConfirmedDraft(...args);
  if (record.task_type_id !== "general_cleaning") throw new Error("CONFIRMED_DRAFT_UNAVAILABLE");
  return record;
}
module.exports = { DRAFT_SCHEMA_VERSION, confirmJobDraft, confirmGeneralCleaningDraft,
  readCurrentConfirmedDraft, readCurrentConfirmedCleaningDraft };
