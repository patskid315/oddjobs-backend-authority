"use strict";
function createStripeWebhookHandler({stripe,webhookSecret,eventRepository,reconciler,logger=console,handlerVersion="gate5.5-v1"}){return async({rawBody,signature,retryFailed=false})=>{
  const event=stripe.webhooks.constructEvent(rawBody,signature,webhookSecret); const claim=await eventRepository.claim(event.id,{type:event.type,apiVersion:event.api_version||null,livemode:!!event.livemode,created:event.created,handlerVersion},{retryFailed});
  if(claim.kind!=="acquired")return {duplicate:true,status:claim.record.status,result:claim.record.result||null};
  const supported=new Set(["payment_intent.succeeded","payment_intent.payment_failed","charge.refunded","refund.created","refund.updated","account.updated"]);
  if(!supported.has(event.type)){await eventRepository.complete(event.id,{status:"ignored"});logger.info("stripe_event_unhandled",{eventId:event.id,type:event.type});return {ignored:true};}
  try{const result=await reconciler.handle(event.type,event.data.object);await eventRepository.complete(event.id,{status:"processed",result:result.kind});return result;}
  catch(e){await eventRepository.fail(event.id,{code:String(e?.code||"handler_error").slice(0,80)});throw e;}
};}
module.exports={createStripeWebhookHandler};
