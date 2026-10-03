"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createProtectedLocationCallable } = require("../src/v2/protectedLocationCallable");
const { createNYCGeoclientValidator } = require("../src/v2/nycGeoclientValidator");
const { commandPayloadDigest } = require("../src/v2/foundation");
const { readEligibilityGeography } = require("../src/v2/publicationPrerequisites");

class HttpsError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}
const context = { auth: { uid: "poster-1" } };
const request = () => ({ intent_key: "protected-location-intent-1", address: {
  house_number: "123", street: "EXAMPLE STREET", zip_code: "10451", unit: "PRIVATE UNIT"
} });
const code = (expected) => (error) => error.code === expected;
function result(digest) {
  return { provider_id: "NYC_GEOCLIENT_V2", input_digest: digest, status: "EXACT_ADDRESS",
    dataset_version: "synthetic-dataset", provider_reference: "synthetic-provider-ref",
    matches: [{ geosupport_return_code: "00", input_match_confirmed: true, borough_code: "2" }] };
}
function setup(validate = async (_, digest) => result(digest)) {
  const records = new Map();
  const calls = [];
  let reads = 0;
  const snapshot = (ref) => { reads++; return {
    exists: records.has(ref.key), data: () => records.get(ref.key)
  }; };
  // Sequential unit store; existing emulator regressions cover concurrency/rules.
  const db = {
    collection: (name) => ({ doc: (id) => { const ref = { key: `${name}/${id}` };
      ref.get = async () => snapshot(ref); return ref; } }),
    runTransaction: async (work) => work({ get: async (ref) => snapshot(ref),
      create: (ref, value) => records.set(ref.key, value),
      update: (ref, value) => records.set(ref.key, { ...records.get(ref.key), ...value }) })
  };
  const validator = { providerId: "NYC_GEOCLIENT_V2", validateExactAddress: async (address, digest) => {
    calls.push({ address, digest }); return validate(address, digest);
  } };
  return { db, records, calls, readCount: () => reads,
    handler: createProtectedLocationCallable({ db, HttpsError, validator }) };
}

test("authentication precedes all storage and provider work", async () => {
  const { handler, records, calls, readCount } = setup();
  for (const auth of [undefined, {}, { auth: {} }, { auth: { uid: "" } }, { auth: { uid: 123 } }]) {
    await assert.rejects(handler(request(), auth), code("unauthenticated"));
  }
  assert.equal(readCount(), 0);
  assert.equal(records.size, 0);
  assert.equal(calls.length, 0);
});

test("only minimal address and intent are accepted; client identity/geography/credentials rejected", async () => {
  const { handler, records, calls, readCount } = setup();
  const bad = [null, [], {}, { ...request(), intent_key: "short" },
    { ...request(), intent_key: "x".repeat(201) }, { ...request(), intent_key: "invalid\nintent-1234" },
    ...["owner_ref", "authenticatedOwnerRef", "protected_ref", "eligibility_geography",
      "validator", "subscription_key", "now", "expected_version"].map((key) => ({ ...request(), [key]: "forged" })),
    ...["borough", "borough_id", "neighborhood", "latitude", "longitude", "provider_id"]
      .map((key) => ({ ...request(), address: { ...request().address, [key]: "forged" } })),
    ...[{ zip_code: 10451 }, { unit: 2 }, { house_number: "" }, { street: "bad\naddress" },
      { zip_code: "123" }, { house_number: "x".repeat(25) }, { unit: "x".repeat(81) }]
      .map((patch) => ({ ...request(), address: { ...request().address, ...patch } }))];
  for (const body of bad) await assert.rejects(handler(body, context), code("invalid-argument"));
  assert.equal(readCount(), 0);
  assert.equal(records.size, 0);
  assert.equal(calls.length, 0);
});

test("authority receives caller ownership, protects unit and returns only reference/coarse projection", async () => {
  const { handler, records, calls } = setup();
  const receipt = await handler(request(), context);
  assert.deepEqual(Object.keys(receipt).sort(), ["eligibility_geography", "protected_ref"]);
  assert.match(receipt.protected_ref, /^[a-f0-9]{64}$/);
  assert.deepEqual(receipt.eligibility_geography, {
    applicability: "IN_PERSON", borough_id: "nyc:borough:bronx", neighborhood_id: null,
    geography_registry_version: "v2-planning-1", contains_exact_address_or_coordinates: false
  });
  const stored = records.get(`v2ProtectedLocations/${receipt.protected_ref}`);
  assert.equal(stored.owner_ref, context.auth.uid);
  assert.deepEqual(stored.exact_address, request().address);
  assert.equal(stored.source, "NYC_GEOCLIENT_V2");
  assert.equal(stored.dataset_version, "synthetic-dataset");
  assert.equal(stored.provider_reference, "synthetic-provider-ref");
  assert.ok(stored.validated_at instanceof Date);
  assert.deepEqual(calls[0].address, { house_number: "123", street: "EXAMPLE STREET", zip_code: "10451" });
  assert.equal(calls[0].digest, commandPayloadDigest(calls[0].address));
  for (const privateValue of ["EXAMPLE STREET", "PRIVATE UNIT", "10451", "synthetic-provider-ref", "dataset_version"]) {
    assert.equal(JSON.stringify(receipt).includes(privateValue), false);
  }
  assert.equal(records.size, 1);
});

test("same intent replays without provider calls; conflicts do not overwrite; owners stay isolated", async () => {
  const { handler, records, calls, db } = setup();
  const first = await handler(request(), context);
  assert.deepEqual(await handler(request(), context), first);
  assert.equal(calls.length, 1);
  for (const patch of [{ street: "OTHER STREET" }, { unit: "OTHER UNIT" }]) {
    await assert.rejects(handler({ ...request(), address: { ...request().address, ...patch } }, context),
      code("failed-precondition"));
  }
  assert.equal(calls.length, 1);
  const other = await handler(request(), { auth: { uid: "poster-2" } });
  assert.notEqual(other.protected_ref, first.protected_ref);
  assert.equal(records.size, 2);
  assert.equal(records.get(`v2ProtectedLocations/${first.protected_ref}`).owner_ref, "poster-1");
  await assert.rejects(db.runTransaction((tx) => readEligibilityGeography(tx, db, first.protected_ref, "poster-2")), /ownership/);
  const stored = records.get(`v2ProtectedLocations/${first.protected_ref}`);
  stored.derivation_state = "UNRESOLVED";
  await assert.rejects(handler(request(), context), code("failed-precondition"));
  assert.equal(calls.length, 2);
});

test("omitted and null unit use the existing authority's same normalized intent", async () => {
  const { handler, calls } = setup();
  const body = request(); delete body.address.unit;
  const receipt = await handler(body, context);
  assert.deepEqual(await handler({ ...body, address: { ...body.address, unit: null } }, context), receipt);
  assert.equal(calls.length, 1);
});

test("ambiguous, mismatched, warning and non-NYC evidence fails closed with zero writes", async () => {
  for (const change of [
    (r) => ({ ...r, status: "AMBIGUOUS" }), (r) => ({ ...r, input_digest: "wrong" }),
    (r) => ({ ...r, matches: [r.matches[0], r.matches[0]] }),
    (r) => ({ ...r, matches: [{ ...r.matches[0], borough_code: "6" }] }),
    (r) => ({ ...r, matches: [{ ...r.matches[0], geosupport_return_code: "01" }] }),
    (r) => ({ ...r, matches: [{ ...r.matches[0], input_match_confirmed: false }] }),
    (r) => ({ ...r, dataset_version: "" })
  ]) {
    const { handler, records } = setup(async (_, digest) => change(result(digest)));
    await assert.rejects(handler(request(), context), code("failed-precondition"));
    assert.equal(records.size, 0);
  }
});

test("provider or secret errors never reach the response or create records", async () => {
  const sensitive = ["synthetic", "key", "private address"].join("-");
  const { handler, records, db } = setup(async () => { throw new Error(sensitive); });
  const sanitized = (error) => error.code === "failed-precondition" &&
    error.message === "This address cannot be validated right now." && !error.stack.includes(sensitive);
  await assert.rejects(handler(request(), context), sanitized);
  let httpCalls = 0;
  const validator = createNYCGeoclientValidator({ getSubscriptionKey: () => { throw new Error(sensitive); },
    fetchImpl: async () => { httpCalls++; throw new Error("Must not call HTTP"); } });
  const noSecret = createProtectedLocationCallable({ db, HttpsError, validator });
  await assert.rejects(noSecret(request(), context), sanitized);
  assert.equal(httpCalls, 0);
  assert.equal(records.size, 0);
});

test("public typed reasons survive authority and callable with bounded sanitized details", async () => {
  const { ProtectedLocationFailure } = require("../src/v2/protectedLocationErrors");
  for (const reason of ["invalid_address_input", "address_not_resolved", "verification_temporarily_unavailable",
    "verification_unavailable", "rate_limited", "invalid_service_response", "unknown"]) {
    const s = setup(async () => { throw new ProtectedLocationFailure(reason); });
    await assert.rejects(s.handler(request(), context), (error) => {
      assert.deepEqual(error.details, { domain: "v2_protected_location", version: 1, reason });
      assert.equal(error.code, reason === "invalid_address_input" ? "invalid-argument" :
        reason === "rate_limited" ? "resource-exhausted" : reason === "verification_temporarily_unavailable" ? "unavailable" : "failed-precondition");
      assert.ok(!JSON.stringify(error).includes("PRIVATE"));
      return true;
    });
    assert.equal(s.records.size, 0);
  }
});

test("address defects are distinct from command, intent and unexpected failures", async () => {
  const s = setup();
  const reason = (expected) => (error) => {
    assert.deepEqual(error.details, { domain: "v2_protected_location", version: 1, reason: expected });
    return true;
  };
  await assert.rejects(s.handler({ ...request(), address: { ...request().address, street: "" } }, context), reason("invalid_address_input"));
  await assert.rejects(s.handler({ ...request(), address: { ...request().address, zip_code: 12 } }, context), reason("invalid_address_input"));
  await assert.rejects(s.handler({ ...request(), owner_ref: "forged" }, context), reason("unknown"));
  await assert.rejects(s.handler({ ...request(), intent_key: "bad" }, context), reason("unknown"));
  const first = await s.handler(request(), context);
  await assert.rejects(s.handler({ ...request(), address: { ...request().address, unit: "changed" } }, context), reason("unknown"));
  assert.deepEqual(await s.handler(request(), context), first);
  const unexpected = setup(async () => { throw Object.assign(new Error("PRIVATE secret address"), { reason: "invalid_address_input" }); });
  await assert.rejects(unexpected.handler(request(), context), (error) => {
    assert.equal(error.details.reason, "unknown");
    assert.ok(!JSON.stringify(error).includes("PRIVATE")); return true;
  });
});

 test("authenticated correction response is minimum private advisory data and never persisted", async () => {
  const { ProtectedLocationFailure } = require("../src/v2/protectedLocationErrors");
  const candidate = { house_number: "123", street: "EXAMPLE AVENUE", zip_code: "10451" };
  const fixture = setup(async () => {
    const error = new ProtectedLocationFailure("address_not_resolved"); error.correction = candidate; throw error;
  });
  assert.deepEqual(await fixture.handler(request(), context), {
    status: "ADDRESS_CORRECTION_REQUIRED", version: 1, candidate
  });
  assert.equal(fixture.records.size, 0);
  await assert.rejects(fixture.handler(request(), {}), code("unauthenticated"));
  candidate.providerBody = "PRIVATE";
  await assert.rejects(fixture.handler(request(), context), error => {
    assert.deepEqual(error.details, { domain: "v2_protected_location", version: 1, reason: "address_not_resolved" });
    return true;
  });
});
