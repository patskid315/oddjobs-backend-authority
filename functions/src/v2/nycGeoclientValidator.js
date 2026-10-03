"use strict";

const { equivalentStreet } = require("./nycStreetIdentity");
const { commandPayloadDigest } = require("./foundation");
const { PROVIDER_ID } = require("./protectedLocationAuthority");

const BASE_URL = "https://api.nyc.gov/geoclient/v2/";
const MAX_RESPONSE_BYTES = 262144;
const { ProtectedLocationFailure, safeFailure } = require("./protectedLocationErrors");
const failure = (code, reason = code === "LOCATION_AUTHORITY_UNAVAILABLE" ? "verification_unavailable" :
  code === "LOCATION_INPUT_INVALID" ? "invalid_address_input" : "invalid_service_response") =>
  new ProtectedLocationFailure(reason, code);
const plain = (value) => value !== null && typeof value === "object" &&
  Object.getPrototypeOf(value) === Object.prototype;
const normalized = (value) => typeof value === "string" ?
  value.trim().replace(/\s+/g, " ").toUpperCase() : null;

function versionEvidence(body) {
  const version = body && body.geosupportVersion;
  if (!plain(version) || ![version.version, version.release].every((value) =>
    typeof value === "string" && /^[A-Za-z0-9._-]{1,16}$/.test(value))) {
    throw failure("LOCATION_VALIDATION_UNRESOLVED");
  }
  let digest;
  try { digest = commandPayloadDigest(version); } catch (_) {
    throw failure("LOCATION_VALIDATION_UNRESOLVED");
  }
  return { digest, dataset: `gs:${version.version}:${version.release}:${digest.slice(0, 32)}` };
}

function exactMatch(body, input) {
  const result = body && body.address;
  // A usable Function 1B assessment is distinct from malformed evidence.
  if (!plain(body) || Object.keys(body).length !== 1 || !plain(result) ||
      result.geosupportFunctionCode !== "1B" ||
      ![result.geosupportReturnCode, result.geosupportReturnCode2].every((v) => typeof v === "string" && /^[0-9]{2}$/.test(v)) ||
      ["returnCode1e", "returnCode1a"].some((k) => result[k] != null &&
        (typeof result[k] !== "string" || !/^[0-9]{2}$/.test(result[k]))) ||
      ["reasonCode", "reasonCode2", "reasonCode1e", "reasonCode1a", "message", "message2"]
        .some((k) => result[k] != null && typeof result[k] !== "string")) {
    throw failure("LOCATION_VALIDATION_UNRESOLVED");
  }
  if (result.geosupportReturnCode !== "00" || result.geosupportReturnCode2 !== "00" ||
      ["returnCode1e", "returnCode1a"].some((k) => result[k] != null && result[k] !== "00") ||
      ["reasonCode", "reasonCode2", "reasonCode1e", "reasonCode1a", "message", "message2"]
        .some((k) => result[k] != null && normalized(result[k]) !== "")) {
    // Non-success/warning codes are not a qualified geographic diagnosis.
    // Do not assume a provider failure means the poster's address is wrong.
    throw failure("LOCATION_VALIDATION_UNRESOLVED");
  }
  if (!["houseNumber", "houseNumberIn", "streetName1In", "firstStreetNameNormalized", "zipCode"]
        .every((k) => typeof result[k] === "string" && normalized(result[k])) ||
      normalized(result.houseNumberIn) !== normalized(input.house_number) ||
      normalized(result.streetName1In) !== normalized(input.street) ||
      !/^\d{5}$/.test(result.zipCode) ||
      typeof result.bblBoroughCode !== "string" || !/^[1-5]$/.test(result.bblBoroughCode) ||
      typeof result.bbl !== "string" || !/^[1-5][0-9]{9}$/.test(result.bbl) ||
      result.bbl[0] !== result.bblBoroughCode ||
      ["boroughCode1In", "lionBoroughCode"].some((k) => result[k] != null && result[k] !== result.bblBoroughCode)) {
    throw failure("LOCATION_VALIDATION_UNRESOLVED");
  }
  const houseNumberMatches = normalized(result.houseNumber) === normalized(input.house_number);
  const normalizedStreetMatches = equivalentStreet(input.street, result.firstStreetNameNormalized);
  const zipMatches = result.zipCode === input.zip_code;
  if (!houseNumberMatches || !normalizedStreetMatches || !zipMatches) {
    // Temporary E2E diagnostic: never include address values, identifiers or provider evidence.
    try {
      console.info(JSON.stringify({ event: "v2_protected_location_exact_match_failed",
        houseNumberMatches, normalizedStreetMatches, zipMatches }));
    } catch (_) { /* Observability must not change the authoritative failure. */ }
    const candidate = { house_number: normalized(result.houseNumber),
      street: normalized(result.firstStreetNameNormalized), zip_code: result.zipCode };
    // Only representable structured candidates; never expose provider evidence.
    if (!/^\d+(?:-\d+)?[A-Z]?$/.test(candidate.house_number) || candidate.house_number.length > 24 ||
        candidate.street.length > 160 || /[\u0000-\u001f\u007f]/.test(candidate.street)) {
      throw failure("LOCATION_VALIDATION_UNRESOLVED", "address_not_resolved");
    }
    return { correction: candidate };
  }
  return { borough: result.bblBoroughCode, reference: `bbl:${result.bbl}` };
}

/** Server-only adapter. Inject a secret accessor at composition time, never
 * through a client request. No credential is read until validation is invoked.
 * fetchImpl is injectable for offline tests; endpoint/redirect policy is fixed.
 * See docs/V2_GEOCLIENT_ADAPTER.md for conservative match and version semantics.
 */
function createNYCGeoclientValidator({
  getSubscriptionKey = () => process.env.NYC_GEOCLIENT_SUBSCRIPTION_KEY,
  fetchImpl = globalThis.fetch, timeoutMs = 10000
} = {}) {
  return Object.freeze({
    providerId: PROVIDER_ID,
    async validateExactAddress(address, inputDigest) {
      if (!plain(address) || Object.keys(address).sort().join(",") !== "house_number,street,zip_code" ||
          ![[address.house_number, 24], [address.street, 160]].every(([value, max]) =>
            typeof value === "string" && value.length > 0 && value.length <= max &&
            value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)) ||
          typeof address.zip_code !== "string" || !/^\d{5}$/.test(address.zip_code)) {
        throw failure("LOCATION_INPUT_INVALID");
      }
      if (inputDigest !== commandPayloadDigest(address)) throw failure("LOCATION_INPUT_INVALID", "invalid_service_response");
      // Snapshot before awaiting configuration/HTTP; callers cannot mutate evidence.
      const input = { ...address };
      let key;
      try { key = await getSubscriptionKey(); } catch (_) {
        throw failure("LOCATION_AUTHORITY_UNAVAILABLE");
      }
      if (typeof key !== "string" || !key || key.trim() !== key || /[\r\n]/.test(key) ||
          typeof fetchImpl !== "function" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
        throw failure("LOCATION_AUTHORITY_UNAVAILABLE");
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      async function getJSON(path, parameters) {
        const url = new URL(path, BASE_URL);
        if (parameters) url.search = new URLSearchParams(parameters).toString();
        try {
          let response;
          try { response = await fetchImpl(url.toString(), {
            method: "GET", headers: { Accept: "application/json", "Ocp-Apim-Subscription-Key": key },
            redirect: "error", cache: "no-store", signal: controller.signal
          }); } catch (error) {
            if (controller.signal.aborted || error instanceof TypeError ||
                ["AbortError", "TimeoutError"].includes(error && error.name)) {
              throw failure("LOCATION_VALIDATION_UNAVAILABLE", "verification_temporarily_unavailable");
            }
            throw safeFailure(error);
          }
          if (!response || !Number.isInteger(response.status) || !response.headers ||
              typeof response.headers.get !== "function") {
            throw failure("LOCATION_VALIDATION_UNAVAILABLE", "invalid_service_response");
          }
          if (response.status === 429) throw failure("LOCATION_VALIDATION_UNAVAILABLE", "rate_limited");
          if (response.status === 408 || response.status >= 500) throw failure("LOCATION_VALIDATION_UNAVAILABLE", "verification_temporarily_unavailable");
          if (response.status !== 200) throw failure("LOCATION_VALIDATION_UNAVAILABLE", "verification_unavailable");
          if (response.redirected ||
              !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) {
            throw failure("LOCATION_VALIDATION_UNAVAILABLE", "invalid_service_response");
          }
          if (!response.body || typeof response.body[Symbol.asyncIterator] !== "function") {
            throw failure("LOCATION_VALIDATION_UNAVAILABLE", "invalid_service_response");
          }
          const chunks = [];
          let size = 0;
          for await (const chunk of response.body) {
            size += chunk.length;
            if (size > MAX_RESPONSE_BYTES) { controller.abort(); throw failure("LOCATION_VALIDATION_UNAVAILABLE", "invalid_service_response"); }
            chunks.push(Buffer.from(chunk));
          }
          try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
          catch (_) { throw failure("LOCATION_VALIDATION_UNAVAILABLE", "invalid_service_response"); }
        } catch (error) {
          if (error instanceof ProtectedLocationFailure) throw error;
          if (controller.signal.aborted || error instanceof TypeError ||
              ["AbortError", "TimeoutError"].includes(error && error.name)) {
            throw failure("LOCATION_VALIDATION_UNAVAILABLE", "verification_temporarily_unavailable");
          }
          throw safeFailure(error);
        }
      }
      try {
        const before = versionEvidence(await getJSON("version"));
        const match = exactMatch(await getJSON("address", {
          houseNumber: input.house_number, street: input.street, zip: input.zip_code
        }), input);
        const after = versionEvidence(await getJSON("version"));
        if (before.digest !== after.digest) throw failure("LOCATION_VALIDATION_UNRESOLVED");
        if (match.correction) {
          const error = failure("LOCATION_VALIDATION_UNRESOLVED", "address_not_resolved");
          error.correction = Object.freeze(match.correction);
          throw error;
        }
        return { provider_id: PROVIDER_ID, input_digest: inputDigest, status: "EXACT_ADDRESS",
          dataset_version: before.dataset, provider_reference: match.reference,
          matches: [{ geosupport_return_code: "00", input_match_confirmed: true,
            borough_code: match.borough }] };
      } finally {
        clearTimeout(timer);
        controller.abort();
        key = undefined;
      }
    }
  });
}

module.exports = { createNYCGeoclientValidator };
