"use strict";

const { plain, exactKeys, validText } = require("./confirmedFactValidation");
const RISK_KEYS = Object.freeze(["medical_or_intimate_care", "hazardous_materials",
  "pest_control", "chemical_risk", "unknown_conditions"]);
const REQUIRED_SCOPE = ["areas_items", "cleaning_level", "approximate_scale"];
const SCOPE_KEYS = [...REQUIRED_SCOPE, "room_count", "supplies_responsibility", "condition_hazards"];

function validShape(scope, risks, schemaVersion) {
  return plain(scope) && (schemaVersion === 1 ? exactKeys(scope, SCOPE_KEYS) :
    REQUIRED_SCOPE.every((key) => Object.hasOwn(scope, key)) &&
      Object.keys(scope).every((key) => SCOPE_KEYS.includes(key))) &&
    exactKeys(risks, RISK_KEYS) &&
    Array.isArray(scope.areas_items) && scope.areas_items.length <= 20 &&
    scope.areas_items.every((value) => validText(value, 120)) &&
    validText(scope.cleaning_level, 40, true) && validText(scope.approximate_scale, 120, true) &&
    (!Object.hasOwn(scope, "room_count") || scope.room_count === null ||
      Number.isSafeInteger(scope.room_count) && scope.room_count >= 0 && scope.room_count <= 100) &&
    (!Object.hasOwn(scope, "supplies_responsibility") || validText(scope.supplies_responsibility, 40, true)) &&
    (!Object.hasOwn(scope, "condition_hazards") || validText(scope.condition_hazards, 120, true)) &&
    RISK_KEYS.every((key) => validText(risks[key], 80, true));
}

function materialFactsResolved(scope, risks, schemaVersion) {
  if (!validShape(scope, risks, schemaVersion) || scope.areas_items.length === 0 ||
      !["STANDARD", "DEEP"].includes(scope.cleaning_level) || !scope.approximate_scale.trim() ||
      !RISK_KEYS.every((key) => risks[key] === "ABSENT_CONFIRMED")) return false;
  // Safety is never inferred from silence. The explicit risk confirmations are
  // still required; a supplied conflicting/unknown condition fails closed.
  if (Object.hasOwn(scope, "condition_hazards") && scope.condition_hazards !== "NONE_CONFIRMED") return false;
  if (schemaVersion === 1) {
    return Number.isSafeInteger(scope.room_count) && scope.room_count > 0 &&
      ["POSTER_PROVIDES", "WORKER_PROVIDES", "EITHER_PARTY", "SHARED"].includes(scope.supplies_responsibility);
  }
  return (scope.room_count == null || scope.room_count > 0) &&
    (!Object.hasOwn(scope, "supplies_responsibility") ||
      ["", "UNKNOWN", "POSTER_PROVIDES", "WORKER_PROVIDES", "EITHER_PARTY", "SHARED"].includes(scope.supplies_responsibility));
}

function legacyText(content) {
  const scope = content.scope;
  return scope.areas_items.length === 2 && scope.areas_items[0] === "kitchen" &&
    scope.areas_items[1] === "bathroom" && scope.cleaning_level === "STANDARD" &&
    scope.approximate_scale === "two rooms" && scope.room_count === 2 &&
    scope.supplies_responsibility === "POSTER_PROVIDES" && scope.condition_hazards === "NONE_CONFIRMED" &&
    content.title === "Clean kitchen and bathroom" &&
    content.description === "Standard cleaning of kitchen and bathroom. Poster provides supplies." &&
    content.additional_info === "";
}

// This is a bounded deterministic text grammar, not a natural-language safety
// classifier. Never interpolate unchecked free text: unknown scope labels or
// prose remain UNRESOLVED. These labels are parser coverage, not taxonomy IDs.
const ORDINARY_AREAS = new Set(["kitchen", "bathroom", "bedroom", "living room",
  "dining room", "hallway", "entryway", "home office", "closet", "floors", "counters"]);
const NUMBER_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
function boundedScale(scope) {
  const match = /^(one|two|three|four|five|six|seven|eight|nine|ten|[1-9][0-9]{0,3}) (room|rooms|item|items|square feet)$/.exec(scope.approximate_scale);
  if (!match) return ["small apartment", "medium apartment", "large apartment", "small home", "medium home", "large home"].includes(scope.approximate_scale);
  const count = NUMBER_WORDS.includes(match[1]) ? NUMBER_WORDS.indexOf(match[1]) + 1 : Number(match[1]);
  if (["room", "item"].includes(match[2]) && count !== 1 ||
      ["rooms", "items"].includes(match[2]) && count === 1) return false;
  if (!["room", "rooms"].includes(match[2])) return true;
  const namedRooms = scope.areas_items.filter((area) => !["floors", "counters"].includes(area)).length;
  return count >= namedRooms && (scope.room_count == null || scope.room_count === count);
}
function reconciledText(content, schemaVersion) {
  if (schemaVersion === 1) return legacyText(content);
  const scope = content.scope;
  if (!materialFactsResolved(scope, content.risk_facts, schemaVersion) ||
      new Set(scope.areas_items).size !== scope.areas_items.length ||
      !scope.areas_items.every((area) => ORDINARY_AREAS.has(area)) || !boundedScale(scope)) return false;
  const namedRooms = scope.areas_items.filter((area) => !["floors", "counters"].includes(area)).length;
  if (scope.room_count != null && scope.room_count < namedRooms) return false;
  const areas = scope.areas_items.join(" and ");
  const level = scope.cleaning_level === "STANDARD" ? "Standard" : "Deep";
  const description = `${level} cleaning of ${areas}.`;
  const supplyText = { POSTER_PROVIDES: "Poster provides supplies.",
    WORKER_PROVIDES: "Worker provides supplies.", EITHER_PARTY: "Either party provides supplies.",
    SHARED: "Both parties provide supplies." }[scope.supplies_responsibility];
  const descriptions = [description, `${description} Scope: ${scope.approximate_scale}.`];
  if (supplyText) descriptions.push(...descriptions.map((text) => `${text} ${supplyText}`));
  return [`Clean ${areas}`, `${level} cleaning of ${areas}`, "General Cleaning"].includes(content.title) &&
    descriptions.includes(content.description) && content.additional_info === "";
}

function validator(schemaVersion) {
  return Object.freeze({ taskTypeId: "general_cleaning", schemaVersion,
    acceptsConfirmation: schemaVersion === 2,
    validatorVersion: `general-cleaning-${schemaVersion}`, textRuleVersion: `cleaning-text-${schemaVersion}`,
    supportedReason: "ORDINARY_CONFIRMED_CLEANING_SCOPE",
    validShape: (scope, risks) => validShape(scope, risks, schemaVersion),
    materialFactsResolved: (scope, risks) => materialFactsResolved(scope, risks, schemaVersion),
    reconciledText: (content) => reconciledText(content, schemaVersion) });
}
module.exports = { cleaningV1: validator(1), cleaningV2: validator(2) };
