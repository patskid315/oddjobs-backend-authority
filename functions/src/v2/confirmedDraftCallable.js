"use strict";

const { confirmJobDraft, confirmGeneralCleaningDraft } = require("./confirmedPostingDraft");

/**
 * Request: { intent_key: string, expected_version: number, submission: object }.
 * Submission is the existing general_cleaning contract, not a policy decision.
 * Returns the authority's receipt: draft_ref, confirmed_posting_facts_ref,
 * draft_version, policy_outcome, policy_version, text_reconciliation_state.
 * A confirmed draft is not permission to publish.
 */
function callable({ db, HttpsError, confirm, versioned }) {
  return async (data, context) => {
    const uid = context && context.auth && context.auth.uid;
    if (typeof uid !== "string" || !uid) {
      throw new HttpsError("unauthenticated", "Sign in to confirm a draft.");
    }
    const keys = ["intent_key", "expected_version", "submission"];
    if (versioned) keys.push("task_schema_version");
    if (!data || Object.getPrototypeOf(data) !== Object.prototype ||
        Object.keys(data).length !== keys.length ||
        !keys.every((key) => Object.hasOwn(data, key)) ||
        (versioned && (!Number.isSafeInteger(data.task_schema_version) || data.task_schema_version < 1)) ||
        typeof data.intent_key !== "string" || data.intent_key.trim() !== data.intent_key ||
        data.intent_key.length < 16 || data.intent_key.length > 200 ||
        !Number.isSafeInteger(data.expected_version) || data.expected_version < 0 ||
        data.expected_version === Number.MAX_SAFE_INTEGER) {
      throw new HttpsError("invalid-argument", "Check the draft details and try again.");
    }
    try {
      return await confirm({ db, actorRef: uid, intentKey: data.intent_key,
        expectedVersion: data.expected_version, submission: data.submission,
        ...(versioned ? { taskSchemaVersion: data.task_schema_version } : {}), now: new Date() });
    } catch (error) {
      if (error && error.message === "DRAFT_INPUT_INVALID") {
        throw new HttpsError("invalid-argument", "Check the draft details and try again.");
      }
      // Never disclose persisted facts, policy internals or infrastructure errors.
      // Do not claim a save succeeded after an uncertain response.
      throw new HttpsError("failed-precondition", "This draft cannot be confirmed right now.");
    }
  };
}

function createConfirmedDraftCallable({ confirm = confirmGeneralCleaningDraft, ...options }) {
  return callable({ ...options, confirm, versioned: false });
}
// Generic API: same command identity/receipt, plus explicit task_schema_version.
// Schema selection is validated against the server registry, never client policy.
function createJobDraftCallable({ confirm = confirmJobDraft, ...options }) {
  return callable({ ...options, confirm, versioned: true });
}
module.exports = { createConfirmedDraftCallable, createJobDraftCallable };
