"use strict";

const { confirmGeneralCleaningDraft } = require("./confirmedPostingDraft");

/**
 * Request: { intent_key: string, expected_version: number, submission: object }.
 * Submission is the existing general_cleaning contract, not a policy decision.
 * Returns the authority's receipt: draft_ref, confirmed_posting_facts_ref,
 * draft_version, policy_outcome, policy_version, text_reconciliation_state.
 * A confirmed draft is not permission to publish.
 */
function createConfirmedDraftCallable({ db, HttpsError,
  confirm = confirmGeneralCleaningDraft }) {
  return async (data, context) => {
    const uid = context && context.auth && context.auth.uid;
    if (typeof uid !== "string" || !uid) {
      throw new HttpsError("unauthenticated", "Sign in to confirm a draft.");
    }
    if (!data || Object.getPrototypeOf(data) !== Object.prototype ||
        Object.keys(data).length !== 3 ||
        !["intent_key", "expected_version", "submission"].every((key) => Object.hasOwn(data, key)) ||
        typeof data.intent_key !== "string" || data.intent_key.trim() !== data.intent_key ||
        data.intent_key.length < 16 || data.intent_key.length > 200 ||
        !Number.isSafeInteger(data.expected_version) || data.expected_version < 0) {
      throw new HttpsError("invalid-argument", "Check the draft details and try again.");
    }
    try {
      return await confirm({ db, actorRef: uid, intentKey: data.intent_key,
        expectedVersion: data.expected_version, submission: data.submission, now: new Date() });
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

module.exports = { createConfirmedDraftCallable };
