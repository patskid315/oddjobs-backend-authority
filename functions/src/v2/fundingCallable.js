"use strict";

const { readCurrentPublicationStanding } = require("./standingSafetyAuthority");
const { FundingFailure, COLLECTION, publicProjection, createOrReuseAttempt,
  attachProviderIntent, markUnknown, reconcileIntent, claimPreparation, releasePreparation } = require("./fundingAuthority");
const { randomUUID } = require("node:crypto");
const { StripeFundingFailure } = require("./stripeFundingProvider");

const id = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const failure = reason => { throw new FundingFailure(reason); };

function validate(data) {
  if (["quote", "prepare"].includes(data?.operation) && exact(data, ["operation", "job_ref", "job_version", "intent_key"]) &&
      id(data.job_ref) && Number.isSafeInteger(data.job_version) && data.job_version > 0 && id(data.intent_key) && data.intent_key.length >= 16) return;
  if (data?.operation === "status" && exact(data, ["operation", "job_ref"]) && id(data.job_ref)) return;
  failure("invalid_request");
}

function publicReason(error) {
  if (error instanceof FundingFailure || error instanceof StripeFundingFailure) return error.reason;
  return "temporarily_unavailable";
}

function createFundingCallable({ db, auth, providerFactory, HttpsError, clock = () => new Date(), standing = readCurrentPublicationStanding,
  leaseId = () => randomUUID() }) {
  return async (input, context) => {
    try {
      const uid = context?.auth?.uid;
      if (!id(uid)) failure("authentication_required");
      validate(input); const data = JSON.parse(JSON.stringify(input)); const now = clock();
      let caller;
      try { caller = await auth.getUser(uid); } catch (_) { failure("temporarily_unavailable"); }
      if (!caller || caller.uid !== uid || caller.disabled !== false) failure("account_unavailable");
      const provider = providerFactory();
      if (data.operation === "status") {
        const snap = await db.collection(COLLECTION).doc(data.job_ref).get(); const record = snap.exists ? snap.data() : null;
        if (!record || record.poster_ref !== uid) failure(record ? "not_permitted" : "funding_unavailable");
        if (record.state === "FUNDED" || !record.provider_payment_intent_ref) return { schema_version: 1, funding: publicProjection(record) };
        const intent = await provider.retrieveIntent(record.provider_payment_intent_ref);
        const reconciled = await reconcileIntent({ db, jobRef: record.job_ref, attemptId: record.attempt_id,
          intent, evidenceSource: "AUTHORITATIVE_PROVIDER_RETRIEVAL", now });
        return { schema_version: 1, funding: publicProjection(reconciled) };
      }
      const prepared = await createOrReuseAttempt({ db, uid, command: data, now,
        validateStanding: async (tx, actorRef, current) => {
          const evidence = await standing({ tx, db, auth, actorRef, now: current });
          if (!evidence.allowed) failure(evidence.reason === "AUTHORITY_UNAVAILABLE" ? "temporarily_unavailable" : "not_permitted");
        } });
      if (data.operation === "quote") return { schema_version: 1, funding: publicProjection(prepared.record) };
      if (prepared.record.state === "FUNDED") return { schema_version: 1, funding: publicProjection(prepared.record) };
      let preparationLease = null;
      try {
        preparationLease = leaseId();
        const claimed = await claimPreparation({ db, jobRef: prepared.record.job_ref, attemptId: prepared.record.attempt_id,
          leaseId: preparationLease, now });
        if (!claimed.acquired) failure("funding_processing");
        prepared.record = claimed.record;
        const customerRef = await provider.customer(uid, caller);
        const connectRef = await provider.connectReady(prepared.selection.worker_ref);
        const intent = prepared.record.provider_payment_intent_ref ?
          await provider.retrieveIntent(prepared.record.provider_payment_intent_ref) :
          await provider.createIntent(prepared.record, customerRef);
        const attached = await attachProviderIntent({ db, jobRef: prepared.record.job_ref, attemptId: prepared.record.attempt_id,
          customerRef, connectRef, providerLivemode: provider.livemode, intent, now });
        if (intent.status === "succeeded") {
          const retrieved = await provider.retrieveIntent(intent.id);
          const reconciled = await reconcileIntent({ db, jobRef: attached.job_ref, attemptId: attached.attempt_id,
            intent: retrieved, evidenceSource: "AUTHORITATIVE_PROVIDER_RETRIEVAL", now });
          return { schema_version: 1, funding: publicProjection(reconciled) };
        }
        if (typeof intent.client_secret !== "string" || !intent.client_secret.startsWith(`${intent.id}_secret_`)) failure("invalid_service_response");
        return { schema_version: 1, funding: publicProjection(attached, intent.client_secret) };
      } catch (error) {
        if (error instanceof FundingFailure && ["provider_evidence_invalid", "funding_processing"].includes(error.reason)) throw error;
        if (error instanceof StripeFundingFailure && ["connect_not_ready", "stripe_customer_unavailable", "stripe_configuration_unavailable"].includes(error.reason)) {
          await releasePreparation({ db, jobRef: prepared.record.job_ref, attemptId: prepared.record.attempt_id,
            leaseId: preparationLease, now });
          throw error;
        }
        await markUnknown({ db, jobRef: prepared.record.job_ref, attemptId: prepared.record.attempt_id, now });
        failure("funding_result_unknown");
      }
    } catch (error) {
      const reason = publicReason(error);
      const code = reason === "authentication_required" ? "unauthenticated" : reason === "invalid_request" ? "invalid-argument" :
        ["temporarily_unavailable", "funding_result_unknown", "funding_processing"].includes(reason) ? "unavailable" : "failed-precondition";
      throw new HttpsError(code, "This funding request could not be completed.", { domain: "v2_funding", version: 1, reason });
    }
  };
}

module.exports = { createFundingCallable, validate };
