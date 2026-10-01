"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createCleaningInterpretationCallable}=require("../src/v2/cleaningInterpretationCallable");
class HttpsError extends Error {constructor(code,message){super(message);this.code=code;}}
const call=createCleaningInterpretationCallable({HttpsError});
const input={raw_input_ref:"test-input",raw_input_version:1,title:"General cleaning",description:"Deep clean my bedroom"};
test("authenticated exact advisory input only",async()=>{
 await assert.rejects(call(input,{}),e=>e.code==="unauthenticated");
 for(const bad of [{...input,owner_ref:"forged"},{...input,raw_input_version:0},{...input,scope_review:{}},null])
  await assert.rejects(call(bad,{auth:{uid:"poster"}}),e=>e.code==="invalid-argument"&&!e.message.includes("forged"));
});
test("deterministic versioned result without authority, copied prose or database side effects",async()=>{
 const context={auth:{uid:"poster"}},a=await call(input,context);
 assert.deepEqual(a,await call(input,context));assert.equal(a.interpretation_version,"general-cleaning-interpretation-1");
 assert.equal(a.kind,"GENERAL_CLEANING_ADVISORY");assert.equal(a.requires_explicit_confirmation,true);
 assert.equal(a.policy_outcome,undefined);assert.equal(a.confirmed_facts,undefined);
 assert.ok(!JSON.stringify(a).includes(input.description));assert.ok(!JSON.stringify(a).includes("poster"));
});
