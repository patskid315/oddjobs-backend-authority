"use strict";

const { ProtectedLocationFailure, publicDetail } = require("./protectedLocationErrors");
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
        Object.keys(address).some((key) => !["house_number", "street", "zip_code", "unit"].includes(key))) {
      throw new HttpsError("invalid-argument", "Check the request and try again.", publicDetail(new ProtectedLocationFailure("unknown")));
    }
    if (!["house_number", "street", "zip_code"].every((key) =>
          Object.hasOwn(address, key) && typeof address[key] === "string") ||
        (Object.hasOwn(address, "unit") && address.unit !== null && typeof address.unit !== "string")) {
      throw new HttpsError("invalid-argument", "Check the address details and try again.", publicDetail(new ProtectedLocationFailure("invalid_address_input")));
    }
    try {
      return await recordProtectedNYCAddress({ db, authenticatedOwnerRef: uid,
        intentKey: data.intent_key, address, validator, now: new Date() });
    } catch (error) {
      // Authenticated poster-only advisory result; never a location receipt or write.
      if (error instanceof ProtectedLocationFailure && error.reason === "address_not_resolved" && error.correction) {
        const c = error.correction;
        if (Object.keys(c).sort().join(",") === "house_number,street,zip_code" &&
            typeof c.house_number === "string" && /^\d+(?:-\d+)?[A-Z]?$/.test(c.house_number) && c.house_number.length <= 24 &&
            typeof c.street === "string" && c.street.length > 0 && c.street.length <= 160 &&
            c.street.trim() === c.street && !/[\u0000-\u001f\u007f]/.test(c.street) && /^\d{5}$/.test(c.zip_code)) {
          return { status: "ADDRESS_CORRECTION_REQUIRED", version: 1,
            candidate: { house_number: c.house_number, street: c.street, zip_code: c.zip_code } };
        }
      }
      const detail = publicDetail(error);
      if (detail.reason === "invalid_address_input") {
        throw new HttpsError("invalid-argument", "Check the address details and try again.", detail);
      }
      // Conflicts, unresolved matches and unavailable authority remain failures.
      // Never disclose protected records, provider errors, addresses or secrets,
      // and never claim persistence succeeded after an uncertain response.
      const code = detail.reason === "rate_limited" ? "resource-exhausted" :
        detail.reason === "verification_temporarily_unavailable" ? "unavailable" : "failed-precondition";
      throw new HttpsError(code, "This address cannot be validated right now.", detail);
    }
  };
}

module.exports = { createProtectedLocationCallable };
