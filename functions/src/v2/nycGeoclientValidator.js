"use strict";

const { commandPayloadDigest } = require("./foundation");
const { PROVIDER_ID } = require("./protectedLocationAuthority");

const BASE_URL = "https://api.nyc.gov/geoclient/v2/";
const MAX_RESPONSE_BYTES = 262144;
const failure = (code) => new Error(code);
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
  // /address is a single Function 1B result, never a /search candidate list.
  if (!plain(body) || Object.keys(body).length !== 1 || !plain(result) ||
      result.geosupportFunctionCode !== "1B" ||
      result.geosupportReturnCode !== "00" || result.geosupportReturnCode2 !== "00" ||
      ["returnCode1e", "returnCode1a"].some((key) =>
        result[key] != null && result[key] !== "00") ||
      ["reasonCode", "reasonCode2", "reasonCode1e", "reasonCode1a", "message", "message2"]
        .some((key) => result[key] != null && normalized(result[key]) !== "") ||
      normalized(result.houseNumber) !== normalized(input.house_number) ||
      normalized(result.houseNumberIn) !== normalized(input.house_number) ||
      normalized(result.streetName1In) !== normalized(input.street) ||
      normalized(result.firstStreetNameNormalized) !== normalized(input.street) ||
      result.zipCode !== input.zip_code ||
      typeof result.bblBoroughCode !== "string" || !/^[1-5]$/.test(result.bblBoroughCode) ||
      typeof result.bbl !== "string" || !/^[1-5][0-9]{9}$/.test(result.bbl) ||
      result.bbl[0] !== result.bblBoroughCode ||
      ["boroughCode1In", "lionBoroughCode"].some((key) =>
        result[key] != null && result[key] !== result.bblBoroughCode)) {
    throw failure("LOCATION_VALIDATION_UNRESOLVED");
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
          typeof address.zip_code !== "string" || !/^\d{5}$/.test(address.zip_code) ||
          inputDigest !== commandPayloadDigest(address)) {
        throw failure("LOCATION_INPUT_INVALID");
      }
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
          const response = await fetchImpl(url.toString(), {
            method: "GET", headers: { Accept: "application/json", "Ocp-Apim-Subscription-Key": key },
            redirect: "error", cache: "no-store", signal: controller.signal
          });
          if (response.status !== 200 || response.redirected ||
              !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) {
            throw failure("HTTP_FAILURE");
          }
          const chunks = [];
          let size = 0;
          for await (const chunk of response.body) {
            size += chunk.length;
            if (size > MAX_RESPONSE_BYTES) { controller.abort(); throw failure("RESPONSE_TOO_LARGE"); }
            chunks.push(Buffer.from(chunk));
          }
          return JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch (_) {
          // Never propagate HTTP exceptions, headers, URLs, bodies or credentials.
          throw failure("LOCATION_VALIDATION_UNAVAILABLE");
        }
      }
      try {
        const before = versionEvidence(await getJSON("version"));
        const match = exactMatch(await getJSON("address", {
          houseNumber: input.house_number, street: input.street, zip: input.zip_code
        }), input);
        const after = versionEvidence(await getJSON("version"));
        if (before.digest !== after.digest) throw failure("LOCATION_VALIDATION_UNRESOLVED");
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
