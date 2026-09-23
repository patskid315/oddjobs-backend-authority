"use strict";

const crypto = require("node:crypto");
const { commandPayloadDigest } = require("./foundation");
const { GEOGRAPHY_REGISTRY_VERSION, projectEligibilityGeography } = require("./publicationPrerequisites");

// Internal server boundary only. No callable is exported or configured here.
// A production validator must be separately qualified and configured; a
// client-supplied response or borough is never a validator.
const LOCATION_DERIVATION_VERSION = "v2-nyc-address-1";
const PROVIDER_ID = "NYC_GEOCLIENT_V2";
const BOROUGH_BY_CODE = Object.freeze({
  "1": "nyc:borough:manhattan", "2": "nyc:borough:bronx",
  "3": "nyc:borough:brooklyn", "4": "nyc:borough:queens",
  "5": "nyc:borough:staten_island"
});

function nonempty(value, max = 160) {
  return typeof value === "string" && value.trim() === value &&
    value.length > 0 && value.length <= max && !/[\r\n]/.test(value);
}

function validRef(value) {
  return nonempty(value, 128) && value !== "." && value !== ".." && !value.includes("/");
}

function normalizedAddress(address) {
  if (!address || typeof address !== "object" || Array.isArray(address) ||
      Object.keys(address).some((key) => !["house_number", "street", "zip_code", "unit"].includes(key)) ||
      !nonempty(address.house_number, 24) || !nonempty(address.street) ||
      !/^\d{5}$/.test(address.zip_code || "") ||
      (address.unit != null && !nonempty(address.unit, 80))) {
    throw new Error("LOCATION_INPUT_INVALID");
  }
  return Object.freeze({ house_number: address.house_number, street: address.street,
    zip_code: address.zip_code, unit: address.unit || null });
}

function locationRefFor(ownerRef, intentKey) {
  const joined = ["v2-protected-location-1", ownerRef, intentKey]
    .map((value) => `${Buffer.byteLength(value, "utf8")}:${value}`).join("");
  return crypto.createHash("sha256").update(joined).digest("hex");
}

function validatedBorough(result, addressDigest) {
  if (!result || result.provider_id !== PROVIDER_ID ||
      result.input_digest !== addressDigest || result.status !== "EXACT_ADDRESS" ||
      !Array.isArray(result.matches) || result.matches.length !== 1 ||
      !nonempty(result.dataset_version, 80) || !nonempty(result.provider_reference, 128)) {
    throw new Error("LOCATION_VALIDATION_UNRESOLVED");
  }
  const match = result.matches[0];
  if (!match || match.geosupport_return_code !== "00" ||
      match.input_match_confirmed !== true ||
      !Object.hasOwn(BOROUGH_BY_CODE, match.borough_code)) {
    throw new Error("LOCATION_VALIDATION_UNRESOLVED");
  }
  return BOROUGH_BY_CODE[match.borough_code];
}

function validateExisting(snapshot, ownerRef, locationRef, addressDigest) {
  const existing = snapshot.data();
  if (!existing || existing.owner_ref !== ownerRef ||
      existing.protected_ref !== locationRef || existing.address_digest !== addressDigest) {
    throw new Error("LOCATION_INTENT_CONFLICT");
  }
  // A receipt does not rehabilitate a malformed or externally seeded record.
  try { return projectEligibilityGeography(existing); } catch (_) {
    throw new Error("LOCATION_INTENT_CONFLICT");
  }
}

async function recordProtectedNYCAddress({ db, authenticatedOwnerRef, intentKey, address,
  validator, now = new Date() }) {
  if (!db || typeof db.runTransaction !== "function" ||
      !validRef(authenticatedOwnerRef) || !nonempty(intentKey, 200) ||
      intentKey.length < 16 || !(now instanceof Date) || !Number.isFinite(now.getTime()) ||
      !validator || validator.providerId !== PROVIDER_ID ||
      typeof validator.validateExactAddress !== "function") {
    throw new Error("LOCATION_AUTHORITY_UNAVAILABLE");
  }
  const exactAddress = normalizedAddress(address);
  const addressDigest = commandPayloadDigest(exactAddress);
  // Apartment/unit is retained only in the protected record; it is not needed
  // for borough validation and must not be sent to the address provider.
  const validationAddress = { house_number: exactAddress.house_number,
    street: exactAddress.street, zip_code: exactAddress.zip_code };
  const validationDigest = commandPayloadDigest(validationAddress);
  const locationRef = locationRefFor(authenticatedOwnerRef, intentKey);
  const ref = db.collection("v2ProtectedLocations").doc(locationRef);
  const before = await ref.get();
  if (before.exists) return { protected_ref: locationRef,
    eligibility_geography: validateExisting(before, authenticatedOwnerRef, locationRef, addressDigest) };

  let result;
  try { result = await validator.validateExactAddress(validationAddress, validationDigest); } catch (_) {
    throw new Error("LOCATION_VALIDATION_UNAVAILABLE");
  }
  const boroughId = validatedBorough(result, validationDigest);
  const record = {
    authority: "BACKEND_VALIDATED_LOCATION", source: PROVIDER_ID,
    derivation_version: LOCATION_DERIVATION_VERSION,
    registry_version: GEOGRAPHY_REGISTRY_VERSION, dataset_version: result.dataset_version,
    applicability: "IN_PERSON", derivation_state: "VALIDATED",
    borough_id: boroughId, neighborhood_id: null,
    protected_ref: locationRef, owner_ref: authenticatedOwnerRef,
    address_digest: addressDigest, exact_address: exactAddress,
    provider_reference: result.provider_reference, validated_at: now
  };
  const eligibility = projectEligibilityGeography(record);
  const committedGeography = await db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (current.exists) {
      const existing = validateExisting(current, authenticatedOwnerRef, locationRef, addressDigest);
      if (existing.borough_id !== boroughId) {
        tx.update(ref, { derivation_state: "UNRESOLVED", conflict_reason_code: "PROVIDER_BOROUGH_CONFLICT" });
        return null;
      }
      return existing;
    }
    tx.create(ref, record);
    return eligibility;
  });
  if (!committedGeography) throw new Error("LOCATION_VALIDATION_UNRESOLVED");
  return { protected_ref: locationRef, eligibility_geography: committedGeography };
}

module.exports = { LOCATION_DERIVATION_VERSION, PROVIDER_ID, validatedBorough,
  recordProtectedNYCAddress };
