"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHomeAuthorities } = require("../src/v2/homeLocation");
const { createProtectedLocationCallable } = require("../src/v2/protectedLocationCallable");
class HttpsError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }
const ctx = uid => ({ auth: { uid } });
const request = (unit = "SYNTHETIC UNIT") => ({ intent_key: `synthetic-home-location-${unit}`, address: { house_number: "123", street: "EXAMPLE STREET", zip_code: "10451", unit } });
function setup() {
  const records = new Map([["users/owner", { onboardingStep: "addressInput", accountStatus: "queued", address: "legacy unverified" }]]);
  const claims = [];
  const snap = ref => ({ exists: records.has(ref.key), data: () => records.get(ref.key) });
  const set = (ref, value, options) => records.set(ref.key, options?.merge ? { ...records.get(ref.key), ...value } : value);
  const db = { collection: name => ({ doc: id => { const ref = { key: `${name}/${id}` }; ref.get = async () => snap(ref); ref.set = async (v, o) => set(ref, v, o); return ref; } }),
    runTransaction: async work => work({ get: async ref => snap(ref), set, create: set }) };
  const auth = { getUser: async () => ({ customClaims: { unrelated: true, out_of_area: true } }), setCustomUserClaims: async (uid, value) => claims.push({ uid, value }) };
  const authority = createHomeAuthorities({ db, auth, HttpsError });
  const verify = createProtectedLocationCallable({ db, HttpsError, validator: { providerId: "NYC_GEOCLIENT_V2", validateExactAddress: async (_, digest) => ({ provider_id: "NYC_GEOCLIENT_V2", input_digest: digest, status: "EXACT_ADDRESS", dataset_version: "synthetic", provider_reference: "synthetic", matches: [{ geosupport_return_code: "00", input_match_confirmed: true, borough_code: "2" }] }) } });
  return { records, claims, auth, ...authority, verify };
}
const reason = expected => error => error.details?.reason === expected;
test("unauthenticated, legacy address and client borough cannot establish completion", async () => {
  const f = setup();
  await assert.rejects(f.finalize({}, {}), reason("authentication_required"));
  for (const input of [{}, { selectedBorough: "Manhattan" }]) await assert.rejects(f.finalize(input, ctx("owner")), reason("verified_home_required"));
  assert.equal(f.records.get("users/owner").onboardingStep, "addressInput"); assert.equal(f.claims.length, 0);
  assert.deepEqual(await f.savedHome({ operation: "get" }, ctx("owner")), { schema_version: 1, home: null });
});
test("verified owner home preserves unit, finalizes with authoritative borough and preserves unrelated claims", async () => {
  const f = setup(); const receipt = await f.verify(request(), ctx("owner"));
  const saved = await f.savedHome({ operation: "set", protected_ref: receipt.protected_ref }, ctx("owner"));
  assert.equal(saved.home.address.unit, "SYNTHETIC UNIT");
  assert.deepEqual(await f.savedHome({ operation: "get" }, ctx("owner")), saved);
  assert.equal(f.records.get("users/owner").onboardingStep, "addressInput");
  const result = await f.finalize({ selectedBorough: "Manhattan" }, ctx("owner"));
  assert.equal(result.ok, true); assert.equal(result.status, "queued");
  assert.equal(f.records.get("users/owner").borough, "Bronx");
  assert.equal(f.records.get("users/owner").onboardingStep, "completed");
  assert.deepEqual(f.claims[0].value, { unrelated: true, region: "nyc", onboarded: true, waitlist: true });
  await f.finalize({}, ctx("owner")); assert.deepEqual(f.claims[1], f.claims[0]);
});
test("foreign, forged and invalid evidence fails closed", async () => {
  const f = setup(); const receipt = await f.verify(request(), ctx("other"));
  await assert.rejects(f.savedHome({ operation: "set", protected_ref: receipt.protected_ref }, ctx("owner")), reason("verified_home_required"));
  await assert.rejects(f.savedHome({ operation: "get", owner_ref: "other" }, ctx("owner")), reason("invalid_request"));
  f.records.set("v2SavedHomeLocations/owner", { schema_version: 1, owner_ref: "owner", protected_ref: receipt.protected_ref });
  await assert.rejects(f.finalize({}, ctx("owner")), reason("verified_home_required"));
  const own = await f.verify(request(), ctx("owner"));
  await f.savedHome({ operation: "set", protected_ref: own.protected_ref }, ctx("owner"));
  const key = `v2ProtectedLocations/${own.protected_ref}`; const original = f.records.get(key);
  for (const patch of [{ derivation_state: "UNRESOLVED" }, { address_digest: "0".repeat(64) }, { source: "CLIENT" }, { borough_id: "outside" }]) {
    f.records.set(key, { ...original, ...patch });
    await assert.rejects(f.finalize({}, ctx("owner")), reason("verified_home_required"));
  }
  assert.equal(f.claims.length, 0);
});
test("changing home only changes private linkage, never immutable locations or existing job references", async () => {
  const f = setup(); const a = await f.verify(request("A"), ctx("owner"));
  await f.savedHome({ operation: "set", protected_ref: a.protected_ref }, ctx("owner"));
  const snapshot = structuredClone(f.records.get(`v2ProtectedLocations/${a.protected_ref}`));
  f.records.set("v2PublishedJobPrivate/job", { protected_fulfillment_location_ref: a.protected_ref });
  const b = await f.verify(request("B"), ctx("owner"));
  await f.savedHome({ operation: "set", protected_ref: b.protected_ref }, ctx("owner"));
  assert.deepEqual(f.records.get(`v2ProtectedLocations/${a.protected_ref}`), snapshot);
  assert.equal(f.records.get("v2PublishedJobPrivate/job").protected_fulfillment_location_ref, a.protected_ref);
  assert.equal((await f.savedHome({ operation: "get" }, ctx("owner"))).home.protected_ref, b.protected_ref);
});
test("failed verification cannot save home or finalize; existing completed profiles are not revoked", async () => {
  const f = setup(); const bad = request(); bad.address.zip_code = "bad";
  await assert.rejects(f.verify(bad, ctx("owner")));
  await assert.rejects(f.finalize({}, ctx("owner")), reason("verified_home_required"));
  assert.equal(f.records.get("users/owner").onboardingStep, "addressInput");
  f.records.set("users/legacy", { onboardingStep: "completed", accountStatus: "active" });
  await assert.rejects(f.finalize({}, ctx("legacy")), reason("verified_home_required"));
  assert.equal(f.records.get("users/legacy").onboardingStep, "completed"); assert.equal(f.claims.length, 0);
});

test("Auth service failure leaves profile resumable and a retry completes", async () => {
  const f = setup(); const receipt = await f.verify(request(), ctx("owner"));
  await f.savedHome({ operation: "set", protected_ref: receipt.protected_ref }, ctx("owner"));
  const setter = f.auth.setCustomUserClaims;
  f.auth.setCustomUserClaims = async () => { throw new Error("synthetic internal failure"); };
  await assert.rejects(f.finalize({}, ctx("owner")), reason("temporarily_unavailable"));
  assert.equal(f.records.get("users/owner").onboardingStep, "addressInput");
  f.auth.setCustomUserClaims = setter;
  f.records.get("users/owner").accountStatus = "created";
  assert.equal((await f.finalize({}, ctx("owner"))).status, "active");
  assert.equal(f.claims[0].value.waitlist, false);
});
