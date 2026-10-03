"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {interpretGeneralCleaning} = require("../src/v2/generalCleaningInterpreter");
const cases = [
 ["Deep clean my bedroom", "UNDERSTOOD", ["bedroom"], "DEEP", "1 room", []],
 ["Just need someone to deep clean my room", "NEEDS_SPECIFIC_CLARIFICATION", null, "DEEP", "1 room", ["areas_items"]],
 ["need somone to deep cleen my bedroom", "UNDERSTOOD", ["bedroom"], "DEEP", "1 room", []],
 ["Can someone clean my apartment?", "NEEDS_SPECIFIC_CLARIFICATION", null, null, null, ["areas_items","cleaning_level","approximate_scale"]],
 ["my place needs a good cleaning", "NEEDS_SPECIFIC_CLARIFICATION", null, null, null, ["areas_items","cleaning_level","approximate_scale"]],
 ["Please clean my kitchen and bathroom", "NEEDS_SPECIFIC_CLARIFICATION", ["bathroom","kitchen"], null, "2 rooms", ["cleaning_level"]],
 ["Deep clean my room and fix my sink", "MATERIAL_UNCLASSIFIED_SCOPE", null, null, null, ["areas_items","cleaning_level","approximate_scale"]],
 ["Need help cleaning after a party", "NEEDS_SPECIFIC_CLARIFICATION", null, null, null, ["areas_items","cleaning_level","approximate_scale"]]
];
const input = description => ({raw_input_ref:"input-test",raw_input_version:1,title:"General cleaning",description});
const classify = r => r.unhandled_content.length ? "MATERIAL_UNCLASSIFIED_SCOPE" : r.ordinary_scope_understood ? "UNDERSTOOD" : "NEEDS_SPECIFIC_CLARIFICATION";
const proposed = (r, slot) => r.proposals.find(p=>p.slot===slot)?.value ?? null;
test("human-language golden outcomes retain evidence and ask only missing dimensions", () => {
 for (const [description,status,areas,level,scale,missing] of cases) {
  const raw=input(description);const original=structuredClone(raw);const r=interpretGeneralCleaning(raw);
  assert.equal(classify(r),status,description);assert.deepEqual(proposed(r,"areas_items"),areas);
  assert.equal(proposed(r,"cleaning_level"),level);assert.equal(proposed(r,"approximate_scale")?.wire_value??null,scale);
  assert.deepEqual(r.unresolved_required_slots,missing);assert.deepEqual(raw,original);
  for(const proposal of r.proposals) for(const span of proposal.evidence) assert.ok(raw[span.field].slice(span.start,span.end).length);
 }
});
test("courtesy, contractions, whitespace and terminal punctuation remain bounded",()=>{
 for(const description of ["Please DEEP clean my bedroom!!!", "I'd like deep cleaning for my bedroom.", "I’m looking for someone to deep clean my bedroom", "Deep clean my bedroom, please."]) {
  assert.equal(classify(interpretGeneralCleaning(input(description))),"UNDERSTOOD",description);
 }
});
test("tolerance never consumes additional work, exclusions, hazards or uncertain spelling",()=>{
 for(const description of ["Please clean my bedroom and fix my sink", "Can someone clean my apartment and remove mold?",
  "Deep cleen my bedroom and handle chemicals", "Please clean my room and administer medication", "Clean my room and provide intimate care",
  "Need help cleaning after a party and drive me home", "my place needs a good cleaning and spray for roaches",
  "Please clean my bedroom except the floor", "Do not clean my bedroom", "Please clean only if mold is absent",
  "clear my bedroom", "clan my bedroom", "Please deep clean my bedroom for $1", "Need help cleaning after asbestos removal",
  "Need help cleaning after a party except broken glass", "I'd not like cleaning my bedroom", "Please", "Thank you"]) {
  assert.equal(classify(interpretGeneralCleaning(input(description))),"MATERIAL_UNCLASSIFIED_SCOPE",description);
 }
});
