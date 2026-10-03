"use strict";
const { cleaningV2Text5, validReviewedCleaningScope } = require("./generalCleaningValidator");
const { reconciliationEvidence } = require("./generalCleaningInterpreter");
const { verifyScopeReview } = require("./scopeReview");

// Complete fields only. No clause stripping or general English classification.
const CONTEXT = new Set(["need some help tomorrow", "please", "thank you", "thanks"]);
const comparison = (value) => value.toLowerCase().replace(/[ \t\r\n]+/g, " ").trim().replace(/[.!?]$/, "").trim();
const words = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
function roomQuantity(scale) {
  const match = /^(one|two|three|four|five|six|seven|eight|nine|ten|[1-9][0-9]{0,3}) rooms?$/.exec(scale);
  return match ? (words.includes(match[1]) ? words.indexOf(match[1]) + 1 : Number(match[1])) : null;
}
const result = (reason) => Object.freeze({ compatible: reason === "COMPATIBLE", reason });

function reconcileReviewedCleaning(content, provenance, boundedRoom = false) {
  try {
    if (provenance?.confirmation_contract_version !== 2) return result("REVIEW_REQUIRED");
    verifyScopeReview(content.scope, provenance.scope_review);
  } catch { return result("REVIEW_REQUIRED"); }
  if (!validReviewedCleaningScope(content)) return result("STRUCTURED_FACTS_UNRESOLVED");
  if (content.additional_info !== "") return result("UNCLASSIFIED_MATERIAL_CONTENT");
  const areas = content.scope.areas_items.map((area) => area.trim().toLowerCase());
  let hasCleaningIntent = false;
  for (const field of ["title", "description"]) {
    const text = content[field];
    const parsed = reconciliationEvidence(text, field, boundedRoom);
    if (!parsed) {
      if (CONTEXT.has(comparison(text))) continue;
      // Preserve earlier complete templates (including scale/supply assertions).
      // The other field is a known generic template, never unclassified input.
      const legacy = { ...content, title: "General cleaning", description: "General cleaning", [field]: text };
      if (cleaningV2Text5.reconciledText(legacy)) { hasCleaningIntent = true; continue; }
      return result("UNCLASSIFIED_MATERIAL_CONTENT");
    }
    hasCleaningIntent = true;
    if (parsed.extentAssertions.length) return result("EXTENT_COVERAGE_UNRESOLVED");
    if (parsed.genericRoom) {
      const roomAreas = areas.filter((area) => !["floors", "counters"].includes(area));
      if (!roomAreas.length) return result("EXPRESSED_SCOPE_MISSING");
      if (parsed.exclusiveRoom && areas.length !== 1) return result("EXCLUSIVITY_CONFLICT");
      if (roomAreas.length !== 1 || (roomQuantity(content.scope.approximate_scale) ?? content.scope.room_count) !== 1) {
        return result("EXPLICIT_CONTRADICTION");
      }
    }
    const requested = parsed.proposals.find((p) => p.slot === "areas_items")?.value;
    if (requested?.some((area) => !areas.includes(area))) return result("EXPRESSED_SCOPE_MISSING");
    if (parsed.exclusiveAreas && areas.some((area) => !parsed.exclusiveAreas.includes(area))) return result("EXCLUSIVITY_CONFLICT");
    for (const proposal of parsed.proposals) {
      if (proposal.slot === "cleaning_level" && proposal.value !== content.scope.cleaning_level) return result("EXPLICIT_CONTRADICTION");
      if (proposal.slot === "approximate_scale" && !parsed.genericRoom) {
        // Room evidence applies to the expressed subset, not a maximum when
        // additional reviewed areas expand the work. A different scale dimension
        // may refine singular-area language; explicitly numbered rooms still
        // need comparable room quantity evidence.
        const quantity = roomQuantity(content.scope.approximate_scale) ?? content.scope.room_count;
        if (quantity == null) {
          if (parsed.explicitNumericQuantity) return result("ROOM_QUANTITY_UNRESOLVED");
          continue;
        }
        const addedRooms = areas.filter((area) => !requested.includes(area) && !["floors", "counters"].includes(area)).length;
        if (addedRooms ? quantity < proposal.value.quantity + addedRooms : quantity !== proposal.value.quantity) return result("EXPLICIT_CONTRADICTION");
      }
    }
  }
  return result(hasCleaningIntent ? "COMPATIBLE" : "CLEANING_INTENT_UNRESOLVED");
}
const cleaningV2Text6 = Object.freeze({ ...cleaningV2Text5, textRuleVersion: "cleaning-text-6",
  reconciledText: (content, provenance) => reconcileReviewedCleaning(content, provenance).compatible });
const cleaningV2Text7 = Object.freeze({ ...cleaningV2Text6, textRuleVersion: "cleaning-text-7",
  reconciledText: (content, provenance) => reconcileReviewedCleaning(content, provenance, true).compatible });
module.exports = { cleaningV2Text6, cleaningV2Text7, reconcileReviewedCleaning };
