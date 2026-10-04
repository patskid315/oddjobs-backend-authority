"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { StripeFundingProvider, secretStripe } = require("../src/v2/stripeFundingProvider");

function dbFixture(values = {}) {
  const records = new Map(Object.entries(values));
  const db = { collection: path => ({ doc: id => ({
    get: async () => ({ exists: records.has(`${path}/${id}`), get: field => records.get(`${path}/${id}`)?.[field] }),
    set: async (value, options) => records.set(`${path}/${id}`, options?.merge ? { ...(records.get(`${path}/${id}`) || {}), ...value } : value)
  }) }) };
  return { db, records };
}

test("customer is server-resolved, ownership checked and creation is idempotent", async () => {
  const existing = dbFixture({ "stripe_customers/poster": { customerId: "cus_existing" } });
  let creates = 0; let key;
  const stripe = { customers: {
    retrieve: async id => ({ id, livemode: false, metadata: { firebaseUID: "poster" } }),
    create: async (_, options) => { creates++; key = options.idempotencyKey; return { id: "cus_new", livemode: false, metadata: { firebaseUID: "poster" } }; }
  } };
  assert.equal(await new StripeFundingProvider({ stripe, db: existing.db, livemode: false }).customer("poster", {}), "cus_existing");
  assert.equal(creates, 0); assert.equal(existing.records.get("v2StripeCustomers/poster").customer_ref, "cus_existing");
  const fresh = dbFixture(); const freshProvider = new StripeFundingProvider({ stripe, db: fresh.db, livemode: false });
  assert.equal(await freshProvider.customer("poster", {}), "cus_new"); assert.equal(key, "oddjobs:v2:customer:poster");
  assert.equal(fresh.records.get("v2StripeCustomers/poster").owner_ref, "poster");
});

test("foreign customer and unready or foreign Connect account fail closed", async () => {
  const customerDB = dbFixture({ "stripe_customers/poster": { customerId: "cus_existing" } });
  const foreignCustomer = new StripeFundingProvider({ db: customerDB.db, livemode: false,
    stripe: { customers: { retrieve: async id => ({ id, livemode: false, metadata: { firebaseUID: "other" } }) } } });
  await assert.rejects(foreignCustomer.customer("poster", {}), error => error.reason === "stripe_customer_unavailable");
  for (const account of [null, { id: "acct_test", metadata: { firebaseUID: "other" }, details_submitted: true, charges_enabled: true, payouts_enabled: true },
    { id: "acct_test", metadata: { firebaseUID: "worker" }, details_submitted: false, charges_enabled: true, payouts_enabled: true }]) {
    const fixture = dbFixture({ "stripe_customers/worker": { connected_account_id: account ? "acct_test" : null } });
    const provider = new StripeFundingProvider({ db: fixture.db, livemode: false,
      stripe: { accounts: { retrieve: async () => account } } });
    await assert.rejects(provider.connectReady("worker"), error => error.reason === "connect_not_ready");
  }
});

test("PaymentIntent uses authoritative total, bounded metadata and stable idempotency without transfer", async () => {
  let body, options;
  const provider = new StripeFundingProvider({ db: dbFixture().db, livemode: false,
    stripe: { paymentIntents: { create: async (value, opts) => { body = value; options = opts; return { id: "pi_test" }; } } } });
  const record = { attempt_id: "attempt", job_ref: "job", binding: { selection_ref: "selection" },
    snapshot: { snapshot_id: "snapshot", poster_funding_total_minor: 11000 }, provider_idempotency_key: "stable-provider-key" };
  await provider.createIntent(record, "cus_test");
  assert.equal(body.amount, 11000); assert.equal(body.currency, "usd"); assert.equal(body.customer, "cus_test");
  assert.equal(body.capture_method, "automatic"); assert.deepEqual(body.payment_method_types, ["card"]);
  assert.equal(body.metadata.oddjobs_v2_attempt, "attempt"); assert.equal(options.idempotencyKey, "stable-provider-key");
  assert.equal(body.transfer_data, undefined); assert.equal(body.destination, undefined);
});

test("secret binding fails closed without exposing a credential", () => {
  class Stripe { constructor(key) { this.key = key; } }
  for (const value of [undefined, "", "legacy", "sk_test_"]) assert.throws(() => secretStripe({ Stripe, key: value }), error => error.reason === "stripe_configuration_unavailable");
  const configured = secretStripe({ Stripe, key: "sk_test_syntheticonly" });
  assert.equal(configured.livemode, false); assert.ok(configured.stripe instanceof Stripe);
});
