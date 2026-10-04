"use strict";

const { commandPayloadDigest } = require("./foundation");
const { readCurrentPublicationStanding } = require("./standingSafetyAuthority");
const { readCurrentConfirmedCleaningDraft } = require("./confirmedPostingDraft");
const { exactKeys, validText } = require("./confirmedFactValidation");
const { readMarketplacePhotos } = require("./jobPhotoAuthority");
const POLICY = "OJNY-V2-GOV-1.0.0/worker-request-1";
const { selectResponse, readSelection, selectionProjection } = require("./provisionalSelection");
const { readScope, mutateScope } = require("./hourlyFundedScope");
const PAGE = 20;
class MarketplaceFailure extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
const fail = (reason) => { throw new MarketplaceFailure(reason); };
const id = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(s);
const record = async (tx, db, collection, key) => {
  const snap = await tx.get(db.collection(collection).doc(key));
  return snap.exists ? snap.data() : null;
};

// Request eligibility consumes the existing audited account/safety evidence,
// not capability, identity-verification, general availability or payment state.
async function requestStanding(tx, db, auth, actorRef, now) {
  const evidence = await readCurrentPublicationStanding({ tx, db, auth, actorRef, now });
  if (!evidence.allowed) fail(evidence.reason === "AUTHORITY_UNAVAILABLE" ? "eligibility_unavailable" : "not_permitted");
  return evidence.provenance;
}

async function projectJob(tx, db, job, now, storage, renderMedia = true, ownerRead = false) {
  const pending = ownerRead && job?.job_lifecycle_state === "SELECTION_PENDING_FUNDING";
  if (!job || job.record_type !== "V2_ORDINARY_PUBLISHED_JOB" || !id(job.job_ref) || !id(job.owner_ref) ||
      (!pending && job.job_lifecycle_state !== "PUBLISHED_OPEN") || job.discovery_visibility !== "MARKETPLACE_OPEN" ||
      job.task_type_id !== "general_cleaning" || job.taxonomy_version !== 2 ||
      !Number.isSafeInteger(job.job_version) || job.job_version < 1 ||
      !Number.isFinite(Date.parse(job.schedule_window?.end_at)) || (!pending && Date.parse(job.schedule_window.end_at) <= now.getTime())) fail("job_unavailable");
  const privateJob = await record(tx, db, "v2PublishedJobPrivate", job.job_ref);
  if (!privateJob || privateJob.owner_ref !== job.owner_ref || privateJob.job_ref !== job.job_ref) fail("job_unavailable");
  let draft;
  try { draft = await readCurrentConfirmedCleaningDraft(tx, db, privateJob.confirmed_posting_facts_ref, job.owner_ref, privateJob.draft_version); }
  catch (_) { fail("job_unavailable"); }
  if (draft.content_digest !== privateJob.draft_digest || draft.policy_outcome !== "SUPPORTED_ADVISORY" ||
      draft.text_reconciliation_state !== "CLEARED_EXACT_TEMPLATE_V1" ||
      commandPayloadDigest(draft.schedule_window) !== commandPayloadDigest(job.schedule_window)) fail("job_unavailable");
  const scope = draft.confirmed_facts.scope;
  const areas = scope.areas_items.map((s) => s.trim().toLowerCase());
  const known = ["kitchen", "bathroom", "bedroom", "living room", "dining room", "hallway", "entryway", "home office", "closet", "floors", "counters"];
  // Explicit projection allowlist. Never forward original prose, identity, private
  // location references, moderation provenance, or arbitrary document properties.
  if (!areas.length || areas.some((s) => !known.includes(s)) ||
      !["STANDARD", "DEEP"].includes(scope.cleaning_level) ||
      !/^(?:(?:one|two|three|four|five|six|seven|eight|nine|ten|[1-9][0-9]{0,3}) (?:rooms?|items?|square feet)|(?:small|medium|large) (?:apartment|home))$/.test(scope.approximate_scale) ||
      !/^nyc:borough:(manhattan|bronx|brooklyn|queens|staten_island)$/.test(job.eligibility_geography?.borough_id || "") ||
      !["HOURLY", "FIXED"].includes(job.poster_offer?.pricing_mode) || job.poster_offer.currency !== "USD" ||
      !Number.isSafeInteger(job.poster_offer.poster_entered_amount_minor) || job.poster_offer.poster_entered_amount_minor < 0) fail("job_unavailable");
  const media = renderMedia ? await readMarketplacePhotos(tx, db, job, storage, now) : undefined;
  const selection = ownerRead ? await readSelection(tx, db, job, fail) : null;
  const scopeState = selection ? await readScope(tx, db, job, selection) : {};
  return { ...scopeState, ...(selection ? { selection: selectionProjection(selection) } : {}), ...(media === undefined ? {} : { media }), job_ref: job.job_ref, job_version: job.job_version, title: "General Cleaning", task_type_id: "general_cleaning",
    borough_id: job.eligibility_geography.borough_id,
    schedule: { start_at: draft.schedule_window.start_at, end_at: draft.schedule_window.end_at, time_zone: draft.schedule_window.time_zone },
    duration_minutes: draft.duration_minutes,
    scope: { areas_items: areas, cleaning_level: scope.cleaning_level, approximate_scale: scope.approximate_scale },
    offer: { pricing_mode: job.poster_offer.pricing_mode, amount_minor: job.poster_offer.poster_entered_amount_minor, currency: "USD" },
    published_at: job.published_at };
}

function responseProjection(r) {
  if (!r || r.status !== "SUBMITTED" || !id(r.response_ref) || !id(r.job_ref) || !id(r.worker_ref) ||
      !Number.isSafeInteger(r.job_version) || r.job_version < 1 || !id(r.intent_key) ||
      !validText(r.message, 1000, true) || !Number.isFinite(Date.parse(r.created_at))) fail("unknown");
  return { response_ref: r.response_ref, job_ref: r.job_ref, job_version: r.job_version,
    status: r.status, message: r.message, created_at: r.created_at, worker_label: "Worker", intent_key: r.intent_key };
}
const responseId = (job, worker) => commandPayloadDigest(["v2-worker-response-1", job, worker]);

function validate(data) {
  const keys = { selected_jobs: ["operation", "cursor"],
    propose_scope: ["operation", "job_ref", "job_version", "expected_scope_version", "maximum_billable_minutes", "intent_key"],
    accept_scope: ["operation", "job_ref", "job_version", "expected_scope_version", "intent_key"],
    decline_scope: ["operation", "job_ref", "job_version", "expected_scope_version", "intent_key"],
    browse: ["operation", "cursor"], posted: ["operation", "cursor"],
    detail: ["operation", "job_ref"], responses: ["operation", "job_ref", "cursor"],
    select: ["operation", "job_ref", "job_version", "response_ref", "intent_key"],
    respond: ["operation", "job_ref", "job_version", "intent_key", "message"] };
  if (!data || !Object.hasOwn(keys, data.operation) || !exactKeys(data, keys[data.operation]) ||
      (Object.hasOwn(data, "cursor") && data.cursor !== null && !id(data.cursor)) ||
      (Object.hasOwn(data, "job_ref") && !id(data.job_ref)) ||
      (["propose_scope", "accept_scope", "decline_scope"].includes(data.operation) && (!Number.isSafeInteger(data.job_version) || data.job_version < 1 ||
        !Number.isSafeInteger(data.expected_scope_version) || data.expected_scope_version < 0 || !id(data.intent_key) || data.intent_key.length < 16)) ||
      (data.operation === "select" && (!Number.isSafeInteger(data.job_version) || data.job_version < 1 ||
        !id(data.response_ref) || !id(data.intent_key) || data.intent_key.length < 16)) ||
      (data.operation === "respond" && (!Number.isSafeInteger(data.job_version) || data.job_version < 1 ||
        !id(data.intent_key) || data.intent_key.length < 16 || !validText(data.message, 1000, true)))) fail("invalid_request");
}

function createMarketplaceCallable({ db, auth, storage, HttpsError, clock = () => new Date() }) {
  return async (data, context) => {
    try {
      const uid = context?.auth?.uid;
      if (!id(uid)) fail("authentication_required");
      validate(data);
      // Snapshot the command before asynchronous work; no client can alter its identity.
      data = JSON.parse(JSON.stringify(data));
      let user;
      try { user = await auth.getUser(uid); } catch (_) { fail("temporarily_unavailable"); }
      if (user.uid !== uid || user.disabled !== false) fail("account_unavailable");
      const now = clock();
      return await db.runTransaction(async (tx) => {
        const op = data.operation;
        if (op === "browse" || op === "posted" || op === "selected_jobs") {
          if (op === "browse") await requestStanding(tx, db, auth, uid, now);
          // Document-ID pagination needs no composite index; bounded scanned page.
          let query = db.collection("v2PublishedJobs").orderBy("__name__").limit(PAGE);
          if (data.cursor) query = query.startAfter(data.cursor);
          const page = await tx.get(query); const jobs = [];
          for (const snap of page.docs) {
            const job = snap.data();
            if (op !== "selected_jobs" && (op === "posted") !== (job.owner_ref === uid)) continue;
            try {
              if (op === "browse") await requestStanding(tx, db, auth, job.owner_ref, now);
              if (op === "selected_jobs") {
                if (job.job_lifecycle_state !== "SELECTION_PENDING_FUNDING" || job.poster_offer?.pricing_mode !== "HOURLY") continue;
                const selection = await readSelection(tx, db, job, fail);
                if (selection?.worker_ref !== uid) continue;
                const projected = await projectJob(tx, db, job, now, storage, true, true);
                delete projected.selection;
                jobs.push({ ...projected, selected_for_you: true });
              } else jobs.push(await projectJob(tx, db, job, now, storage, true, op === "posted"));
            } catch (e) {
              if (!(e instanceof MarketplaceFailure) || !["job_unavailable", "eligibility_unavailable", "not_permitted"].includes(e.reason)) throw e;
            }
          }
          return { schema_version: 1, jobs, next_cursor: page.docs.length === PAGE ? page.docs.at(-1).id : null };
        }
        const job = await record(tx, db, "v2PublishedJobs", data.job_ref);
        if (!job || job.job_ref !== data.job_ref) fail("job_unavailable");
        if (["propose_scope", "accept_scope", "decline_scope"].includes(op)) {
          const selection = await readSelection(tx, db, job, fail);
          if (!selection || ![job.owner_ref, selection.worker_ref].includes(uid)) fail("not_permitted");
          await projectJob(tx, db, job, now, storage, false, true);
          const hourly_scope = await mutateScope({ tx, db, job, selection, command: data, uid, now, fail });
          return { schema_version: 1, hourly_scope };
        }
        if (op === "detail" && job.owner_ref !== uid && job.job_lifecycle_state === "SELECTION_PENDING_FUNDING") {
          const selection = await readSelection(tx, db, job, fail);
          if (selection?.worker_ref !== uid || job.poster_offer?.pricing_mode !== "HOURLY") fail("not_permitted");
          const projected = await projectJob(tx, db, job, now, storage, true, true);
          delete projected.selection;
          const response = await record(tx, db, `v2PublishedJobs/${job.job_ref}/responses`, selection.response_ref);
          return { schema_version: 1, job: { ...projected, selected_for_you: true }, response: responseProjection(response) };
        }
        if (op === "select") {
          const selection = await selectResponse({ tx, db, job, command: data, uid, now, fail, responseId,
            standing: (actor) => requestStanding(tx, db, auth, actor, now),
            validateOpenJob: () => projectJob(tx, db, job, now, storage, false) });
          return { schema_version: 1, selection };
        }
        if (op === "detail" && job.owner_ref === uid) {
          return { schema_version: 1, job: await projectJob(tx, db, job, now, storage, true, true), response: null };
        }
        if (op === "responses") {
          if (job.owner_ref !== uid) fail("not_permitted");
          let query = db.collection("v2PublishedJobs").doc(data.job_ref).collection("responses").orderBy("__name__").limit(PAGE);
          if (data.cursor) query = query.startAfter(data.cursor);
          const page = await tx.get(query);
          const selection = await readSelection(tx, db, job, fail);
          const selectedResponse = selection ? await record(tx, db, `v2PublishedJobs/${job.job_ref}/responses`, selection.response_ref) : null;
          return { schema_version: 1, selection: selection ? selectionProjection(selection) : null,
            selected_response: selectedResponse ? responseProjection(selectedResponse) : null, responses: page.docs.map((s) => responseProjection(s.data())), next_cursor: page.docs.length === PAGE ? page.docs.at(-1).id : null };
        }
        if (job.owner_ref === uid) fail("not_permitted");
        const provenance = await requestStanding(tx, db, auth, uid, now);
        const ref = db.collection("v2PublishedJobs").doc(data.job_ref).collection("responses").doc(responseId(data.job_ref, uid));
        const snapshot = await tx.get(ref); const previous = snapshot.exists ? snapshot.data() : null;
        if (previous && (previous.worker_ref !== uid || previous.job_ref !== data.job_ref)) fail("unknown");
        if (op === "respond" && previous) {
          if (previous.intent_key === data.intent_key) {
            if (previous.command_digest !== commandPayloadDigest(data)) fail("request_conflict");
            return { schema_version: 1, response: responseProjection(previous) };
          }
          fail("already_responded");
        }
        const posterProvenance = await requestStanding(tx, db, auth, job.owner_ref, now);
        const projection = await projectJob(tx, db, job, now, storage, op === "detail");
        if (op === "detail") return { schema_version: 1, job: projection, response: previous ? responseProjection(previous) : null };
        if (data.job_version !== job.job_version) fail("job_changed");
        const decision = { record_type: "MATCHING_DECISION", decision_id: ref.id, job_ref: job.job_ref, worker_ref: uid,
          decision_type: "WORKER_INITIATED_REQUEST_ELIGIBILITY", policy_version: POLICY,
          normalized_input_versions: { job: String(job.job_version), task: job.task_scope_policy_version,
            standing: provenance.standing_policy_version, safety: String(provenance.safety_decision_version),
            poster_safety: String(posterProvenance.safety_decision_version) },
          decided_at: now.toISOString(), outcome: "ELIGIBLE", ordered_reason_codes: [], ranking: null,
          backend_authoritative: true, schema_version: 1 };
        const response = { response_ref: ref.id, job_ref: job.job_ref, job_version: job.job_version,
          worker_ref: uid, status: "SUBMITTED", message: data.message, created_at: now.toISOString(),
          intent_key: data.intent_key, command_digest: commandPayloadDigest(data), decision };
        tx.create(ref, response);
        return { schema_version: 1, response: responseProjection(response) };
      });
    } catch (e) {
      const reason = e instanceof MarketplaceFailure ? e.reason : "temporarily_unavailable";
      const code = reason === "authentication_required" ? "unauthenticated" : reason === "invalid_request" ? "invalid-argument" : reason === "temporarily_unavailable" ? "unavailable" : "failed-precondition";
      throw new HttpsError(code, "This marketplace request could not be completed.", { domain: "v2_marketplace", version: 1, reason });
    }
  };
}
module.exports = { createMarketplaceCallable, responseId };
