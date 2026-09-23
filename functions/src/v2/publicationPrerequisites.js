"use strict";

// Versioned runtime snapshot of TASK_TAXONOMY.yaml at frozen governance
// 5b8e46b8327598d497fa4c2a0dc566e3d83b9d5c (OJNY-V2-GOV-1.0.0).
// This validates identity only; it never decides whether a particular scope
// is safe, permitted, publishable, matchable, or fundable.
const TAXONOMY_VERSION = 2;
const TASKS_BY_CATEGORY = Object.freeze({
  cleaning_home_help: ["general_cleaning", "home_organizing"],
  furniture_assembly: ["furniture_assembly"],
  moving_help: ["move_items"],
  delivery_errands: ["item_pickup_dropoff", "shopping_errand", "waiting_queueing"],
  pet_care: ["pet_support"],
  outdoor_seasonal_help: ["seasonal_help"],
  technology_help: ["device_help"],
  creative_services: ["photography", "design_service"],
  junk_removal: ["junk_removal"],
  research_participation: ["research_study"],
  mounting_installation: ["mount_picture_shelf", "mount_tv"],
  senior_non_medical_assistance: ["companion_support"],
  cooking: ["meal_preparation"],
  music: ["music_service"],
  tutoring: ["academic_tutoring"],
  laundry: ["laundry_help"],
  minor_handyman: ["minor_home_task"]
});
const taskToCategory = new Map(Object.entries(TASKS_BY_CATEGORY)
  .flatMap(([categoryId, tasks]) => tasks.map((taskTypeId) => [taskTypeId, categoryId])));

const POLICY_DISPOSITIONS = Object.freeze({
  SUPPORTED_ADVISORY: "SUPPORTED_ADVISORY",
  ESCALATION_REQUIRED: "ESCALATION_REQUIRED",
  UNSUPPORTED_WITHHOLD: "UNSUPPORTED_WITHHOLD",
  UNCLASSIFIED_LEGACY: "UNCLASSIFIED_LEGACY"
});

function resolveCanonicalTask({ taskTypeId, taxonomyVersion }) {
  if (taxonomyVersion !== TAXONOMY_VERSION || typeof taskTypeId !== "string" ||
      !taskToCategory.has(taskTypeId)) return { kind: "UNKNOWN_TASK" };
  return Object.freeze({
    kind: "CANONICAL_TASK",
    taskTypeId,
    categoryId: taskToCategory.get(taskTypeId),
    taxonomyVersion,
    separateResearchLifecycle: taskTypeId === "research_study"
  });
}

function classifyPolicyDisposition(value) {
  return Object.values(POLICY_DISPOSITIONS).includes(value) ? value : "UNKNOWN_POLICY";
}

// This gate consumes facts produced by standingSafetyAuthority. The historical
// v2Standing test collection is not a source: account standing is read fresh
// from Firebase Admin Auth, while safety comes from an audited protected record.
function publicationStandingGate({ actorRef, standing, safety }) {
  if (typeof actorRef !== "string" || !actorRef) return { allowed: false, reason: "UNKNOWN_ACTOR" };
  if (!standing || !safety || standing.subject_ref !== actorRef || safety.subject_ref !== actorRef ||
      standing.authority !== "BACKEND_DOMAIN" || safety.authority !== "BACKEND_DOMAIN" ||
      standing.source !== "FIREBASE_ADMIN_AUTH" || safety.source !== "V2_SAFETY_DECISION" ||
      !Number.isSafeInteger(safety.decision_version) || safety.decision_version < 1 ||
      typeof standing.policy_version !== "string" || !standing.policy_version ||
      typeof safety.policy_version !== "string" || !safety.policy_version) {
    return { allowed: false, reason: "AUTHORITY_UNAVAILABLE" };
  }
  if (standing.publication_allowed !== true || safety.publication_clear !== true) {
    return { allowed: false, reason: "STANDING_OR_SAFETY_BLOCKED" };
  }
  return { allowed: true, reason: "CLEAR" };
}

async function readPublicationStanding(tx, db, actorRef, { auth, now } = {}) {
  const { readCurrentPublicationStanding } = require("./standingSafetyAuthority");
  return readCurrentPublicationStanding({ tx, db, actorRef, auth, now });
}

const GEOGRAPHY_REGISTRY_VERSION = "v2-planning-1";
const BOROUGH_IDS = new Set([
  "nyc:borough:manhattan", "nyc:borough:bronx", "nyc:borough:brooklyn",
  "nyc:borough:queens", "nyc:borough:staten_island"
]);

// Only a backend-validated protected location may be projected. This does not
// geocode or accept a client-supplied borough as derivation evidence.
function projectEligibilityGeography(protectedLocation) {
  if (!protectedLocation || protectedLocation.authority !== "BACKEND_VALIDATED_LOCATION" ||
      protectedLocation.registry_version !== GEOGRAPHY_REGISTRY_VERSION) {
    throw new TypeError("Backend-validated location required");
  }
  if (protectedLocation.applicability === "REMOTE") {
    if (protectedLocation.borough_id != null || protectedLocation.protected_ref != null) {
      throw new TypeError("Remote work cannot carry physical geography");
    }
    return Object.freeze({ applicability: "REMOTE", borough_id: null, neighborhood_id: null,
      geography_registry_version: GEOGRAPHY_REGISTRY_VERSION, contains_exact_address_or_coordinates: false });
  }
  if (protectedLocation.applicability !== "IN_PERSON" ||
      !BOROUGH_IDS.has(protectedLocation.borough_id) ||
      typeof protectedLocation.protected_ref !== "string" || !protectedLocation.protected_ref ||
      protectedLocation.neighborhood_id != null) {
    throw new TypeError("Validated borough-level in-person location required");
  }
  return Object.freeze({ applicability: "IN_PERSON", borough_id: protectedLocation.borough_id,
    neighborhood_id: null, geography_registry_version: GEOGRAPHY_REGISTRY_VERSION,
    contains_exact_address_or_coordinates: false });
}

async function readEligibilityGeography(tx, db, protectedRef, expectedOwnerRef) {
  if (typeof protectedRef !== "string" || !protectedRef || protectedRef.includes("/") ||
      typeof expectedOwnerRef !== "string" || !expectedOwnerRef) {
    throw new TypeError("Opaque protected location reference required");
  }
  const snapshot = await tx.get(db.collection("v2ProtectedLocations").doc(protectedRef));
  if (!snapshot.exists) throw new TypeError("Protected location unavailable");
  if (snapshot.data().owner_ref !== expectedOwnerRef || snapshot.data().protected_ref !== protectedRef) {
    throw new TypeError("Protected location ownership mismatch");
  }
  return projectEligibilityGeography(snapshot.data());
}

module.exports = {
  TAXONOMY_VERSION, TASKS_BY_CATEGORY, POLICY_DISPOSITIONS, GEOGRAPHY_REGISTRY_VERSION,
  BOROUGH_IDS, resolveCanonicalTask, classifyPolicyDisposition,
  publicationStandingGate, readPublicationStanding,
  projectEligibilityGeography, readEligibilityGeography
};
