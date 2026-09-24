"use strict";

const { recordProtectedNYCAddress } = require("./protectedLocationAuthority");
const { createNYCGeoclientValidator } = require("./nycGeoclientValidator");

/**
 * Request: { intent_key: string, address: { house_number: string,
 * street: string, zip_code: string, unit?: string | null } }.
 * Returns only { protected_ref, eligibility_geography } from the authority.
 * Replay the same owner-scoped intent and address after uncertain outcomes;
 * a changed address requires a new intent. No client geography is accepted.
 */
function createProtectedLocationCallable({ db, HttpsError,
  validator = createNYCGeoclientValidator() }) {
  return async (data, context) => {
    const uid = context && context.auth && context.auth.uid;
    if (typeof uid !== "string" || !uid) {
      throw new HttpsError("unauthenticated", "Sign in to validate a job address.");
    }
    const address = data && data.address;
    if (!data || Object.getPrototypeOf(data) !== Object.prototype ||
        Object.keys(data).length !== 2 ||
        !["intent_key", "address"].every((key) => Object.hasOwn(data, key)) ||
        typeof data.intent_key !== "string" || data.intent_key.trim() !== data.intent_key ||
        /[\r\n]/.test(data.intent_key) || data.intent_key.length < 16 || data.intent_key.length > 200 ||
        !address || Object.getPrototypeOf(address) !== Object.prototype ||
        Object.keys(address).some((key) => !["house_number", "street", "zip_code", "unit"].includes(key)) ||
        !["house_number", "street", "zip_code"].every((key) =>
          Object.hasOwn(address, key) && typeof address[key] === "string") ||
        (Object.hasOwn(address, "unit") && address.unit !== null && typeof address.unit !== "string")) {
      throw new HttpsError("invalid-argument", "Check the address details and try again.");
    }
    try {
      return await recordProtectedNYCAddress({ db, authenticatedOwnerRef: uid,
        intentKey: data.intent_key, address, validator, now: new Date() });
    } catch (error) {
      if (error && error.message === "LOCATION_INPUT_INVALID") {
        throw new HttpsError("invalid-argument", "Check the address details and try again.");
      }
      // Conflicts, unresolved matches and unavailable authority remain failures.
      // Never disclose protected records, provider errors, addresses or secrets,
      // and never claim persistence succeeded after an uncertain response.
      throw new HttpsError("failed-precondition", "This address cannot be validated right now.");
    }
  };
}

module.exports = { createProtectedLocationCallable };
