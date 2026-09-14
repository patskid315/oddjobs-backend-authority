"use strict";
const crypto=require("node:crypto");
class StripeTransferService {
  constructor({stripe}){this.stripe=stripe;}
  async createTransfer(obligation,{idempotencyKey}){
    if(!Number.isSafeInteger(obligation.amount)||obligation.amount<=0) throw new Error("Invalid transfer amount");
    if(!/^acct_/.test(obligation.destination)) throw new Error("Invalid destination");
    try { const t=await this.stripe.transfers.create({amount:obligation.amount,currency:obligation.currency,destination:obligation.destination,metadata:obligation.metadata},{idempotencyKey}); return {kind:"succeeded",id:t.id}; }
    catch(error){if(["StripeConnectionError","StripeAPIError"].includes(error?.type)) return {kind:"unknown",code:safe(error)}; return {kind:"failed",code:safe(error)};}
  }
}
function digest(value){return crypto.createHash("sha256").update(value).digest("hex");}
function safe(e){return String(e?.code||e?.type||"stripe_error").slice(0,80);}
module.exports={StripeTransferService,digest};
