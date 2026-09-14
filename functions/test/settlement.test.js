"use strict";
const test=require("node:test");const assert=require("node:assert/strict");
const {GuardedSettlementExecutor}=require("../src/settlement/executor");
const {settlementIdentity,transferIdempotencyKey}=require("../src/settlement/idempotency");

function fixture(){
  let calls=0,state={identity:"job1:payment1:v1",jobId:"job1",paymentId:"payment1",status:"pending"};
  const obligation={jobId:"job1",paymentId:"payment1",jobPaymentId:"payment1",paymentJobId:"job1",jobStatus:"completed",paymentStatus:"succeeded",workerId:"w1",paymentRecipientId:"w1",workerAmount:4750,currency:"usd",destinationAccountId:"acct_test",cancelled:false,refunded:false,disputed:false,priorSettlement:false};
  const repository={
    async get(){return state;},
    async claim({attemptId}){if(state.status==="succeeded")return{kind:"completed",settlement:state};if(["claimed","processing"].includes(state.status))return{kind:"busy",settlement:state};state={...state,status:"claimed",attemptId};return{kind:"acquired",settlement:state};},
    async loadEligibleObligation(){return obligation;},
    async recordAttempt(){state={...state,status:"processing"};},
    async confirm({transferId}){state={...state,status:"succeeded",transferId};return state;},
    async markAmbiguous(){state={...state,status:"manualReview"};}
  };
  const stripe={async createTransfer(_,opts){calls++;assert.equal(opts.idempotencyKey,"oddjobs:settlement:job1_payment1_v1");return{kind:"succeeded",id:"tr_test"};}};
  return{executor:new GuardedSettlementExecutor({repository,stripe,enabled:true,logger:{info(){}}}),obligation,get calls(){return calls;}};
}

test("stable identity and Stripe key",()=>{const id=settlementIdentity("job1","payment1",1);assert.equal(id,"job1:payment1:v1");assert.equal(transferIdempotencyKey(id),"oddjobs:settlement:job1_payment1_v1");});
test("duplicate invocation returns success without a second transfer",async()=>{const f=fixture();const a=await f.executor.execute("job1:payment1:v1");const b=await f.executor.execute("job1:payment1:v1");assert.equal(a.transferId,b.transferId);assert.equal(f.calls,1);});
test("concurrent duplicate is suppressed by claim",async()=>{const f=fixture();await Promise.all([f.executor.execute("job1:payment1:v1"),f.executor.execute("job1:payment1:v1")]);assert.equal(f.calls,1);});
test("refund blocks settlement",async()=>{const f=fixture();f.obligation.refunded=true;await assert.rejects(()=>f.executor.execute("job1:payment1:v1"),/blocked/);assert.equal(f.calls,0);});
test("worker mismatch blocks settlement",async()=>{const f=fixture();f.obligation.paymentRecipientId="other";await assert.rejects(()=>f.executor.execute("job1:payment1:v1"),/mismatch/);assert.equal(f.calls,0);});
