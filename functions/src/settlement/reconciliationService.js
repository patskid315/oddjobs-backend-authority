"use strict";
class ReconciliationService{
  constructor({repository,stripe}){this.repository=repository;this.stripe=stripe;}
  async handle(type,object){
    const identity=object?.metadata?.settlementIdentity||null;
    if(type==="account.updated")return object?.charges_enabled&&object?.payouts_enabled?{kind:"reconciledSuccess"}:{kind:"manualReview",reason:"connectedAccountRestricted"};
    if(["payment_intent.payment_failed","charge.refunded","refund.created","refund.updated"].includes(type))return {kind:"blocked",reason:type};
    if(type==="payment_intent.succeeded"&&identity)return this.reconcile(identity);
    return {kind:"manualReview",reason:"missingSettlementCorrelation"};
  }
  async reconcile(identity){const s=await this.repository.get(identity);if(!s)return {kind:"manualReview",reason:"missingSettlement"};
    if(s.status==="succeeded"){if(!s.transferId)return {kind:"manualReview",reason:"missingTransferReference"};try{await this.stripe.retrieveTransfer(s.transferId);return {kind:"reconciledSuccess"};}catch{return {kind:"manualReview",reason:"stripeTransferMissing"};}}
    const match=await this.stripe.findTransferBySettlementIdentity(identity);if(match){await this.repository.confirm({identity,attemptId:s.attemptId,transferId:match.id,now:new Date()});return {kind:"reconciledSuccess"};}
    const o=await this.repository.loadEligibleObligation(s);if(!o||o.cancelled||o.refunded||o.disputed||o.paymentStatus!=="succeeded")return {kind:"blocked"};return {kind:"manualReview",reason:"noStripeResult"};
  }
}
module.exports={ReconciliationService};
