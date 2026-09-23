"use strict";

// Internal domain authority only. This module does not export a Firebase
// Function or grant any principal the right to make moderation decisions.
const STANDING_POLICY_VERSION = "v2-standing-auth-1";
const SAFETY_POLICY_VERSION = "v2-safety-moderation-1";
const SAFETY_STATES = Object.freeze(["CLEAR", "BLOCKED", "REVOKED"]);

function validId(value) {
  return typeof value === "string" && value.length > 0 &&
    value.length <= 128 && !value.includes("/") && value !== "." && value !== "..";
}

function millis(value) {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toMillis === "function") return value.toMillis();
  return NaN;
}

function standingFromAuth(actorRef, authUser, checkedAt = new Date()) {
  if (!validId(actorRef) || !authUser || authUser.uid !== actorRef ||
      typeof authUser.disabled !== "boolean" ||
      !Number.isFinite(millis(checkedAt))) return null;
  return Object.freeze({ subject_ref: actorRef, authority: "BACKEND_DOMAIN",
    policy_version: STANDING_POLICY_VERSION, source: "FIREBASE_ADMIN_AUTH",
    checked_at: checkedAt, publication_allowed: authUser.disabled === false });
}

function safetyFromDecision(actorRef, decision, now) {
  const nowMs = millis(now);
  if (!validId(actorRef) || !Number.isFinite(nowMs) || !decision ||
      decision.subject_ref !== actorRef || decision.authority !== "BACKEND_DOMAIN" ||
      decision.source !== "V2_SAFETY_OPERATOR" ||
      decision.policy_version !== SAFETY_POLICY_VERSION ||
      !SAFETY_STATES.includes(decision.state) ||
      !validId(decision.operator_ref) || !validId(decision.reason_code) ||
      !Number.isSafeInteger(decision.version) || decision.version < 1 ||
      !Number.isFinite(millis(decision.decided_at)) || millis(decision.decided_at) > nowMs ||
      !Number.isFinite(millis(decision.valid_until)) ||
      millis(decision.valid_until) <= millis(decision.decided_at)) return null;
  return Object.freeze({ subject_ref: actorRef, authority: "BACKEND_DOMAIN",
    policy_version: SAFETY_POLICY_VERSION, source: "V2_SAFETY_DECISION",
    decision_version: decision.version,
    publication_clear: decision.state === "CLEAR" && millis(decision.valid_until) > nowMs });
}

// Auth is checked fresh for each evaluation. Auth and Firestore are distinct
// systems, so this is not an atomic cross-service snapshot. A caller must
// recheck close to the authoritative publication transition.
async function readCurrentPublicationStanding({ actorRef, auth, tx, db, now = new Date() }) {
  if (!validId(actorRef) || !auth || typeof auth.getUser !== "function" ||
      !tx || !db) return { allowed: false, reason: "AUTHORITY_UNAVAILABLE" };
  let authUser;
  try { authUser = await auth.getUser(actorRef); } catch (_) {
    return { allowed: false, reason: "AUTHORITY_UNAVAILABLE" };
  }
  const standing = standingFromAuth(actorRef, authUser, now);
  if (!standing) return { allowed: false, reason: "AUTHORITY_UNAVAILABLE" };
  // Even a disabled account cannot skip the protected read: no partial
  // positive result may be inferred from one source alone.
  let snapshot, audit;
  try {
    snapshot = await tx.get(db.collection("v2Safety").doc(actorRef));
    const decision = snapshot.exists ? snapshot.data() : null;
    if (decision && Number.isSafeInteger(decision.version) && decision.version > 0) {
      audit = await tx.get(db.collection("v2SafetyAudit").doc(`${actorRef}_${decision.version}`));
    }
  } catch (_) {
    return { allowed: false, reason: "AUTHORITY_UNAVAILABLE" };
  }
  const decision = snapshot.exists ? snapshot.data() : null;
  const auditRecord = audit && audit.exists ? audit.data() : null;
  if (!auditRecord || !decision || auditRecord.subject_ref !== decision.subject_ref ||
      auditRecord.version !== decision.version || auditRecord.state !== decision.state ||
      auditRecord.policy_version !== decision.policy_version ||
      auditRecord.source !== decision.source ||
      auditRecord.reason_code !== decision.reason_code ||
      auditRecord.operator_ref !== decision.operator_ref ||
      millis(auditRecord.decided_at) !== millis(decision.decided_at) ||
      millis(auditRecord.valid_until) !== millis(decision.valid_until)) {
    return { allowed: false, reason: "AUTHORITY_UNAVAILABLE" };
  }
  const safety = safetyFromDecision(actorRef, decision, now);
  if (!safety) return { allowed: false, reason: "AUTHORITY_UNAVAILABLE" };
  const { publicationStandingGate } = require("./publicationPrerequisites");
  const gate = publicationStandingGate({ actorRef, standing, safety });
  return { ...gate, provenance: { standing_policy_version: STANDING_POLICY_VERSION,
    auth_checked_at: now, safety_policy_version: SAFETY_POLICY_VERSION,
    safety_decision_version: safety.decision_version } };
}

// `authorizeSafetyOperator` is an internal, server-configured privilege
// verifier. It must not be backed by broad legacy adminUsers membership or a
// client-supplied claim. With no verifier, no writes are possible.
async function recordSafetyDecision({ db, operatorRef, subjectRef, state, reasonCode,
  expectedVersion, validUntil, authorizeSafetyOperator, now = new Date() }) {
  if (!validId(operatorRef) || !validId(subjectRef) ||
      !SAFETY_STATES.includes(state) || !validId(reasonCode) ||
      !Number.isSafeInteger(expectedVersion) || expectedVersion < 0 ||
      !Number.isFinite(millis(now)) || !Number.isFinite(millis(validUntil)) ||
      millis(validUntil) <= millis(now) ||
      typeof authorizeSafetyOperator !== "function" ||
      await authorizeSafetyOperator(operatorRef) !== true) {
    throw new Error("SAFETY_DECISION_NOT_AUTHORIZED");
  }
  return db.runTransaction(async (tx) => {
    const ref = db.collection("v2Safety").doc(subjectRef);
    const before = await tx.get(ref);
    const prior = before.exists ? before.data() : null;
    if (before.exists && (!prior || !Number.isSafeInteger(prior.version) || prior.version < 1)) {
      throw new Error("SAFETY_DECISION_VERSION_CONFLICT");
    }
    const version = before.exists ? prior.version : 0;
    if (version !== expectedVersion) {
      throw new Error("SAFETY_DECISION_VERSION_CONFLICT");
    }
    const nextVersion = version + 1;
    const decision = { subject_ref: subjectRef, authority: "BACKEND_DOMAIN",
      policy_version: SAFETY_POLICY_VERSION, source: "V2_SAFETY_OPERATOR",
      state, publication_clear: state === "CLEAR", reason_code: reasonCode,
      operator_ref: operatorRef, version: nextVersion, decided_at: now,
      valid_until: validUntil };
    const auditRef = db.collection("v2SafetyAudit").doc(`${subjectRef}_${nextVersion}`);
    tx.create(auditRef, { ...decision, prior_version: version });
    tx.set(ref, decision);
    return { subject_ref: subjectRef, state, version: nextVersion,
      policy_version: SAFETY_POLICY_VERSION };
  });
}

module.exports = { STANDING_POLICY_VERSION, SAFETY_POLICY_VERSION,
  standingFromAuth, safetyFromDecision, readCurrentPublicationStanding,
  recordSafetyDecision };
