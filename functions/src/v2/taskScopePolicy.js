"use strict";

const { resolveCanonicalTask } = require("./publicationPrerequisites");

// Runtime implementation of the frozen V2 taxonomy/exclusion advisory policy.
// This is not a publication decision. Its caller must obtain confirmed facts
// from backend-controlled draft records and separately reconcile free text.
const POLICY_VERSION = "OJNY-V2-GOV-1.0.0/task-scope-1";
const OUTCOME = Object.freeze({
  SUPPORTED: "SUPPORTED_ADVISORY",
  ESCALATE: "ESCALATION_REQUIRED",
  WITHHOLD: "UNSUPPORTED_WITHHOLD"
});
const PROHIBITED = new Set([
  "LICENSED_ELECTRICAL", "PLUMBING", "HVAC", "STRUCTURAL_WORK",
  "ROOF_OR_HIGH_HEIGHT", "HAZARDOUS_MATERIALS", "MEDICAL_OR_INTIMATE_CARE",
  "CHILD_CARE", "LOCKSMITH_OR_ACCESS_CIRCUMVENTION", "WEAPONS_OR_ILLEGAL_GOODS",
  "BUILDING_RULE_VIOLATION", "UNAUTHORIZED_SYSTEM_ACCESS", "SAFETY_CONTROL_EVASION",
  "ILLEGAL_OR_UNSAFE_PURPOSE"
]);
const CLEANING_RISKS = Object.freeze([
  "medical_or_intimate_care", "hazardous_materials", "pest_control",
  "chemical_risk", "unknown_conditions"
]);
const CLEANING_SCOPE = Object.freeze([
  "areas_items", "cleaning_level", "approximate_scale", "room_count",
  "supplies_responsibility", "condition_hazards"
]);

function decision(outcome, reasonCodes, taskTypeId = null) {
  return Object.freeze({ policy_version: POLICY_VERSION, outcome,
    reason_codes: Object.freeze(reasonCodes), task_type_id: taskTypeId });
}

function plain(value) {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, keys) {
  return plain(value) && Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

function isoTime(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function confirmedCleaningFacts(facts) {
  if (!exactKeys(facts, ["confirmation", "scope", "risk_facts", "conflicting_facts", "additional_task_type_ids", "prohibited_scope_codes"]) ||
      !exactKeys(facts.confirmation, ["source", "confirmed_at", "fact_schema_version"]) ||
      facts.confirmation.source !== "POSTER_CONFIRMED" ||
      facts.confirmation.fact_schema_version !== 1 ||
      !isoTime(facts.confirmation.confirmed_at) ||
      !exactKeys(facts.scope, CLEANING_SCOPE) ||
      !exactKeys(facts.risk_facts, CLEANING_RISKS) ||
      !Array.isArray(facts.conflicting_facts) || facts.conflicting_facts.length !== 0 ||
      !Array.isArray(facts.additional_task_type_ids) || facts.additional_task_type_ids.length !== 0 ||
      !Array.isArray(facts.prohibited_scope_codes) || facts.prohibited_scope_codes.length !== 0) return false;

  const scope = facts.scope;
  return Array.isArray(scope.areas_items) && scope.areas_items.length > 0 &&
    scope.areas_items.every((value) => typeof value === "string" && value.trim().length > 0) &&
    ["STANDARD", "DEEP"].includes(scope.cleaning_level) &&
    typeof scope.approximate_scale === "string" && scope.approximate_scale.trim().length > 0 &&
    Number.isSafeInteger(scope.room_count) && scope.room_count > 0 &&
    ["POSTER_PROVIDES", "WORKER_PROVIDES", "EITHER_PARTY", "SHARED"].includes(scope.supplies_responsibility) &&
    scope.condition_hazards === "NONE_CONFIRMED" &&
    CLEANING_RISKS.every((risk) => facts.risk_facts[risk] === "ABSENT_CONFIRMED");
}

function evaluateTaskScopePolicy(input) {
  if (!plain(input) || input.policyVersion !== POLICY_VERSION) {
    return decision(OUTCOME.ESCALATE, ["POLICY_VERSION_UNSUPPORTED"]);
  }
  const facts = input.confirmedFacts;
  if (plain(facts) && Array.isArray(facts.prohibited_scope_codes)) {
    const prohibited = [...new Set(facts.prohibited_scope_codes.filter((code) => PROHIBITED.has(code)))].sort();
    if (prohibited.length) return decision(OUTCOME.WITHHOLD, ["PROHIBITED_SCOPE", ...prohibited]);
  }
  const task = resolveCanonicalTask({ taskTypeId: input.taskTypeId, taxonomyVersion: input.taxonomyVersion });
  if (task.kind !== "CANONICAL_TASK") return decision(OUTCOME.ESCALATE, ["CANONICAL_TASK_UNRESOLVED"]);
  if (task.separateResearchLifecycle) return decision(OUTCOME.ESCALATE, ["SEPARATE_RESEARCH_LIFECYCLE"], task.taskTypeId);
  if (!plain(facts)) return decision(OUTCOME.ESCALATE, ["CONFIRMED_SCOPE_MISSING"], task.taskTypeId);
  if (Array.isArray(facts.conflicting_facts) && facts.conflicting_facts.length ||
      Array.isArray(facts.additional_task_type_ids) && facts.additional_task_type_ids.length) {
    return decision(OUTCOME.ESCALATE, ["CONFLICTING_OR_MULTITASK_SCOPE"], task.taskTypeId);
  }
  // Only this fully structured family has a positive path in this increment.
  // Other approved task identities remain unknown pending their own rules.
  if (task.taskTypeId !== "general_cleaning") {
    return decision(OUTCOME.ESCALATE, ["TASK_SCOPE_RULE_NOT_IMPLEMENTED"], task.taskTypeId);
  }
  if (!confirmedCleaningFacts(facts)) {
    return decision(OUTCOME.ESCALATE, ["MATERIAL_SCOPE_OR_SAFETY_FACT_MISSING"], task.taskTypeId);
  }
  return decision(OUTCOME.SUPPORTED, ["ORDINARY_CONFIRMED_CLEANING_SCOPE"], task.taskTypeId);
}

module.exports = { POLICY_VERSION, OUTCOME, evaluateTaskScopePolicy };
