"use strict";

const { commandPayloadDigest } = require("./foundation");
const { exactKeys, validText } = require("./confirmedFactValidation");

const INTERPRETATION_VERSION = "general-cleaning-interpretation-1";
const REQUIRED_SLOTS = Object.freeze(["areas_items", "cleaning_level", "approximate_scale"]);

/**
 * Internal advisory boundary, not an authenticated endpoint or confirmed facts.
 * Input: { raw_input_ref, raw_input_version, title, description }.
 * Evidence spans use UTF-16 [start, end) offsets into the ORIGINAL named field.
 * Output contains no copied prose. A digest is correlation, never authorization.
 * Proposed facts carry {slot, value, evidence[]}; explicit user facts and
 * authoritative confirmation must remain separate at any future consumer.
 */
function rawInputIdentity(input) {
  if (!exactKeys(input, ["raw_input_ref", "raw_input_version", "title", "description"]) ||
      !validText(input.raw_input_ref, 128) || input.raw_input_ref.trim() !== input.raw_input_ref ||
      !Number.isSafeInteger(input.raw_input_version) || input.raw_input_version < 1 ||
      !validText(input.title, 160, true) || !validText(input.description, 5000)) {
    throw new Error("CLEANING_INTERPRETATION_INPUT_INVALID");
  }
  return Object.freeze({ ref: input.raw_input_ref, version: input.raw_input_version,
    digest: commandPayloadDigest({ title: input.title, description: input.description }) });
}

/** Only checks freshness; cannot promote proposals or authenticate their source. */
function matchesRawInput(result, input) {
  try {
    const identity = rawInputIdentity(input);
    return result?.kind === "GENERAL_CLEANING_ADVISORY" && result.schema_version === 1 &&
      result.raw_input?.ref === identity.ref && result.raw_input?.version === identity.version &&
      result.raw_input?.digest === identity.digest;
  } catch (_) { return false; }
}

function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Interpreter implementations produce this advisory shape, never policy outcomes.
 * Multiple conflicting proposals are retained, with the slot marked unresolved.
 * Full understanding refers ONLY to ordinary scope, not safety or publication.
 */
function advisoryResult(input, { proposals, unhandled, extentAssertions, context }) {
  const rawInput = rawInputIdentity(input);
  const conflicts = REQUIRED_SLOTS.filter((slot) =>
    new Set(proposals.filter((p) => p.slot === slot).map((p) => commandPayloadDigest(p.value))).size > 1);
  const unresolved = REQUIRED_SLOTS.filter((slot) => conflicts.includes(slot) || !proposals.some((p) => p.slot === slot));
  const requirements = extentAssertions.length ? ["whole_dwelling_coverage_unresolved"] : [];
  return freeze({ kind: "GENERAL_CLEANING_ADVISORY", schema_version: 1,
    interpretation_version: INTERPRETATION_VERSION, task_type_id: "general_cleaning",
    raw_input: rawInput, proposals, context, extent_assertions: extentAssertions,
    unresolved_required_slots: unresolved, conflicting_slots: conflicts,
    unresolved_requirements: requirements, unhandled_content: unhandled,
    ordinary_scope_understood: unresolved.length === 0 && requirements.length === 0 && unhandled.length === 0,
    requires_explicit_confirmation: true });
}

module.exports = { INTERPRETATION_VERSION, REQUIRED_SLOTS, rawInputIdentity, matchesRawInput, advisoryResult };
