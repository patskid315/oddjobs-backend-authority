"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createNYCGeoclientValidator } = require("../src/v2/nycGeoclientValidator");
const { commandPayloadDigest } = require("../src/v2/foundation");
const { recordProtectedNYCAddress, validatedBorough } = require("../src/v2/protectedLocationAuthority");

// Synthetic field subsets of documented V2 /address and /version responses.
// No real credential and no live fetch is used anywhere in this suite.
const credential = ["synthetic", "subscription", "only"].join("-");
const input = { house_number: "123", street: "EXAMPLE STREET", zip_code: "10451" };
const digest = commandPayloadDigest(input);
const version = () => ({ geosupportVersion: { version: "26.2", release: "26B",
  geoFileInfo: [{ tag: "PAD", release: "26B", date: "260427" }] } });
const address = () => ({ address: {
  geosupportFunctionCode: "1B", geosupportReturnCode: "00", geosupportReturnCode2: "00",
  returnCode1e: "00", returnCode1a: "00", houseNumber: "123", houseNumberIn: "123",
  streetName1In: "EXAMPLE STREET", firstStreetNameNormalized: "EXAMPLE STREET",
  zipCode: "10451", bblBoroughCode: "2", boroughCode1In: "2", lionBoroughCode: "2",
  bbl: "2000010001", latitude: 40.8, longitude: -73.9, nta2020: "ignored"
} });
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" }
});

test("temporary mismatch diagnostic contains only event and exact comparison booleans", async (t) => {
  const log = t.mock.method(console, "info", () => {});
  for (const [changes, expected] of [
    [{ houseNumber: "125" }, [false, true, true]],
    [{ firstStreetNameNormalized: "OTHER STREET" }, [true, false, true]],
    [{ zipCode: "10001" }, [true, true, false]],
    [{ houseNumber: "125", firstStreetNameNormalized: "OTHER STREET", zipCode: "10001" }, [false, false, false]],
    [{ houseNumber: "125", zipCode: "10001" }, [false, true, false]]
  ]) {
    log.mock.resetCalls();
    const body = address(); Object.assign(body.address, changes);
    const { validator } = setup([version(), body, version()]);
    await assert.rejects(validator.validateExactAddress(input, digest), (error) =>
      error.reason === "address_not_resolved" && error.message === "LOCATION_VALIDATION_UNRESOLVED");
    assert.equal(log.mock.calls.length, 1);
    const args = log.mock.calls[0].arguments;
    assert.equal(args.length, 1);
    assert.deepEqual(JSON.parse(args[0]), {
      event: "v2_protected_location_exact_match_failed",
      houseNumberMatches: expected[0], normalizedStreetMatches: expected[1], zipMatches: expected[2]
    });
    for (const privateValue of [...Object.values(input), ...Object.values(changes),
      credential, JSON.stringify(body), digest, body.address.bbl]) {
      assert.equal(args[0].includes(privateValue), false);
    }
  }
  log.mock.resetCalls();
  const success = setup();
  await success.validator.validateExactAddress(input, digest);
  assert.equal(log.mock.calls.length, 0);
  const malformed = setup([version(), {}]);
  await assert.rejects(malformed.validator.validateExactAddress(input, digest));
  assert.equal(log.mock.calls.length, 0);
});

test("diagnostic sink failure preserves the original mismatch reason", async (t) => {
  t.mock.method(console, "info", () => { throw new Error("sink unavailable"); });
  const body = address(); body.address.houseNumber = "125";
  const { validator } = setup([version(), body, version()]);
  await assert.rejects(validator.validateExactAddress(input, digest), (error) =>
    error.reason === "address_not_resolved" && error.message === "LOCATION_VALIDATION_UNRESOLVED");
});
function setup(responses = [version(), address(), version()], overrides = {}) {
  const calls = [];
  const validator = createNYCGeoclientValidator({ getSubscriptionKey: () => credential,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      assert.ok(responses.length, "Unexpected HTTP call");
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next instanceof Response ? next : json(next);
    }, ...overrides });
  return { validator, calls };
}

test("structured address uses fixed HTTPS endpoints, header-only credential, bounded request and coarse receipt", async () => {
  const { validator, calls } = setup();
  assert.equal(calls.length, 0);
  assert.equal(validator.providerId, "NYC_GEOCLIENT_V2");
  const result = await validator.validateExactAddress(input, digest);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname),
    ["/geoclient/v2/version", "/geoclient/v2/address", "/geoclient/v2/version"]);
  assert.deepEqual(Object.fromEntries(new URL(calls[1].url).searchParams), {
    houseNumber: "123", street: "EXAMPLE STREET", zip: "10451"
  });
  for (const { url, options } of calls) {
    assert.equal(new URL(url).origin, "https://api.nyc.gov");
    assert.equal(url.includes(credential), false);
    assert.equal(options.headers["Ocp-Apim-Subscription-Key"], credential);
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.equal(validatedBorough(result, digest), "nyc:borough:bronx");
  assert.match(result.dataset_version, /^gs:26\.2:26B:[a-f0-9]{32}$/);
  assert.equal(result.provider_reference, "bbl:2000010001");
  for (const privateValue of [credential, "EXAMPLE", "10451", "latitude", "nta2020"]) {
    assert.equal(JSON.stringify(result).includes(privateValue), false);
  }
});

test("only the five provider-derived boroughs pass; harmless case/spacing changes are accepted", async () => {
  for (const borough of ["1", "2", "3", "4", "5"]) {
    const body = address();
    Object.assign(body.address, { bblBoroughCode: borough, boroughCode1In: borough,
      lionBoroughCode: borough, bbl: `${borough}000010001`, firstStreetNameNormalized: "Example  Street" });
    const { validator } = setup([version(), body, version()]);
    const result = await validator.validateExactAddress(input, digest);
    assert.equal(result.matches[0].borough_code, borough);
  }
});

test("warnings, partial/theoretical matches, changes, missing identity and ambiguity fail closed", async () => {
  const mutations = [
    ["geosupportReturnCode", "01"], ["geosupportReturnCode2", "01"],
    ["geosupportReturnCode2", "42"], ["geosupportReturnCode2", undefined],
    ["returnCode1e", "01"], ["returnCode1a", "42"], ["geosupportFunctionCode", "1E"],
    ["houseNumber", "125"], ["houseNumberIn", "125"], ["streetName1In", "OTHER STREET"],
    ["firstStreetNameNormalized", "EXAMPLE AVENUE"], ["zipCode", "10001"],
    ["bblBoroughCode", "6"], ["bblBoroughCode", 2], ["lionBoroughCode", "1"],
    ["boroughCode1In", "1"], ["bbl", "1000010001"], ["bbl", undefined],
    ["reasonCode", "V"], ["message2", "address warning"]
  ];
  for (const [key, value] of mutations) {
    const body = address(); body.address[key] = value;
    const { validator } = setup([version(), body, version()]);
    await assert.rejects(validator.validateExactAddress(input, digest), /LOCATION_VALIDATION_UNRESOLVED/);
  }
  for (const body of [null, {}, { address: [address().address] },
    { ...address(), results: [address().address] }]) {
    const { validator } = setup([version(), body, version()]);
    await assert.rejects(validator.validateExactAddress(input, digest), /LOCATION_VALIDATION_UNRESOLVED/);
  }
});

test("missing, malformed or changing dataset evidence cannot be replaced by a constant API version", async () => {
  for (const bad of [{}, { geosupportVersion: { version: "2" } },
    { geosupportVersion: { version: "26.2", release: "" } }]) {
    const { validator, calls } = setup([bad]);
    await assert.rejects(validator.validateExactAddress(input, digest), /LOCATION_VALIDATION_UNRESOLVED/);
    assert.equal(calls.length, 1);
  }
  const changed = version(); changed.geosupportVersion.geoFileInfo[0].release = "26C";
  const { validator } = setup([version(), address(), changed]);
  await assert.rejects(validator.validateExactAddress(input, digest), /LOCATION_VALIDATION_UNRESOLVED/);
});

test("invalid evidence/digest, client geography or unit cannot reach HTTP", async () => {
  for (const bad of [{ ...input, unit: "Apt 2" }, { ...input, borough: "2" },
    { ...input, street: "bad\nvalue" }, { ...input, zip_code: 10451 },
    { ...input, house_number: "" }, null]) {
    const { validator, calls } = setup();
    await assert.rejects(validator.validateExactAddress(bad, digest), /LOCATION_INPUT_INVALID/);
    assert.equal(calls.length, 0);
  }
  const { validator, calls } = setup();
  await assert.rejects(validator.validateExactAddress(input, "forged-digest"), /LOCATION_INPUT_INVALID/);
  assert.equal(calls.length, 0);
});

test("missing/invalid/inaccessible secret configuration never makes an HTTP call or leaks values", async () => {
  for (const accessor of [() => undefined, () => "", () => "bad\nheader",
    () => { throw new Error(credential); }]) {
    const { validator, calls } = setup([], { getSubscriptionKey: accessor });
    await assert.rejects(validator.validateExactAddress(input, digest), (error) =>
      error.message === "LOCATION_AUTHORITY_UNAVAILABLE" && !error.stack.includes(credential));
    assert.equal(calls.length, 0);
  }
});

test("HTTP/auth/rate limit/redirect/network/body failures are sanitized and never retried", async () => {
  for (const response of [json({ message: credential }, 401), json({}, 403), json({}, 429),
    json({}, 500), new Response(null, { status: 302, headers: { location: "https://example.invalid" } }),
    new Response(credential, { headers: { "content-type": "text/html" } }),
    new Response("not json", { headers: { "content-type": "application/json" } }),
    new Response("x".repeat(262145), { headers: { "content-type": "application/json" } }),
    new Error(`HTTP headers contain ${credential}`)]) {
    const { validator, calls } = setup([response]);
    await assert.rejects(validator.validateExactAddress(input, digest), (error) =>
      error.message === "LOCATION_VALIDATION_UNAVAILABLE" && !error.stack.includes(credential));
    assert.equal(calls.length, 1);
  }
});

test("timeout aborts HTTP and strips the underlying error", async () => {
  const { validator } = setup([], { timeoutMs: 5, fetchImpl: async (_, { signal }) =>
    new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new Error(credential)), { once: true })) });
  await assert.rejects(validator.validateExactAddress(input, digest),
    (error) => error.message === "LOCATION_VALIDATION_UNAVAILABLE");
});

test("real authority consumes adapter, protects unit, returns only coarse geography and replays without HTTP", async () => {
  const records = new Map();
  const snapshot = (ref) => ({ exists: records.has(ref.key), data: () => records.get(ref.key) });
  const db = {
    collection: (name) => ({ doc: (id) => { const ref = { key: `${name}/${id}` };
      ref.get = async () => snapshot(ref); return ref; } }),
    runTransaction: async (work) => work({ get: async (ref) => snapshot(ref),
      create: (ref, value) => records.set(ref.key, value) })
  };
  const { validator, calls } = setup();
  const args = { db, validator, authenticatedOwnerRef: "poster-1", intentKey: "adapter-intent-12345",
    address: { ...input, unit: "PRIVATE UNIT" } };
  const receipt = await recordProtectedNYCAddress(args);
  assert.equal(receipt.eligibility_geography.borough_id, "nyc:borough:bronx");
  assert.equal(receipt.eligibility_geography.neighborhood_id, null);
  assert.equal(JSON.stringify(receipt).includes("PRIVATE"), false);
  assert.equal([...records.values()][0].exact_address.unit, "PRIVATE UNIT");
  assert.equal(JSON.stringify([...records.values()]).includes(credential), false);
  assert.ok(calls.every(({ url }) => !url.includes("PRIVATE")));
  assert.deepEqual(await recordProtectedNYCAddress(args), receipt);
  assert.equal(calls.length, 3);
  await assert.rejects(recordProtectedNYCAddress({ ...args, address: { ...args.address, unit: "OTHER" } }),
    /LOCATION_INTENT_CONFLICT/);
});

test("typed adapter reasons distinguish non-match, invalid evidence and service failures", async () => {
  const mismatch = address(); mismatch.address.firstStreetNameNormalized = "OTHER STREET";
  const noMatch = address(); noMatch.address.geosupportReturnCode = "42";
  const inconsistent = address(); inconsistent.address.houseNumberIn = "999";
  for (const [responses, reason] of [
    [[version(), mismatch, version()], "address_not_resolved"],
    [[version(), noMatch], "invalid_service_response"],
    [[version(), inconsistent], "invalid_service_response"],
    [[version(), {}], "invalid_service_response"],
    [[{}], "invalid_service_response"],
    [[json({}, 429)], "rate_limited"], [[json({}, 503)], "verification_temporarily_unavailable"],
    [[json({}, 408)], "verification_temporarily_unavailable"],
    [[json({}, 401)], "verification_unavailable"], [[json({}, 403)], "verification_unavailable"],
    [[new TypeError("private URL")], "verification_temporarily_unavailable"],
    [[new Error("PRIVATE unexpected exception")], "unknown"],
    [[new Response("invalid json", { headers: { "content-type": "application/json" } })], "invalid_service_response"]
  ]) {
    const { validator } = setup(responses);
    await assert.rejects(validator.validateExactAddress(input, digest), (error) => {
      assert.equal(error.reason, reason); assert.ok(!error.message.includes("PRIVATE")); return true;
    });
  }
  const { validator } = setup([], { getSubscriptionKey: () => undefined });
  await assert.rejects(validator.validateExactAddress(input, digest), (error) => error.reason === "verification_unavailable");
  const timed = setup([], { timeoutMs: 5, fetchImpl: async (_, { signal }) =>
    new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new Error("PRIVATE")), { once: true })) });
  await assert.rejects(timed.validator.validateExactAddress(input, digest), (error) => error.reason === "verification_temporarily_unavailable");
  const invalid = setup();
  await assert.rejects(invalid.validator.validateExactAddress({ ...input, street: "" }, digest), (error) => error.reason === "invalid_address_input");
  await assert.rejects(invalid.validator.validateExactAddress(input, "wrong-digest"), (error) => error.reason === "invalid_service_response");
});

 test("qualified correction is minimal, version-pinned, never a receipt", async () => {
  const body = address(); body.address.firstStreetNameNormalized = "EXAMPLE AVENUE";
  const { validator } = setup([version(), body, version()]);
  await assert.rejects(validator.validateExactAddress(input, digest), error => {
    assert.deepEqual(error.correction, { house_number: "123", street: "EXAMPLE AVENUE", zip_code: "10451" });
    return error.reason === "address_not_resolved";
  });
  const changed = version(); changed.geosupportVersion.release = "26C";
  await assert.rejects(setup([version(), body, changed]).validator.validateExactAddress(input, digest), error => {
    assert.equal(error.correction, undefined); return error.reason === "invalid_service_response";
  });
  body.address.houseNumber = "not representable";
  await assert.rejects(setup([version(), body]).validator.validateExactAddress(input, digest), error => {
    assert.equal(error.correction, undefined); return error.reason === "address_not_resolved";
  });
});

test("qualified numbered street representations verify without correction or private diagnostics", async (t) => {
  const log = t.mock.method(console, "info", () => {});
  for (const [submitted, resolved] of [["E 95th St", "EAST 95 STREET"], ["w. 3rd st.", "WEST 3 STREET"],
    ["  N 12th Ave  ".trim(), "NORTH 12 AVENUE"], ["S 21st Rd", "SOUTH 21 ROAD"], ["95th Blvd", "95 BOULEVARD"]]) {
    const request = { ...input, street: submitted }; const body = address();
    body.address.streetName1In = submitted; body.address.firstStreetNameNormalized = resolved;
    const {validator} = setup([version(), body, version()]);
    const result = await validator.validateExactAddress(request, commandPayloadDigest(request));
    assert.equal(result.status, "EXACT_ADDRESS");
  }
  assert.equal(log.mock.calls.length, 0);
});

test("NYC identity exceptions, direction changes and material fields still require correction", async (t) => {
  t.mock.method(console, "info", () => {});
  for (const [submitted, resolved] of [["AVENUE S", "AVENUE SOUTH"], ["S STREET", "SOUTH STREET"],
    ["ABRAHAM E KAZAN STREET", "ABRAHAM EAST KAZAN STREET"], ["ST MARKS PLACE", "STREET MARKS PLACE"],
    ["E 95th St", "WEST 95 STREET"], ["E 95th St", "EAST 96 STREET"], ["E 95st St", "EAST 95 STREET"]]) {
    const request = { ...input, street: submitted }; const body = address();
    body.address.streetName1In = submitted; body.address.firstStreetNameNormalized = resolved;
    const {validator} = setup([version(), body, version()]);
    await assert.rejects(validator.validateExactAddress(request, commandPayloadDigest(request)),
      e => e.reason === "address_not_resolved" && !!e.correction);
  }
  for (const patch of [{houseNumber:"125"},{zipCode:"10001"}]) {
    const request = {...input, street:"E 95th St"}; const body = address();
    Object.assign(body.address, {streetName1In:request.street,firstStreetNameNormalized:"EAST 95 STREET"}, patch);
    await assert.rejects(setup([version(),body,version()]).validator.validateExactAddress(request,commandPayloadDigest(request)),
      e => e.reason === "address_not_resolved" && !!e.correction);
  }
});
