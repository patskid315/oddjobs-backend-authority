"use strict";

const { COMMAND_KINDS, INITIAL_PUBLICATION_STATE,
  classifyPublicationRecord, commandPayloadDigest } = require("./foundation");
const { FirestoreV2CommandRepository } = require("./firestoreCommandRepository");
const { TAXONOMY_VERSION, GEOGRAPHY_REGISTRY_VERSION,
  readPublicationStanding, readEligibilityGeography } = require("./publicationPrerequisites");
const { POLICY_VERSION, OUTCOME } = require("./taskScopePolicy");
const { readCurrentConfirmedCleaningDraft } = require("./confirmedPostingDraft");

const PUBLICATION_POLICY_VERSION = "OJNY-V2-GOV-1.0.0/free-publication-1";
const JOBS = "v2PublishedJobs";
const PRIVATE = "v2PublishedJobPrivate";
const QUOTAS = "v2PublicationQuotas";
const DRAFT_CLAIMS = "v2PublicationDraftClaims";

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function exact(value, keys) {
  return plain(value) && Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

function ref(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 &&
    value.trim() === value && !value.includes("/") && value !== "." && value !== "..";
}

function validateCommand(command, actorRef) {
  const keys = ["record_type", "publication_idempotency_key", "owner_ref", "draft_ref",
    "draft_version", "requested_discovery_visibility", "hire_again_relationship_ref",
    "task_type_id", "taxonomy_version", "confirmed_posting_facts_ref",
    "eligibility_geography", "protected_fulfillment_location_ref", "poster_offer",
    "policy_versions", "client_contract_version"];
  const offer = command && command.poster_offer;
  if (!exact(command, keys) || command.record_type !== "ORDINARY_JOB_PUBLICATION_COMMAND" ||
      command.owner_ref !== actorRef || !ref(actorRef) || !ref(command.draft_ref) ||
      !ref(command.protected_fulfillment_location_ref) ||
      command.confirmed_posting_facts_ref !== command.draft_ref ||
      !Number.isSafeInteger(command.draft_version) || command.draft_version < 1 ||
      command.requested_discovery_visibility !== "MARKETPLACE_OPEN" ||
      command.hire_again_relationship_ref !== null ||
      command.task_type_id !== "general_cleaning" ||
      command.taxonomy_version !== String(TAXONOMY_VERSION) ||
      command.client_contract_version !== 1 ||
      !exact(offer, ["pricing_mode", "poster_entered_amount_minor", "currency",
        "pricing_policy_version", "pricing_provenance"]) ||
      !["HOURLY", "FIXED"].includes(offer.pricing_mode) ||
      !Number.isSafeInteger(offer.poster_entered_amount_minor) ||
      offer.poster_entered_amount_minor < 0 || offer.currency !== "USD" ||
      offer.pricing_policy_version !== null || offer.pricing_provenance !== "POSTER_ENTERED" ||
      !exact(command.policy_versions, ["publication", "task_scope", "geography"]) ||
      command.policy_versions.publication !== PUBLICATION_POLICY_VERSION ||
      command.policy_versions.task_scope !== POLICY_VERSION ||
      command.policy_versions.geography !== GEOGRAPHY_REGISTRY_VERSION ||
      !exact(command.eligibility_geography, ["applicability", "borough_id",
        "neighborhood_id", "geography_registry_version",
        "contains_exact_address_or_coordinates"])) {
    throw new Error("PUBLICATION_COMMAND_INVALID");
  }
  // Reject non-JSON or oversized values before the command repository hashes them.
  commandPayloadDigest(command);
  if (Buffer.byteLength(JSON.stringify(command), "utf8") > 8192) {
    throw new Error("PUBLICATION_COMMAND_INVALID");
  }
}

function assertServerControls(controls) {
  if (!exact(controls, ["enabled", "max_open_jobs", "max_daily_publications"]) ||
      controls.enabled !== true || !Number.isSafeInteger(controls.max_open_jobs) ||
      controls.max_open_jobs < 1 || !Number.isSafeInteger(controls.max_daily_publications) ||
      controls.max_daily_publications < 1) throw new Error("PUBLICATION_DISABLED");
}

// Internal application command, not a deployed callable. The adapter must get
// authContext from verified Firebase request auth and controls from server
// configuration, never from client data. No AI, Stripe, or payment transport.
async function publishGeneralCleaningJob({ db, auth, authContext, command, controls,
  now = new Date() }) {
  const actorRef = authContext && authContext.uid;
  if (!db || !auth || !ref(actorRef) || !(now instanceof Date) ||
      !Number.isFinite(now.getTime())) throw new Error("PUBLICATION_UNAUTHENTICATED");
  validateCommand(command, actorRef);
  command = JSON.parse(JSON.stringify(command));
  const repository = new FirestoreV2CommandRepository({ db, clock: () => now });
  const result = await repository.execute({ kind: COMMAND_KINDS.PUBLICATION,
    authenticatedActorRef: actorRef,
    idempotencyKey: command.publication_idempotency_key,
    payload: command, schemaVersion: 1, policyVersion: PUBLICATION_POLICY_VERSION,
    transactionWork: async (tx, { commandId }) => {
      assertServerControls(controls);
      const standing = await readPublicationStanding(tx, db, actorRef, { auth, now });
      if (!standing.allowed) throw new Error("PUBLICATION_STANDING_BLOCKED");
      const draft = await readCurrentConfirmedCleaningDraft(tx, db,
        command.draft_ref, actorRef, command.draft_version);
      if (draft.policy_outcome !== OUTCOME.SUPPORTED ||
          draft.text_reconciliation_state !== "CLEARED_EXACT_TEMPLATE_V1") {
        throw new Error("PUBLICATION_SCOPE_UNRESOLVED");
      }
      if (Date.parse(draft.schedule_window.end_at) <= now.getTime()) {
        throw new Error("PUBLICATION_SCHEDULE_EXPIRED");
      }
      const geography = await readEligibilityGeography(tx, db,
        command.protected_fulfillment_location_ref, actorRef);
      if (commandPayloadDigest(command.eligibility_geography) !== commandPayloadDigest(geography)) {
        throw new Error("PUBLICATION_GEOGRAPHY_CONFLICT");
      }
      const draftClaimRef = db.collection(DRAFT_CLAIMS).doc(command.draft_ref);
      const draftClaim = await tx.get(draftClaimRef);
      if (draftClaim.exists) throw new Error("PUBLICATION_DUPLICATE_DRAFT");
      const quotaRef = db.collection(QUOTAS).doc(actorRef);
      const quotaSnapshot = await tx.get(quotaRef);
      const quota = quotaSnapshot.exists ? quotaSnapshot.data() : null;
      const day = now.toISOString().slice(0, 10);
      if (quota && (quota.owner_ref !== actorRef ||
          !Number.isSafeInteger(quota.open_count) || quota.open_count < 0 ||
          !Number.isSafeInteger(quota.daily_count) || quota.daily_count < 0 ||
          typeof quota.day !== "string")) throw new Error("PUBLICATION_QUOTA_UNAVAILABLE");
      const openCount = quota ? quota.open_count : 0;
      const dailyCount = quota && quota.day === day ? quota.daily_count : 0;
      if (openCount >= controls.max_open_jobs ||
          dailyCount >= controls.max_daily_publications) throw new Error("PUBLICATION_RATE_LIMITED");
      const publishedAt = now.toISOString();
      const receipt = { record_type: "ORDINARY_JOB_PUBLICATION_RECEIPT",
        publication_receipt_id: commandId,
        publication_idempotency_key: command.publication_idempotency_key,
        job_ref: commandId, owner_ref: actorRef, ...INITIAL_PUBLICATION_STATE,
        discovery_visibility: "MARKETPLACE_OPEN", hire_again_relationship_ref: null,
        published_at: publishedAt, job_version: 1, backend_authoritative: true,
        payment_or_funding_record_created: false, selected_worker_ref: null,
        assignment_created: false, payout_eligible: false,
        stripe_customer_required: false, saved_payment_method_required: false,
        payment_intent_created: false, charge_created: false,
        proactive_notification_authorized: false };
      classifyPublicationRecord(receipt);
      tx.create(db.collection(JOBS).doc(commandId), {
        record_type: "V2_ORDINARY_PUBLISHED_JOB", job_ref: commandId,
        owner_ref: actorRef, ...INITIAL_PUBLICATION_STATE,
        discovery_visibility: "MARKETPLACE_OPEN", job_version: 1,
        task_type_id: "general_cleaning", taxonomy_version: TAXONOMY_VERSION,
        title: draft.title, description: draft.description,
        duration_minutes: draft.duration_minutes,
        schedule_window: draft.schedule_window,
        eligibility_geography: geography,
        poster_offer: command.poster_offer, published_at: publishedAt,
        publication_policy_version: PUBLICATION_POLICY_VERSION,
        task_scope_policy_version: POLICY_VERSION,
        proactive_notification_authorized: false });
      tx.create(db.collection(PRIVATE).doc(commandId), {
        job_ref: commandId, owner_ref: actorRef,
        protected_fulfillment_location_ref: command.protected_fulfillment_location_ref,
        confirmed_posting_facts_ref: draft.draft_ref,
        draft_version: draft.draft_version, draft_digest: draft.content_digest,
        standing_provenance: standing.provenance, created_at: now });
      tx.create(draftClaimRef, { draft_ref: command.draft_ref,
        owner_ref: actorRef, job_ref: commandId,
        draft_version: command.draft_version, created_at: now });
      tx.set(quotaRef, { owner_ref: actorRef, day,
        daily_count: dailyCount + 1, open_count: openCount + 1,
        updated_at: now });
      return receipt;
    } });
  classifyPublicationRecord(result.result);
  return result.result;
}

module.exports = { PUBLICATION_POLICY_VERSION, publishGeneralCleaningJob };
