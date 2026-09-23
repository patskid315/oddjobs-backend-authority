"use strict";

const crypto = require("node:crypto");

// These are the initial ordinary-job states in the frozen #14 publication
// receipt. They are not a complete lifecycle or a client-writable state API.
const INITIAL_PUBLICATION_STATE = Object.freeze({
  job_lifecycle_state: "PUBLISHED_OPEN",
  financial_state: "NOT_REQUIRED_YET",
  job_lifecycle_version: 2,
  financial_state_version: 2
});

const COMMAND_KINDS = Object.freeze({
  PUBLICATION: "ORDINARY_JOB_PUBLICATION_COMMAND",
  SELECTION_FUNDING: "ORDINARY_JOB_SELECTION_FUNDING_COMMAND"
});

function nonempty(value, name) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new TypeError(`${name} must be a nonempty, unpadded string`);
  }
  return value;
}

function commandIdentity({ kind, actorRef, idempotencyKey }) {
  if (!Object.values(COMMAND_KINDS).includes(kind)) throw new TypeError("Unsupported V2 command kind");
  nonempty(actorRef, "actorRef");
  nonempty(idempotencyKey, "idempotencyKey");
  if (idempotencyKey.length < 16 || idempotencyKey.length > 200) {
    throw new TypeError("idempotencyKey must be 16-200 characters");
  }
  // Length-prefixing avoids ambiguous concatenations. The digest is a stable
  // document identity, not authorization or proof that a command succeeded.
  const parts = ["oddjobs-v2-command-v1", kind, actorRef, idempotencyKey];
  const encoded = parts.map((part) => `${Buffer.byteLength(part, "utf8")}:${part}`).join("");
  return crypto.createHash("sha256").update(encoded, "utf8").digest("hex");
}

function canonicalJSON(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(",")}}`;
  }
  throw new TypeError("Command payload must contain only JSON values and safe integers");
}

function commandPayloadDigest(payload) {
  return crypto.createHash("sha256").update(canonicalJSON(payload), "utf8").digest("hex");
}

function assertSameCommandPayload(recordedDigest, payload) {
  if (!/^[0-9a-f]{64}$/.test(recordedDigest) || recordedDigest !== commandPayloadDigest(payload)) {
    throw new TypeError("Idempotency identity reused with a different command payload");
  }
  return true;
}

function assertInitialPublicationState(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("Publication state must be an object");
  }
  for (const [field, expected] of Object.entries(INITIAL_PUBLICATION_STATE)) {
    if (record[field] !== expected) throw new TypeError(`Invalid initial publication ${field}`);
  }
  if (record.selected_worker_ref !== null || record.assignment_created !== false ||
      record.payout_eligible !== false || record.payment_or_funding_record_created !== false) {
    throw new TypeError("Publication cannot establish assignment or financial obligations");
  }
  return true;
}

function classifyPublicationRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return "UNRECOGNIZED";
  }
  // A legacy status or a single V2-looking field can never become a V2 receipt.
  if (record.record_type !== "ORDINARY_JOB_PUBLICATION_RECEIPT") return "LEGACY_OR_UNRECOGNIZED";
  assertInitialPublicationState(record);
  const strings = ["publication_receipt_id", "publication_idempotency_key", "job_ref", "owner_ref", "published_at"];
  const falseFields = ["stripe_customer_required", "saved_payment_method_required", "payment_intent_created",
    "charge_created", "proactive_notification_authorized"];
  const allowed = new Set([
    "record_type", "publication_receipt_id", "publication_idempotency_key", "job_ref", "owner_ref",
    "job_lifecycle_state", "discovery_visibility", "hire_again_relationship_ref", "financial_state",
    "job_lifecycle_version", "financial_state_version", "published_at", "job_version",
    "backend_authoritative", "payment_or_funding_record_created", "selected_worker_ref",
    "assignment_created", "payout_eligible", ...falseFields
  ]);
  if (record.backend_authoritative !== true ||
      Object.keys(record).some((field) => !allowed.has(field)) ||
      strings.some((field) => typeof record[field] !== "string" || !record[field]) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(record.published_at || "") ||
      !Number.isFinite(Date.parse(record.published_at)) ||
      record.publication_idempotency_key.length < 16 || record.publication_idempotency_key.length > 200 ||
      !Number.isInteger(record.job_version) || record.job_version < 1 ||
      !["MARKETPLACE_OPEN", "PRIVATE_FIRST"].includes(record.discovery_visibility) ||
      (record.discovery_visibility === "PRIVATE_FIRST" ?
        typeof record.hire_again_relationship_ref !== "string" || !record.hire_again_relationship_ref :
        record.hire_again_relationship_ref !== null) ||
      falseFields.some((field) => record[field] !== false)) {
    throw new TypeError("Incomplete backend publication receipt");
  }
  return "V2_PUBLICATION_RECEIPT";
}

module.exports = {
  INITIAL_PUBLICATION_STATE,
  COMMAND_KINDS,
  commandIdentity,
  commandPayloadDigest,
  assertSameCommandPayload,
  assertInitialPublicationState,
  classifyPublicationRecord
};
