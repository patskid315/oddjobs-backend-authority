"use strict";

const CUSTOMER_COLLECTION = "v2StripeCustomers";

class StripeFundingFailure extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
const fail = reason => { throw new StripeFundingFailure(reason); };
const providerId = (value, prefix) => typeof value === "string" && value.startsWith(prefix) && /^[A-Za-z0-9_]+$/.test(value);

class StripeFundingProvider {
  constructor({ stripe, db, livemode }) {
    this.stripe = stripe; this.db = db; this.livemode = livemode;
  }

  async customer(uid, authUser) {
    let customerId = null;
    const privateDoc = await this.db.collection(CUSTOMER_COLLECTION).doc(uid).get();
    if (privateDoc.exists) customerId = privateDoc.get("customer_ref");
    if (!customerId) {
      const legacy = await this.db.collection("stripe_customers").doc(uid).get();
      if (legacy.exists) customerId = legacy.get("customerId");
    }
    if (customerId) {
      if (!providerId(customerId, "cus_")) fail("stripe_customer_unavailable");
      const customer = await this.stripe.customers.retrieve(customerId);
      if (!customer || customer.deleted || customer.livemode !== this.livemode || customer.metadata?.firebaseUID !== uid) fail("stripe_customer_unavailable");
      await this.db.collection(CUSTOMER_COLLECTION).doc(uid).set({ schema_version: 1, owner_ref: uid,
        customer_ref: customer.id, provider_livemode: this.livemode }, { merge: true });
      return customer.id;
    }
    const customer = await this.stripe.customers.create({
      ...(authUser?.email ? { email: authUser.email } : {}),
      ...(authUser?.displayName ? { name: authUser.displayName } : {}),
      metadata: { firebaseUID: uid, oddjobsAuthority: "V2_FUNDING" }
    }, { idempotencyKey: `oddjobs:v2:customer:${uid}` });
    if (!customer || customer.livemode !== this.livemode || customer.metadata?.firebaseUID !== uid) fail("stripe_customer_unavailable");
    await this.db.collection(CUSTOMER_COLLECTION).doc(uid).set({ schema_version: 1, owner_ref: uid,
      customer_ref: customer.id, provider_livemode: this.livemode });
    return customer.id;
  }

  async connectReady(workerRef) {
    const accountDoc = await this.db.collection("stripe_customers").doc(workerRef).get();
    const accountId = accountDoc.exists ? accountDoc.get("connected_account_id") : null;
    if (!providerId(accountId, "acct_")) fail("connect_not_ready");
    const account = await this.stripe.accounts.retrieve(accountId);
    if (!account || account.metadata?.firebaseUID !== workerRef || account.details_submitted !== true ||
        account.charges_enabled !== true || account.payouts_enabled !== true) fail("connect_not_ready");
    return account.id;
  }

  async createIntent(record, customerRef) {
    const metadata = { oddjobs_v2_attempt: record.attempt_id, oddjobs_v2_snapshot: record.snapshot.snapshot_id,
      oddjobs_v2_job: record.job_ref, oddjobs_v2_selection: record.binding.selection_ref };
    return this.stripe.paymentIntents.create({ amount: record.snapshot.poster_funding_total_minor,
      currency: "usd", customer: customerRef, capture_method: "automatic", payment_method_types: ["card"], metadata,
      description: "OddJobs job funding" }, { idempotencyKey: record.provider_idempotency_key });
  }

  async retrieveIntent(intentRef) {
    if (!providerId(intentRef, "pi_")) fail("funding_unavailable");
    return this.stripe.paymentIntents.retrieve(intentRef);
  }
}

function secretStripe({ Stripe, key }) {
  if (typeof key !== "string" || !/^sk_(?:test|live)_[A-Za-z0-9]+$/.test(key)) fail("stripe_configuration_unavailable");
  return { stripe: new Stripe(key), livemode: key.startsWith("sk_live_") };
}

module.exports = { StripeFundingProvider, StripeFundingFailure, secretStripe, CUSTOMER_COLLECTION };
