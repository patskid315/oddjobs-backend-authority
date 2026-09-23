"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TASKS_BY_CATEGORY, BOROUGH_IDS, resolveCanonicalTask, classifyPolicyDisposition,
  publicationStandingGate, projectEligibilityGeography
} = require("../src/v2/publicationPrerequisites");

test("approved taxonomy identity is bounded and separate from eligibility", () => {
  assert.equal(Object.keys(TASKS_BY_CATEGORY).length, 17);
  assert.equal(Object.values(TASKS_BY_CATEGORY).flat().length, 22);
  assert.equal(new Set(Object.values(TASKS_BY_CATEGORY).flat()).size, 22);
  assert.deepEqual(resolveCanonicalTask({ taskTypeId: "mount_tv", taxonomyVersion: 2 }), {
    kind: "CANONICAL_TASK", taskTypeId: "mount_tv", categoryId: "mounting_installation",
    taxonomyVersion: 2, separateResearchLifecycle: false
  });
  assert.equal(resolveCanonicalTask({ taskTypeId: "research_study", taxonomyVersion: 2 }).separateResearchLifecycle, true);
  for (const taskTypeId of ["Building", "Home Care", "Cooking", "Music", "unknown_task"]) {
    assert.equal(resolveCanonicalTask({ taskTypeId, taxonomyVersion: 2 }).kind, "UNKNOWN_TASK");
  }
  assert.equal(resolveCanonicalTask({ taskTypeId: "mount_tv", taxonomyVersion: 1 }).kind, "UNKNOWN_TASK");
});

test("policy dispositions remain explicit and never inferred from task identity", () => {
  for (const value of ["SUPPORTED_ADVISORY", "ESCALATION_REQUIRED", "UNSUPPORTED_WITHHOLD", "UNCLASSIFIED_LEGACY"]) {
    assert.equal(classifyPolicyDisposition(value), value);
  }
  assert.equal(classifyPolicyDisposition("SUPPORTED"), "UNKNOWN_POLICY");
  assert.equal(classifyPolicyDisposition(undefined), "UNKNOWN_POLICY");
});

test("standing and safety require matching protected backend evidence", () => {
  const standing = { subject_ref: "poster-1", authority: "BACKEND_DOMAIN", source: "FIREBASE_ADMIN_AUTH", policy_version: "v1", publication_allowed: true };
  const safety = { subject_ref: "poster-1", authority: "BACKEND_DOMAIN", source: "V2_SAFETY_DECISION", decision_version: 1, policy_version: "v1", publication_clear: true };
  assert.equal(publicationStandingGate({ actorRef: "poster-1", standing, safety }).allowed, true);
  assert.equal(publicationStandingGate({ actorRef: "poster-1", standing: null, safety }).allowed, false);
  assert.equal(publicationStandingGate({ actorRef: "poster-1", standing: { accountStatus: "active" }, safety }).allowed, false);
  assert.equal(publicationStandingGate({ actorRef: "poster-1", standing, safety: { ...safety, subject_ref: "other" } }).allowed, false);
  assert.equal(publicationStandingGate({ actorRef: "poster-1", standing: { ...standing, publication_allowed: false }, safety }).allowed, false);
  assert.equal(publicationStandingGate({ actorRef: "poster-1", standing, safety: { ...safety, publication_clear: false } }).allowed, false);
});

test("borough-only public projection cannot leak protected fulfillment location", () => {
  assert.equal(BOROUGH_IDS.size, 5);
  const protectedLocation = {
    authority: "BACKEND_VALIDATED_LOCATION", registry_version: "v2-planning-1",
    derivation_state: "VALIDATED",
    source: "NYC_GEOCLIENT_V2", derivation_version: "v2-nyc-address-1",
    dataset_version: "test-dataset", provider_reference: "test-record",
    address_digest: "a".repeat(64), validated_at: new Date("2026-09-23T10:00:00Z"),
    applicability: "IN_PERSON", borough_id: "nyc:borough:queens", neighborhood_id: null,
    protected_ref: "private-location-1", street_address: "private street", unit: "private unit",
    latitude: 40.0, longitude: -73.0
  };
  const projection = projectEligibilityGeography(protectedLocation);
  assert.equal(projection.borough_id, "nyc:borough:queens");
  for (const field of ["protected_ref", "street_address", "unit", "latitude", "longitude"]) {
    assert.equal(Object.hasOwn(projection, field), false);
  }
  assert.throws(() => projectEligibilityGeography({ ...protectedLocation, authority: "CLIENT" }));
  assert.throws(() => projectEligibilityGeography({ ...protectedLocation, borough_id: "nyc:borough:unknown" }));
  assert.throws(() => projectEligibilityGeography({ ...protectedLocation, neighborhood_id: "nyc:neighborhood:queens:unknown" }));
  assert.deepEqual(projectEligibilityGeography({
    authority: "BACKEND_VALIDATED_LOCATION", registry_version: "v2-planning-1",
    applicability: "REMOTE", borough_id: null, protected_ref: null
  }), { applicability: "REMOTE", borough_id: null, neighborhood_id: null,
    geography_registry_version: "v2-planning-1", contains_exact_address_or_coordinates: false });
});
