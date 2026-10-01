"use strict";
const { reconcileReviewedCleaning } = require("./generalCleaningReconciliationV6");
const { reconciliationEvidence } = require("./generalCleaningInterpreter");

// Fixed recovery order and code/field/action tuples. Never forward input strings.
const ISSUES = Object.freeze([
  ["safety_confirmation_required", "safety", "answer_safety_question"],
  ["cleaning_level_conflict", "cleaning_level", "review_cleaning_level"],
  ["area_conflict", "areas", "review_areas"],
  ["scale_conflict", "scale", "review_scale"],
  ["exclusive_scope_conflict", "scope", "review_scope"],
  ["whole_scope_unresolved", "scope", "review_scope"],
  ["additional_scope_unresolved", "scope", "review_job_description"],
  ["unclassified_scope", "scope", "review_job_description"],
  ["missing_area", "areas", "select_areas"],
  ["missing_cleaning_level", "cleaning_level", "select_cleaning_level"],
  ["missing_scale", "scale", "select_scale"]
].map(([code, field, action]) => Object.freeze({ code, field, action })));
const RISKS = ["medical_or_intimate_care", "hazardous_materials", "pest_control", "chemical_risk", "unknown_conditions"];
const REASONS = Object.freeze({ EXPRESSED_SCOPE_MISSING: "area_conflict", EXCLUSIVITY_CONFLICT: "exclusive_scope_conflict",
  EXTENT_COVERAGE_UNRESOLVED: "whole_scope_unresolved", ROOM_QUANTITY_UNRESOLVED: "scale_conflict" });
function publicReason(reason) { return Object.hasOwn(REASONS, reason) ? REASONS[reason] : "unclassified_scope"; }

// Diagnostic only, after the existing authority has saved an UNRESOLVED outcome.
// Never influences policy, text reconciliation, or the confirmation command.
function cleaningClarification(content, provenance) {
  const codes = new Set();
  const scope = content.scope;
  if (RISKS.some((key) => content.risk_facts[key] !== "ABSENT_CONFIRMED") ||
      Object.hasOwn(scope, "condition_hazards") && scope.condition_hazards !== "NONE_CONFIRMED") codes.add("safety_confirmation_required");
  if (!scope.areas_items.length) codes.add("missing_area");
  if (!scope.cleaning_level.trim()) codes.add("missing_cleaning_level");
  if (!scope.approximate_scale.trim()) codes.add("missing_scale");
  // Evaluate fields separately for diagnostics only; the authoritative combined
  // evaluation above remains unchanged. This allows two distinct field issues.
  for (const field of ["title", "description"]) {
    const isolated = { ...content, title: "General cleaning", description: "General cleaning", [field]: content[field] };
    const outcome = reconcileReviewedCleaning(isolated, provenance);
    if (outcome.compatible) continue;
    if (outcome.reason === "STRUCTURED_FACTS_UNRESOLVED") continue;
    if (outcome.reason === "EXPLICIT_CONTRADICTION") {
      const evidence = reconciliationEvidence(content[field], field);
      codes.add(evidence?.proposals.some((p) => p.slot === "cleaning_level" && p.value !== scope.cleaning_level) ?
        "cleaning_level_conflict" : "scale_conflict");
    } else if (outcome.reason === "UNCLASSIFIED_MATERIAL_CONTENT") {
      // A complete recognized cleaning request before an explicit conjunction
      // supplies evidence of an unresolved addition, without classifying its type.
      const segments = content[field].split(/ and /i);
      const addition = content.additional_info === "" && segments.length > 1 && segments.slice(1).some((_, i) =>
        reconciliationEvidence(segments.slice(0, i + 1).join(" and "), field)?.proposals.some((p) => p.slot === "areas_items"));
      codes.add(addition ? "additional_scope_unresolved" : "unclassified_scope");
    } else codes.add(publicReason(outcome.reason));
  }
  if (!codes.size) codes.add("unclassified_scope");
  return { version: 1, issues: ISSUES.filter((issue) => codes.has(issue.code)).map((issue) => ({ ...issue })) };
}
module.exports = { cleaningClarification, publicReason, ISSUES };
