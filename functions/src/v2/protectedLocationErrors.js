"use strict";

const REASONS = Object.freeze(["invalid_address_input", "address_not_resolved",
  "verification_temporarily_unavailable", "verification_unavailable", "rate_limited",
  "invalid_service_response", "unknown"]);
class ProtectedLocationFailure extends Error {
  constructor(reason, code = "LOCATION_VALIDATION_UNAVAILABLE") {
    super(code);
    this.reason = REASONS.includes(reason) ? reason : "unknown";
  }
}
function safeFailure(error) {
  return error instanceof ProtectedLocationFailure ? error : new ProtectedLocationFailure("unknown");
}
function publicDetail(error) {
  return Object.freeze({ domain: "v2_protected_location", version: 1, reason: safeFailure(error).reason });
}
module.exports = { ProtectedLocationFailure, safeFailure, publicDetail };
