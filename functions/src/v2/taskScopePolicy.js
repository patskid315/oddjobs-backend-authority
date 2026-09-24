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
function decision(outcome, reasonCodes, taskTypeId = null) {
  return Object.freeze({ policy_version: POLICY_VERSION, outcome,
    reason_codes: Object.freeze(reasonCodes), task_type_id: taskTypeId });
}

const { plain, exactKeys } = require("./confirmedFactValidation");
const { taskValidator } = require("./taskValidatorRegistry");

function isoTime(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function confirmedEnvelope(facts) {
  return exactKeys(facts, ["confirmation", "scope", "risk_facts", "conflicting_facts", "additional_task_type_ids", "prohibited_scope_codes"]) &&
    exactKeys(facts.confirmation, ["source", "confirmed_at", "fact_schema_version"]) &&
    facts.confirmation.source === "POSTER_CONFIRMED" && isoTime(facts.confirmation.confirmed_at) &&
    [facts.conflicting_facts, facts.additional_task_type_ids, facts.prohibited_scope_codes]
      .every((values) => Array.isArray(values) && values.length === 0);
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
  const validator = taskValidator(task.taskTypeId, input.taxonomyVersion,
    facts.confirmation && facts.confirmation.fact_schema_version);
  if (!validator) return decision(OUTCOME.ESCALATE, ["TASK_SCOPE_RULE_NOT_IMPLEMENTED"], task.taskTypeId);
  if (!confirmedEnvelope(facts) || !validator.materialFactsResolved(facts.scope, facts.risk_facts)) {
    return decision(OUTCOME.ESCALATE, ["MATERIAL_SCOPE_OR_SAFETY_FACT_MISSING"], task.taskTypeId);
  }
  return decision(OUTCOME.SUPPORTED, [validator.supportedReason], task.taskTypeId);
}

module.exports = { POLICY_VERSION, OUTCOME, evaluateTaskScopePolicy };
