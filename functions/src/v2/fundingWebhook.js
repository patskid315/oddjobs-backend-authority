"use strict";

const { reconcileIntent } = require("./fundingAuthority");

const EVENTS = new Set(["payment_intent.succeeded", "payment_intent.processing", "payment_intent.payment_failed", "payment_intent.canceled"]);
const id = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

function createFundingWebhookHandler({ stripe, webhookSecret, eventRepository, db, clock = () => new Date() }) {
  if (typeof webhookSecret !== "string" || !webhookSecret.startsWith("whsec_")) throw new Error("STRIPE_WEBHOOK_SECRET is unavailable");
  return async ({ rawBody, signature }) => {
    const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    const claim = await eventRepository.claim(event.id, { type: event.type, apiVersion: event.api_version || null,
      livemode: Boolean(event.livemode), created: event.created, handlerVersion: "v2-funding-webhook-1" });
    if (claim.kind !== "acquired") return { duplicate: true, status: claim.record.status };
    if (!EVENTS.has(event.type)) {
      await eventRepository.complete(event.id, { status: "ignored", result: "unrelated_event" });
      return { ignored: true };
    }
    try {
      const intent = event.data?.object; const metadata = intent?.metadata || {};
      if (!id(metadata.oddjobs_v2_job) || !/^[0-9a-f]{64}$/.test(metadata.oddjobs_v2_attempt || "")) {
        await eventRepository.complete(event.id, { status: "ignored", result: "unbound_event" });
        return { ignored: true };
      }
      const record = await reconcileIntent({ db, jobRef: metadata.oddjobs_v2_job,
        attemptId: metadata.oddjobs_v2_attempt, intent, evidenceSource: "SIGNED_WEBHOOK",
        providerEventCreated: Number.isSafeInteger(event.created) ? event.created : 0, now: clock() });
      await eventRepository.complete(event.id, { status: "processed", result: record.state });
      return { processed: true };
    } catch (error) {
      await eventRepository.fail(event.id, { code: "v2_funding_reconciliation_failed" });
      throw error;
    }
  };
}

function createFundingWebhookHttp({ handlerFactory }) {
  return async (request, response) => {
    if (request.method !== "POST" || !Buffer.isBuffer(request.rawBody)) return response.status(400).send("invalid_request");
    try {
      const handler = handlerFactory();
      await handler({ rawBody: request.rawBody, signature: request.get("stripe-signature") || "" });
      return response.status(200).send("ok");
    } catch (_) {
      return response.status(400).send("invalid_event");
    }
  };
}

module.exports = { EVENTS, createFundingWebhookHandler, createFundingWebhookHttp };
