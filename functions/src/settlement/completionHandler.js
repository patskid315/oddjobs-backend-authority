"use strict";
const {settlementIdentity}=require("./idempotency");
function createCompletionHandler({repository,logger=console}){return async(before,after)=>{
  if(!after?.exists) return {kind:"ignored"}; const a=after.data(),b=before?.exists?before.data():{};
  if(a.progressStatus!=="completed"||b.progressStatus==="completed") return {kind:"ignored"};
  if(a.cancelled||a.disputed) return {kind:"blocked"};
  const paymentId=a.paymentId; if(!paymentId){logger.warn("settlement_pending_missing_payment",{jobId:after.id});return repository.recordIssue?repository.recordIssue({jobId:after.id,reason:"missingPayment"}):{kind:"manualReview",reason:"missingPayment"};}
  const identity=settlementIdentity(after.id,paymentId,1);
  const result=repository.createPendingFromCompletion
    ? await repository.createPendingFromCompletion({identity,version:1,jobId:after.id,paymentId})
    : await repository.createPending({identity,version:1,jobId:after.id,paymentId,workerId:a.assignedWorkerID||null,workerAmount:null,currency:"usd",destinationAccountId:null,paymentIntentId:null});
  logger.info("settlement_requested",{settlementId:identity,created:result.created}); return {kind:result.kind||"pending",...result};
};}
module.exports={createCompletionHandler};
