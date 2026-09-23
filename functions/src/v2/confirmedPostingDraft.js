"use strict";

const crypto = require("node:crypto");
const { commandPayloadDigest } = require("./foundation");
const { TAXONOMY_VERSION } = require("./publicationPrerequisites");
const { POLICY_VERSION, OUTCOME, evaluateTaskScopePolicy } = require("./taskScopePolicy");

// Internal backend-only draft source for the first ordinary-job path. It does
// not publish, verify the truth of poster statements, or clear unstructured
// text. A future authenticated command handler must supply actorRef from its
// verified server context, never from a request body's owner field.
const DRAFT_SCHEMA_VERSION = 1;
const COLLECTION = "v2PostingDrafts";
const CLEANING_SCOPE_KEYS = ["areas_items", "cleaning_level", "approximate_scale",
  "room_count", "supplies_responsibility", "condition_hazards"];
const CLEANING_RISK_KEYS = ["medical_or_intimate_care", "hazardous_materials",
  "pest_control", "chemical_risk", "unknown_conditions"];

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, keys) {
  return plain(value) && Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

function validRef(value) {
  return typeof value === "string" && value.trim() === value &&
    value.length > 0 && value.length <= 128 && !value.includes("/") &&
    value !== "." && value !== "..";
}

function validText(value, max, allowEmpty = false) {
  return typeof value === "string" && value.length <= max &&
    (allowEmpty || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}

function draftRefFor(actorRef, intentKey) {
  const joined = ["v2-posting-draft-1", actorRef, intentKey]
    .map((value) => `${Buffer.byteLength(value, "utf8")}:${value}`).join("");
  return crypto.createHash("sha256").update(joined).digest("hex");
}

function normalizedSubmission(submission) {
  if (!exactKeys(submission, ["task_type_id", "taxonomy_version", "title", "description",
    "additional_info", "scope", "risk_facts", "conflicting_facts",
    "additional_task_type_ids", "prohibited_scope_codes"]) ||
      submission.task_type_id !== "general_cleaning" ||
      submission.taxonomy_version !== TAXONOMY_VERSION ||
      !validText(submission.title, 160) || !validText(submission.description, 5000) ||
      !validText(submission.additional_info, 5000, true) ||
      !exactKeys(submission.scope, CLEANING_SCOPE_KEYS) ||
      !exactKeys(submission.risk_facts, CLEANING_RISK_KEYS) ||
      !Array.isArray(submission.scope.areas_items) ||
      submission.scope.areas_items.length > 20 ||
      !submission.scope.areas_items.every((value) => validText(value, 120)) ||
      !validText(submission.scope.cleaning_level, 40, true) ||
      !validText(submission.scope.approximate_scale, 120, true) ||
      !(submission.scope.room_count === null ||
        (Number.isSafeInteger(submission.scope.room_count) &&
          submission.scope.room_count >= 0 && submission.scope.room_count <= 100)) ||
      !validText(submission.scope.supplies_responsibility, 40, true) ||
      !validText(submission.scope.condition_hazards, 120, true) ||
      !CLEANING_RISK_KEYS.every((key) => validText(submission.risk_facts[key], 80, true)) ||
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

function factsForPolicy(submission, confirmedAt) {
  return { confirmation: { source: "POSTER_CONFIRMED", confirmed_at: confirmedAt,
    fact_schema_version: DRAFT_SCHEMA_VERSION }, scope: submission.scope,
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

async function confirmGeneralCleaningDraft({ db, actorRef, intentKey, expectedVersion,
  submission, now = new Date() }) {
  if (!db || typeof db.runTransaction !== "function" || !validRef(actorRef) ||
      typeof intentKey !== "string" || intentKey.trim() !== intentKey ||
      intentKey.length < 16 || intentKey.length > 200 ||
      !Number.isSafeInteger(expectedVersion) || expectedVersion < 0 ||
      !(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("DRAFT_AUTHORITY_UNAVAILABLE");
  }
  const content = normalizedSubmission(submission);
  const contentDigest = commandPayloadDigest(content);
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
        prior.content_digest === contentDigest) {
      await readCurrentConfirmedCleaningDraft(tx, db, draftRef, actorRef, prior.draft_version);
      return receipt(prior);
    }
    if ((prior ? prior.draft_version : 0) !== expectedVersion) {
      throw new Error("DRAFT_VERSION_CONFLICT");
    }
    const confirmedAt = now.toISOString();
    const policy = evaluateTaskScopePolicy({ policyVersion: POLICY_VERSION,
      taskTypeId: content.task_type_id, taxonomyVersion: content.taxonomy_version,
      confirmedFacts: factsForPolicy(content, confirmedAt) });
    const record = { record_type: "V2_CONFIRMED_POSTING_DRAFT",
      draft_ref: draftRef, owner_ref: actorRef, draft_version: expectedVersion + 1,
      schema_version: DRAFT_SCHEMA_VERSION, policy_version: POLICY_VERSION,
      task_type_id: content.task_type_id, taxonomy_version: content.taxonomy_version,
      content_digest: contentDigest,
      text_digest: commandPayloadDigest({ title: content.title,
        description: content.description, additional_info: content.additional_info }),
      title: content.title, description: content.description,
      additional_info: content.additional_info,
      confirmed_facts: factsForPolicy(content, confirmedAt),
      policy_outcome: policy.outcome, policy_reason_codes: [...policy.reason_codes],
      text_reconciliation_state: "UNRESOLVED",
      confirmed_at: confirmedAt, updated_at: now,
      created_at: prior ? prior.created_at : now };
    tx.set(ref, record);
    return receipt(record);
  });
}

async function readCurrentConfirmedCleaningDraft(tx, db, draftRef, actorRef, expectedVersion) {
  if (!tx || !db || !validRef(draftRef) || !validRef(actorRef) ||
      !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error("CONFIRMED_DRAFT_UNAVAILABLE");
  }
  const snapshot = await tx.get(db.collection(COLLECTION).doc(draftRef));
  const record = snapshot.exists ? snapshot.data() : null;
  if (!record || record.record_type !== "V2_CONFIRMED_POSTING_DRAFT" ||
      record.draft_ref !== draftRef || record.owner_ref !== actorRef ||
      record.draft_version !== expectedVersion ||
      record.schema_version !== DRAFT_SCHEMA_VERSION ||
      record.policy_version !== POLICY_VERSION ||
      record.task_type_id !== "general_cleaning" ||
      record.taxonomy_version !== TAXONOMY_VERSION ||
      record.text_reconciliation_state !== "UNRESOLVED" ||
      !validText(record.title, 160) || !validText(record.description, 5000) ||
      !validText(record.additional_info, 5000, true) ||
      record.text_digest !== commandPayloadDigest({ title: record.title,
        description: record.description, additional_info: record.additional_info }) ||
      !exactKeys(record.confirmed_facts, ["confirmation", "scope", "risk_facts",
        "conflicting_facts", "additional_task_type_ids", "prohibited_scope_codes"]) ||
      !plain(record.confirmed_facts.confirmation) ||
      record.confirmed_facts.confirmation.source !== "POSTER_CONFIRMED" ||
      record.confirmed_facts.confirmation.confirmed_at !== record.confirmed_at) {
    throw new Error("CONFIRMED_DRAFT_UNAVAILABLE");
  }
  const submission = { task_type_id: record.task_type_id,
    taxonomy_version: record.taxonomy_version, title: record.title,
    description: record.description, additional_info: record.additional_info,
    scope: record.confirmed_facts.scope, risk_facts: record.confirmed_facts.risk_facts,
    conflicting_facts: record.confirmed_facts.conflicting_facts,
    additional_task_type_ids: record.confirmed_facts.additional_task_type_ids,
    prohibited_scope_codes: record.confirmed_facts.prohibited_scope_codes };
  if (record.content_digest !== commandPayloadDigest(submission)) {
    throw new Error("CONFIRMED_DRAFT_UNAVAILABLE");
  }
  const policy = evaluateTaskScopePolicy({ policyVersion: POLICY_VERSION,
    taskTypeId: record.task_type_id, taxonomyVersion: record.taxonomy_version,
    confirmedFacts: record.confirmed_facts });
  if (policy.outcome !== record.policy_outcome ||
      JSON.stringify(policy.reason_codes) !== JSON.stringify(record.policy_reason_codes)) {
    throw new Error("CONFIRMED_DRAFT_UNAVAILABLE");
  }
  return { draft_ref: draftRef, draft_version: expectedVersion,
    owner_ref: actorRef, title: record.title, description: record.description,
    additional_info: record.additional_info, confirmed_facts: record.confirmed_facts,
    content_digest: record.content_digest, policy_outcome: policy.outcome,
    policy_version: POLICY_VERSION, text_reconciliation_state: "UNRESOLVED" };
}

module.exports = { DRAFT_SCHEMA_VERSION, confirmGeneralCleaningDraft,
  readCurrentConfirmedCleaningDraft };
