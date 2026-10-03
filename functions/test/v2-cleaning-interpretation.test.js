"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { interpretGeneralCleaning } = require("../src/v2/generalCleaningInterpreter");
const { matchesRawInput, rawInputIdentity } = require("../src/v2/generalCleaningInterpretationDomain");
const input = (description, title = "General apartment cleaning") => ({
  raw_input_ref: "draft-local-1", raw_input_version: 1, title, description });
const value = (result, slot) => result.proposals.find((p) => p.slot === slot)?.value;

test("deep clean my bedroom proposes evidenced scope without confirmation or policy authority", () => {
  const raw = input("Deep clean my bedroom"); const result = interpretGeneralCleaning(raw);
  assert.equal(result.interpretation_version, "general-cleaning-interpretation-3");
  assert.deepEqual(value(result, "areas_items"), ["bedroom"]);
  assert.equal(value(result, "cleaning_level"), "DEEP");
  assert.deepEqual(value(result, "approximate_scale"), { kind: "rooms", quantity: 1, wire_value: "1 room" });
  assert.deepEqual(result.unresolved_required_slots, []);
  assert.equal(result.ordinary_scope_understood, true);
  assert.equal(result.requires_explicit_confirmation, true);
  assert.equal(result.policy_outcome, undefined); assert.equal(result.risk_facts, undefined);
  assert.equal(result.confirmed_facts, undefined);
  for (const proposal of result.proposals) {
    for (const evidence of proposal.evidence) {
      assert.equal(evidence.field, "description");
      assert.ok(raw[evidence.field].slice(evidence.start, evidence.end).length > 0);
      assert.equal(evidence.text, undefined);
    }
  }
  const evidence = result.proposals.find((p) => p.slot === "cleaning_level").evidence[0];
  assert.equal(raw.description.slice(evidence.start, evidence.end), "Deep clean");
  assert.ok(!JSON.stringify(result).includes(raw.description));
});

test("unspecified level stays unknown; area language establishes scale without inventing level", () => {
  const result = interpretGeneralCleaning(input("Clean my bedroom"));
  assert.deepEqual(value(result, "areas_items"), ["bedroom"]);
  assert.equal(value(result, "approximate_scale").wire_value, "1 room");
  assert.equal(value(result, "cleaning_level"), undefined);
  assert.deepEqual(result.unresolved_required_slots, ["cleaning_level"]);
  assert.equal(result.ordinary_scope_understood, false);
});

test("generic and whole apartment do not fabricate scope, quantity, level or safety", () => {
  for (const description of ["Clean my apartment", "Need someone to clean my apartment", "Clean my whole apartment"]) {
    const result = interpretGeneralCleaning(input(description));
    assert.deepEqual(result.proposals, []);
    assert.deepEqual(result.unresolved_required_slots, ["areas_items", "cleaning_level", "approximate_scale"]);
    assert.equal(result.context[0].dwelling, "apartment");
    assert.equal(result.ordinary_scope_understood, false);
    assert.equal(result.extent_assertions.length, description.includes("whole") ? 1 : 0);
    assert.deepEqual(result.unresolved_requirements, description.includes("whole") ? ["whole_dwelling_coverage_unresolved"] : []);
  }
});

test("bounded room lists and explicit level forms are compositional", () => {
  const result = interpretGeneralCleaning(input("Clean my bedroom and bathroom"));
  assert.deepEqual(value(result, "areas_items"), ["bathroom", "bedroom"]);
  assert.equal(value(result, "approximate_scale").wire_value, "2 rooms");
  assert.equal(value(result, "cleaning_level"), undefined);
  const kitchen = interpretGeneralCleaning(input("Standard cleaning for my kitchen"));
  assert.deepEqual(value(kitchen, "areas_items"), ["kitchen"]);
  assert.equal(value(kitchen, "cleaning_level"), "STANDARD");
  assert.equal(kitchen.ordinary_scope_understood, true);
  assert.equal(interpretGeneralCleaning(input("I just need someone to deep clean my bedroom")).ordinary_scope_understood, true);
});

test("singular and bounded numeric forms produce existing representable room scales", () => {
  for (const [phrase, expected] of [["my bedroom", 1], ["a bedroom", 1], ["one bedroom", 1],
    ["two bedrooms", 2], ["3 bathrooms", 3], ["my 9999 bedrooms", 9999], ["my bedroom and two bathrooms", 3]]) {
    const result = interpretGeneralCleaning(input(`Deep clean ${phrase}`));
    assert.equal(value(result, "approximate_scale").quantity, expected);
    assert.equal(result.ordinary_scope_understood, true);
  }
  for (const noun of ["bedrooms", "bathrooms"]) {
    const result = interpretGeneralCleaning(input(`Clean my ${noun}`));
    assert.ok(value(result, "areas_items"));
    assert.equal(value(result, "approximate_scale"), undefined);
    assert.ok(result.unresolved_required_slots.includes("approximate_scale"));
  }
  for (const target of ["0 bedrooms", "10000 bedrooms", "2 bedroom", "one bedrooms", "-1 bedroom", "1.5 bedrooms"]) {
    const result = interpretGeneralCleaning(input(`Clean ${target}`));
    assert.equal(result.ordinary_scope_understood, false); assert.equal(result.unhandled_content.length, 1);
  }
});

test("safety-sensitive and unknown material is never silently consumed", () => {
  for (const description of ["Clean mold off my bedroom wall", "Deep clean my bedroom and administer medication",
    "Clean my bedroom except the floor", "Do not clean my bedroom", "Something nice please",
    "Clean my bedroom and spray for roaches", "Clean my bedroom then move furniture"]) {
    const raw = input(description); const result = interpretGeneralCleaning(raw);
    assert.equal(result.ordinary_scope_understood, false);
    assert.deepEqual(result.unhandled_content, [{ field: "description", start: 0, end: description.length, reason: "unclassified_content" }]);
    assert.deepEqual(result.proposals, []);
    assert.equal(result.risk_facts, undefined);
  }
});

test("title and description evidence remain independent and conflicting proposals unresolved", () => {
  const unknownTitle = interpretGeneralCleaning(input("Deep clean my bedroom", "Also need unrelated work"));
  assert.equal(unknownTitle.ordinary_scope_understood, false);
  assert.equal(unknownTitle.unhandled_content[0].field, "title");
  assert.deepEqual(value(unknownTitle, "areas_items"), ["bedroom"]);
  const conflicting = interpretGeneralCleaning(input("Deep clean my bedroom", "Standard clean my kitchen"));
  assert.deepEqual(conflicting.conflicting_slots, ["areas_items", "cleaning_level"]);
  assert.equal(conflicting.ordinary_scope_understood, false);
  assert.equal(conflicting.proposals.filter((p) => p.slot === "cleaning_level").length, 2);
});

test("identity binds exact prose, reference and revision; repetition is deterministic", () => {
  const raw = input("Deep clean my bedroom"); const original = structuredClone(raw);
  const result = interpretGeneralCleaning(raw);
  assert.deepEqual(interpretGeneralCleaning(raw), result);
  assert.deepEqual(raw, original); assert.equal(matchesRawInput(result, raw), true);
  for (const patch of [{ title: "General Cleaning" }, { description: `${raw.description} ` },
    { raw_input_version: 2 }, { raw_input_ref: "different-draft" }]) {
    assert.equal(matchesRawInput(result, { ...raw, ...patch }), false);
  }
  assert.equal(matchesRawInput(result, null), false);
  assert.ok(Object.isFrozen(result.proposals));
  assert.throws(() => { result.proposals[0].value.push("kitchen"); }, TypeError);
});

test("bounded evidence uses original offsets and does not copy private or unknown prose", () => {
  const raw = input("  DEEP   clean my Bedroom.  ");
  const result = interpretGeneralCleaning(raw);
  assert.equal(result.ordinary_scope_understood, true);
  const span = result.proposals.find((p) => p.slot === "cleaning_level").evidence[0];
  assert.equal(raw.description.slice(span.start, span.end), "DEEP   clean");
  const unknown = input("🔒 unknown PRIVATE detail");
  const unhandled = interpretGeneralCleaning(unknown);
  assert.equal(unhandled.unhandled_content[0].end, unknown.description.length);
  assert.ok(!JSON.stringify(unhandled).includes("PRIVATE"));
});

test("input contract is bounded and cannot carry confirmed facts or policy authority", () => {
  for (const bad of [null, {}, { ...input("Clean my bedroom"), raw_input_version: 0 },
    { ...input("Clean my bedroom"), description: "x".repeat(5001) },
    { ...input("Clean my bedroom"), confirmed_facts: {} },
    { ...input("Clean my bedroom"), task_type_id: "other_task" }]) {
    assert.throws(() => rawInputIdentity(bad), /CLEANING_INTERPRETATION_INPUT_INVALID/);
  }
});

test("generic room preserves known level/quantity and requests only missing dimensions", () => {
  for (const description of ["Just need someone to deep clean my room", "Deep clean my room only"]) {
    const result = interpretGeneralCleaning(input(description, "General cleaning"));
    assert.equal(value(result, "cleaning_level"), "DEEP");
    assert.equal(value(result, "approximate_scale").wire_value, "1 room");
    assert.equal(value(result, "areas_items"), undefined);
    assert.deepEqual(result.unresolved_required_slots, ["areas_items"]);
    assert.deepEqual(result.unhandled_content, []);
    assert.equal(result.ordinary_scope_understood, false);
    assert.equal(result.proposals.find(p => p.slot === "approximate_scale").evidence[0].rule, "generic_room_quantity");
  }
  const simple = interpretGeneralCleaning(input("Clean my room"));
  assert.deepEqual(simple.unresolved_required_slots, ["areas_items", "cleaning_level"]);
  assert.equal(value(simple, "approximate_scale").wire_value, "1 room");
  for (const area of ["bedroom", "bathroom", "kitchen"]) {
    const result = interpretGeneralCleaning(input(`Deep clean my ${area}`));
    assert.deepEqual(value(result, "areas_items"), [area]);
    assert.equal(value(result, "cleaning_level"), "DEEP");
    assert.equal(value(result, "approximate_scale").wire_value, "1 room");
    assert.equal(result.ordinary_scope_understood, true);
  }
});

test("bounded room ambiguity never drops additional, hazardous or unknown work", () => {
  for (const description of ["Deep clean my room and fix my sink", "Deep clean my room and remove mold",
    "Deep clean my room and spray for roaches", "Deep clean my room whenever you can",
    "Deep clean my room only and administer medication", "Do not deep clean my room"]) {
    const result = interpretGeneralCleaning(input(description));
    assert.equal(result.unhandled_content.length, 1);
    assert.deepEqual(result.proposals, []);
    assert.equal(result.ordinary_scope_understood, false);
  }
});
