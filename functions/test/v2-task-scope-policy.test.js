"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { POLICY_VERSION, OUTCOME, evaluateTaskScopePolicy } = require("../src/v2/taskScopePolicy");
const policyModule = require("../src/v2/taskScopePolicy");

function ordinaryCleaning() {
  return {
    policyVersion: POLICY_VERSION, taxonomyVersion: 2, taskTypeId: "general_cleaning",
    // This fixture represents facts fetched from a backend-controlled draft;
    // T01 must never pass an unverified client/JI envelope as authority.
    confirmedFacts: {
      confirmation: { source: "POSTER_CONFIRMED", confirmed_at: "2026-09-23T10:00:00Z", fact_schema_version: 1 },
      scope: { areas_items: ["kitchen", "bathroom"], cleaning_level: "STANDARD",
        approximate_scale: "two rooms", room_count: 2, supplies_responsibility: "POSTER_PROVIDES",
        condition_hazards: "NONE_CONFIRMED" },
      risk_facts: { medical_or_intimate_care: "ABSENT_CONFIRMED", hazardous_materials: "ABSENT_CONFIRMED",
        pest_control: "ABSENT_CONFIRMED", chemical_risk: "ABSENT_CONFIRMED",
        unknown_conditions: "ABSENT_CONFIRMED" },
      conflicting_facts: [], additional_task_type_ids: [], prohibited_scope_codes: []
    }
  };
}

test("only fully confirmed ordinary cleaning gets advisory support, not publication authority", () => {
  const result = evaluateTaskScopePolicy(ordinaryCleaning());
  assert.equal(result.outcome, OUTCOME.SUPPORTED);
  assert.equal(result.policy_version, POLICY_VERSION);
  assert.equal(Object.hasOwn(result, "publication_allowed"), false);
  assert.deepEqual(result.reason_codes, ["ORDINARY_CONFIRMED_CLEANING_SCOPE"]);
});

test("material gaps, conflicts, and unrecognized extra facts fail closed", () => {
  const variants = [
    (x) => { delete x.confirmedFacts.scope.room_count; },
    (x) => { x.confirmedFacts.risk_facts.hazardous_materials = "UNKNOWN"; },
    (x) => { x.confirmedFacts.scope.condition_hazards = "UNKNOWN"; },
    (x) => { x.confirmedFacts.conflicting_facts.push("description differs"); },
    (x) => { x.confirmedFacts.additional_task_type_ids.push("move_items"); },
    (x) => { x.confirmedFacts.confirmation.source = "AI_INFERRED"; },
    (x) => { x.confirmedFacts.scope.extra = "unreviewed"; },
    (x) => { x.confirmedFacts.risk_facts.extra = "ABSENT_CONFIRMED"; },
    (x) => { x.confirmedFacts.extra = "unreviewed"; }
  ];
  for (const mutate of variants) {
    const input = ordinaryCleaning(); mutate(input);
    assert.notEqual(evaluateTaskScopePolicy(input).outcome, OUTCOME.SUPPORTED);
  }
});

test("expressly prohibited scope wins over ordinary-looking, mixed, or missing facts", () => {
  assert.equal(Object.hasOwn(policyModule, "PROHIBITED"), false);
  for (const code of ["HAZARDOUS_MATERIALS", "MEDICAL_OR_INTIMATE_CARE", "CHILD_CARE", "LICENSED_ELECTRICAL", "BUILDING_RULE_VIOLATION"]) {
    const input = ordinaryCleaning(); input.confirmedFacts.prohibited_scope_codes = [code];
    assert.equal(evaluateTaskScopePolicy(input).outcome, OUTCOME.WITHHOLD);
  }
  const mixed = ordinaryCleaning();
  mixed.confirmedFacts.additional_task_type_ids = ["move_items"];
  mixed.confirmedFacts.prohibited_scope_codes = ["HAZARDOUS_MATERIALS"];
  assert.equal(evaluateTaskScopePolicy(mixed).outcome, OUTCOME.WITHHOLD);
});

test("research, legacy, unknown, version mismatch and unimplemented families never get support", () => {
  const cases = [
    { taskTypeId: "research_study", reason: "SEPARATE_RESEARCH_LIFECYCLE" },
    { taskTypeId: "Building", reason: "CANONICAL_TASK_UNRESOLVED" },
    { taskTypeId: "Cooking", reason: "CANONICAL_TASK_UNRESOLVED" },
    { taskTypeId: "mount_tv", reason: "TASK_SCOPE_RULE_NOT_IMPLEMENTED" }
  ];
  for (const { taskTypeId, reason } of cases) {
    const input = ordinaryCleaning(); input.taskTypeId = taskTypeId;
    assert.deepEqual(evaluateTaskScopePolicy(input).reason_codes, [reason]);
  }
  const wrongTaxonomy = ordinaryCleaning(); wrongTaxonomy.taxonomyVersion = 1;
  assert.equal(evaluateTaskScopePolicy(wrongTaxonomy).outcome, OUTCOME.ESCALATE);
  const wrongPolicy = ordinaryCleaning(); wrongPolicy.policyVersion = "client-policy";
  assert.equal(evaluateTaskScopePolicy(wrongPolicy).outcome, OUTCOME.ESCALATE);
});

test("client or AI disposition fields cannot decide the backend policy", () => {
  const input = ordinaryCleaning();
  input.taskTypeId = "mount_tv";
  input.policy_outcome = "SUPPORTED_ADVISORY";
  input.confirmedFacts.policy_outcome = "SUPPORTED_ADVISORY";
  assert.equal(evaluateTaskScopePolicy(input).outcome, OUTCOME.ESCALATE);
});
