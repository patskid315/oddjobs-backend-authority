"use strict";
const { exactKeys } = require("./confirmedFactValidation");
const { commandPayloadDigest } = require("./foundation");
// V1 canonical JSON: sorted object keys, UTF-8, no whitespace. Scope strings
// are printable ASCII (the existing bounded cleaning vocabulary); no aliases.
// Arrays sort by ASCII identity; duplicates remain visible to policy validation.
function canonicalReviewedScope(scope) {
  const text = (value) => {
    if (typeof value !== "string" || !/^[\x20-\x7e]*$/.test(value)) throw new Error("DRAFT_INPUT_INVALID");
    return value;
  };
  if (!scope || !Array.isArray(scope.areas_items)) throw new Error("DRAFT_INPUT_INVALID");
  const areas = scope.areas_items.map((area) => text(area).trim().toLowerCase()).sort();
  const rooms = scope.room_count ?? null;
  if (rooms !== null && !Number.isSafeInteger(rooms)) throw new Error("DRAFT_INPUT_INVALID");
  return { version: 1, scope: { areas_items: areas, cleaning_level: text(scope.cleaning_level),
    approximate_scale: text(scope.approximate_scale), room_count: rooms,
    supplies_responsibility: scope.supplies_responsibility === undefined ? null : text(scope.supplies_responsibility) } };
}
function verifyScopeReview(scope, review) {
  if (!exactKeys(review, ["version", "scope_digest"]) || review.version !== 1 ||
      typeof review.scope_digest !== "string" || !/^[0-9a-f]{64}$/.test(review.scope_digest) ||
      review.scope_digest !== commandPayloadDigest(canonicalReviewedScope(scope))) throw new Error("DRAFT_INPUT_INVALID");
}
module.exports = { canonicalReviewedScope, verifyScopeReview };
