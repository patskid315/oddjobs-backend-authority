"use strict";

const { SettlementStatus, assertTransition } = require("./model");

class FirestoreSettlementRepository {
  constructor({ db, collection = "settlements", auditCollection = "paymentAuditEvents" }) {
    this.db = db; this.collection = db.collection(collection); this.audit = db.collection(auditCollection);
  }
  ref(identity) { return this.collection.doc(identity); }
  async get(identity) { const s=await this.ref(identity).get(); return s.exists ? {id:s.id,...s.data()} : null; }
  async createPending(obligation) {
    const ref=this.ref(obligation.identity); const audit=this.audit.doc(`pending_${obligation.identity}`);
    return this.db.runTransaction(async tx=>{const s=await tx.get(ref); if(s.exists){assertImmutable(s.data(),obligation); return {created:false,settlement:{id:s.id,...s.data()}};}
      const now=new Date(); const data={...immutable(obligation),status:SettlementStatus.PENDING,createdAt:now,updatedAt:now}; tx.create(ref,data); tx.create(audit,{type:"settlementRequested",settlementId:obligation.identity,jobId:obligation.jobId,createdAt:now}); return {created:true,settlement:{id:obligation.identity,...data}};});
  }
  async createPendingFromCompletion({jobId,paymentId,version=1,identity}) {
    const [j,p]=await Promise.all([this.db.collection("jobPost").doc(jobId).get(),this.db.collection("payments").doc(paymentId).get()]);
    if(!j.exists||!p.exists) return {created:false,kind:"manualReview",reason:!j.exists?"missingJob":"missingPayment"};
    return this.createPending({identity,version,jobId,paymentId,workerId:null,workerAmount:null,currency:null,destinationAccountId:null,paymentIntentId:null,eligibilityStatus:"unverified"});
  }
  async recordIssue({jobId,reason,now=new Date()}) {
    const ref=this.db.collection("settlementIssues").doc(`${jobId}_v1`);
    await ref.set({jobId,reason,status:SettlementStatus.MANUAL_REVIEW,createdAt:now,updatedAt:now},{merge:true});
    return {kind:"manualReview",reason};
  }
  async claim({identity, owner, attemptId, now, leaseMs}) {
    const ref=this.ref(identity); return this.db.runTransaction(async tx=>{const s=await tx.get(ref); if(!s.exists) throw new Error("Settlement missing"); const d=s.data();
      if(d.status===SettlementStatus.SUCCEEDED) return {kind:"completed",settlement:{id:s.id,...d}};
      const active=d.leaseExpiresAt && d.leaseExpiresAt.toDate ? d.leaseExpiresAt.toDate()>now : d.leaseExpiresAt>now;
      if((d.status===SettlementStatus.CLAIMED||d.status===SettlementStatus.PROCESSING)&&active) return {kind:"busy",settlement:{id:s.id,...d}};
      if([SettlementStatus.BLOCKED,SettlementStatus.CANCELLED].includes(d.status)) throw new Error("Settlement blocked");
      if(![SettlementStatus.PENDING,SettlementStatus.FAILED,SettlementStatus.MANUAL_REVIEW,SettlementStatus.CLAIMED,SettlementStatus.PROCESSING].includes(d.status)) throw new Error("Settlement not claimable");
      const next={status:SettlementStatus.CLAIMED,claimId:attemptId,leaseOwner:owner,leaseExpiresAt:new Date(now.getTime()+leaseMs),updatedAt:now}; tx.update(ref,next); return {kind:"acquired",attemptId,settlement:{id:s.id,...d,...next}};});
  }
  async loadEligibleObligation({jobId,paymentId}) {
    const [j,p]=await Promise.all([this.db.collection("jobPost").doc(jobId).get(),this.db.collection("payments").doc(paymentId).get()]);
    if(!j.exists||!p.exists) return null; const jd=j.data(),pd=p.data();
    return {jobId,paymentId,jobPaymentId:jd.paymentId,paymentJobId:pd.jobId,jobStatus:jd.progressStatus,workerId:jd.assignedWorkerID,paymentStatus:pd.status,paymentRecipientId:pd.recipientId,workerAmount:pd.workerAmount,currency:pd.currency||"usd",destinationAccountId:pd.destinationAccountId,cancelled:!!jd.cancelled||jd.progressStatus==="cancelled",refunded:!!pd.refunded||pd.status==="refunded",disputed:!!pd.disputed,priorSettlement:!!pd.stripeTransferId,paymentIntentId:pd.paymentIntentId};
  }
  async recordAttempt({identity,attemptId,idempotencyKeyDigest,now}) { return this.transition(identity,SettlementStatus.PROCESSING,{attemptId,idempotencyKeyDigest,attemptedAt:now}); }
  async confirm({identity,attemptId,transferId,now}) { return this.transition(identity,SettlementStatus.SUCCEEDED,{attemptId,transferId,completedAt:now,leaseExpiresAt:null}); }
  async fail({identity,attemptId,code,now}) { return this.transition(identity,SettlementStatus.FAILED,{attemptId,failureCode:code,failedAt:now,leaseExpiresAt:null}); }
  async markAmbiguous({identity,attemptId,code,now}) { return this.transition(identity,SettlementStatus.MANUAL_REVIEW,{attemptId,failureCode:code,lastCheckedAt:now,leaseExpiresAt:null}); }
  async transition(identity,status,patch) { const ref=this.ref(identity); return this.db.runTransaction(async tx=>{const s=await tx.get(ref); if(!s.exists) throw new Error("Settlement missing"); assertTransition(s.data().status,status); const data={...patch,status,updatedAt:patch.now||new Date()}; delete data.now; tx.update(ref,data); return {id:s.id,...s.data(),...data};}); }
}

function immutable(o){return {identity:o.identity,version:o.version,jobId:o.jobId,paymentId:o.paymentId,workerId:o.workerId,workerAmount:o.workerAmount,currency:o.currency,destinationAccountId:o.destinationAccountId,paymentIntentId:o.paymentIntentId||null,eligibilityStatus:o.eligibilityStatus||null};}
function assertImmutable(a,b){for(const [k,v] of Object.entries(immutable(b))) if(a[k]!==v) throw new Error(`Immutable settlement mismatch: ${k}`);}
module.exports={FirestoreSettlementRepository,assertImmutable};
