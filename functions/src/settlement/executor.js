"use strict";
const crypto=require("node:crypto"); const {validateEligibility}=require("./settlementService"); const {transferIdempotencyKey}=require("./idempotency"); const {digest}=require("./stripeTransferService");
class GuardedSettlementExecutor{
  constructor({repository,stripe,enabled=false,clock=()=>new Date(),leaseMs=120000,owner="settlement-worker",logger=console}){Object.assign(this,{repository,stripe,enabled,clock,leaseMs,owner,logger});}
  async execute(identity){if(!this.enabled)return {kind:"disabled"}; const current=await this.repository.get(identity); if(current?.status==="succeeded")return current;
    const initial=await this.repository.loadEligibleObligation(current);validateEligibility(initial);
    const attemptId=crypto.randomUUID(); const claim=await this.repository.claim({identity,owner:this.owner,attemptId,now:this.clock(),leaseMs:this.leaseMs}); if(claim.kind!=="acquired")return claim.settlement;
    const o=await this.repository.loadEligibleObligation(claim.settlement); validateEligibility(o); const key=transferIdempotencyKey(identity); await this.repository.recordAttempt({identity,attemptId,idempotencyKeyDigest:digest(key),now:this.clock()});
    this.logger.info("stripe_transfer_attempt",{settlementId:identity,attemptId});
    const result=await this.stripe.createTransfer({amount:o.workerAmount,currency:o.currency,destination:o.destinationAccountId,metadata:{jobId:claim.settlement.jobId,paymentId:claim.settlement.paymentId,settlementIdentity:identity}},{idempotencyKey:key});
    if(result.kind==="succeeded")return this.repository.confirm({identity,attemptId,transferId:result.id,now:this.clock()});
    if(result.kind==="unknown"){await this.repository.markAmbiguous({identity,attemptId,code:result.code,now:this.clock()});return {kind:"manualReview"};}
    await this.repository.fail({identity,attemptId,code:result.code,now:this.clock()});return result;
  }
}
module.exports={GuardedSettlementExecutor};
