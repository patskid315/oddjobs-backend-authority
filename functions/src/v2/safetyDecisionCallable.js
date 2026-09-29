"use strict";

const { recordSafetyDecision } = require("./standingSafetyAuthority");
const CONFIG_NAME = "ODDJOBS_V2_SAFETY_OPERATOR_UIDS_JSON";
const validId = (value) => typeof value === "string" && value.length > 0 &&
  value.length <= 128 && value.trim() === value && !/[\/\u0000-\u001f\u007f]/.test(value) &&
  value !== "." && value !== "..";

// No coercion, trimming, partial acceptance, wildcard or legacy-role fallback.
function authorizedByConfiguration(raw, uid) {
  if (typeof raw !== "string" || !validId(uid)) return false;
  try {
    const values = JSON.parse(raw);
    return Array.isArray(values) && values.length > 0 && values.every(validId) &&
      new Set(values).size === values.length && values.includes(uid);
  } catch (_) { return false; }
}

function createSafetyDecisionCallable({ db, HttpsError,
  getOperatorConfiguration = () => process.env[CONFIG_NAME], clock = () => new Date() }) {
  return async (data, context) => {
    const operatorRef = context && context.auth && context.auth.uid;
    if (!validId(operatorRef)) throw new HttpsError("unauthenticated", "Sign in to continue.");
    const authorizeSafetyOperator = async (uid) => {
      try { return uid === operatorRef && authorizedByConfiguration(getOperatorConfiguration(), uid); }
      catch (_) { return false; }
    };
    if (!await authorizeSafetyOperator(operatorRef)) {
      throw new HttpsError("permission-denied", "This operation is not permitted.");
    }
    const keys = ["subject_ref", "state", "reason_code", "expected_version", "valid_until"];
    if (!data || Object.getPrototypeOf(data) !== Object.prototype ||
        Object.keys(data).length !== keys.length || !keys.every((key) => Object.hasOwn(data, key)) ||
        !validId(data.subject_ref) || !validId(data.reason_code) ||
        !Number.isSafeInteger(data.expected_version) || data.expected_version < 0 ||
        data.expected_version === Number.MAX_SAFE_INTEGER ||
        typeof data.valid_until !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.valid_until)) {
      throw new HttpsError("invalid-argument", "Check the request and try again.");
    }
    if (data.subject_ref === operatorRef) {
      throw new HttpsError("permission-denied", "This operation is not permitted.");
    }
    const validUntil = new Date(data.valid_until);
    if (!Number.isFinite(validUntil.getTime()) || validUntil.toISOString() !== data.valid_until) {
      throw new HttpsError("invalid-argument", "Check the request and try again.");
    }
    try {
      // State, expiry, optimistic concurrency and both writes remain owned by
      // the existing authority. It invokes the verifier again before writing.
      return await recordSafetyDecision({ db, operatorRef, subjectRef: data.subject_ref,
        state: data.state, reasonCode: data.reason_code, expectedVersion: data.expected_version,
        validUntil, authorizeSafetyOperator, now: clock() });
    } catch (_) {
      // Includes conflicts and uncertain infrastructure outcomes; no internals.
      throw new HttpsError("failed-precondition", "The decision could not be confirmed.");
    }
  };
}

module.exports = { CONFIG_NAME, authorizedByConfiguration, createSafetyDecisionCallable };
