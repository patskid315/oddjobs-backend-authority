// Required Modules
const functions = require("firebase-functions");
const auth = require("firebase-functions/v1/auth");
const admin = require("./admin");
const { getFirestore } = require("firebase-admin/firestore");

// Access Firestore
const db = getFirestore();

// Determine if running in production or test mode
const stripeMode = (functions.config().stripe?.mode || "test").toLowerCase(); // "test" | "live"
const isLive = stripeMode === "live";

console.log(
  `🧭 Environment: ${isLive ? "LIVE" : "TEST"} — Stripe mode: ${stripeMode} — GCloud Project: ${process.env.GCLOUD_PROJECT}`
);

const stripeSecret = isLive
  ? functions.config().stripe.live.secret
  : functions.config().stripe.test.secret;

// Initialize Stripe
const Stripe = require("stripe");
const stripe = new Stripe(stripeSecret, {
  apiVersion: "2023-10-16"
});

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function isSkippedPayout(payment) {
  const paymentSkipped = payment?.paymentSkipped === true;
  const totalCharged =
    typeof payment?.totalCharged === "number" ? payment.totalCharged : 0;
  const promoCode =
    typeof payment?.promoCode === "string" ? payment.promoCode.toUpperCase() : "";

  return paymentSkipped || totalCharged <= 0 || promoCode === "NEIGHBORS2026";
}

async function recordSkippedPayout({
  paymentRef,
  payment,
  recipientId,
  workerCut,
  notificationMessage,
  skipReason,
}) {
  await paymentRef.update({
    payoutStatus: "not_applicable",
    status: "completed",
    payoutTimestamp: new Date(),
    payoutSkippedReason: skipReason,
    paidAt: new Date(),
  });

  // ✅ Worker still gets credit in earnings history
  // ❌ But no available balance is added because no Stripe payout exists
  await getFirestore()
    .collection("balance")
    .doc(recipientId)
    .set(
      {
        totalEarned: admin.firestore.FieldValue.increment(workerCut),
        lastUpdated: new Date(),
      },
      { merge: true }
    );

  await getFirestore().collection("notifications").add({
    receiverID: recipientId,
    senderName: "OddJobs",
    type: "pay",
    message: notificationMessage,
    timestamp: new Date(),
  });

  console.log(
    `✅ Skipped Stripe payout recorded for recipient ${recipientId}. Reason: ${skipReason}`
  );
}

// ✅ Create Stripe Customer on Auth Signup
exports.createStripeCustomerOnSignup = auth.user().onCreate(async (user) => {
  if (!user?.email) return;

  const customer = await stripe.customers.create({
    email: user.email,
    name: user.displayName || undefined,
    metadata: { firebaseUID: user.uid }
  });

  await getFirestore().collection("stripe_customers").doc(user.uid).set({
    customerId: customer.id,
    createdAt: new Date()
  });

  console.log(`✅ Stripe customer created for ${user.uid}`);
});

// ✅ Create Connected Account
exports.createConnectedAccount = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) {
    throw new functions.https.HttpsError("unauthenticated", "User must be signed in.");
  }

  const docRef = getFirestore().collection("stripe_customers").doc(uid);
  const doc = await docRef.get();

  if (doc.exists && doc.get("connected_account_id")) {
    const accountId = doc.get("connected_account_id");

    const account = await stripe.accounts.retrieve(accountId);
    const accountStatus = {
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted
    };

    await docRef.set({ account_status: accountStatus }, { merge: true });

    console.log(`ℹ️ Connected account already exists for ${uid}: ${accountId}`);
    return {
      connected_account_id: accountId,
      account_status: accountStatus
    };
  }

  try {
    const account = await stripe.accounts.create({
      type: "express",
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true }
      },
      metadata: { firebaseUID: uid }
    });

    const accountStatus = {
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted
    };

    await docRef.set({
      connected_account_id: account.id,
      account_status: accountStatus
    }, { merge: true });

    console.log(`✅ Connected account created for ${uid}: ${account.id}`);
    return {
      connected_account_id: account.id,
      account_status: accountStatus
    };
  } catch (err) {
    console.error("❌ Failed to create connected account:", err);
    throw new functions.https.HttpsError("internal", err.message);
  }
});

exports.getStripeBalance = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated.");
  }

  const doc = await admin.firestore().collection("stripe_customers").doc(uid).get();
  const connectedAccountId = doc.get("connected_account_id");

  if (!connectedAccountId) {
    console.error(`❌ No connected Stripe account for user ${uid}`);
    throw new functions.https.HttpsError("not-found", "Stripe account not found.");
  }

  try {
    const balance = await stripe.balance.retrieve({
      stripeAccount: connectedAccountId
    });

    console.log(`✅ Stripe balance fetched for ${uid}:`, balance);
    return balance;
  } catch (err) {
    console.error("❌ Failed to retrieve Stripe balance:", err.message);
    throw new functions.https.HttpsError("internal", err.message);
  }
});

// ✅ Ephemeral Key
exports.createEphemeralKey = functions.https.onCall(async (data, context) => {
  const { customerId } = data;
  if (!customerId) {
    throw new functions.https.HttpsError("invalid-argument", "Missing customerId");
  }

  try {
    const key = await stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: "2023-10-16" }
    );
    return { ephemeralKey: key.secret };
  } catch (error) {
    console.error("❌ Ephemeral key error:", error.message);
    throw new functions.https.HttpsError("internal", error.message);
  }
});

// ✅ List Payment Methods (Only Debit Cards)
exports.listPaymentMethods = functions.https.onRequest(async (req, res) => {
  const { customerId } = req.body;
  if (!customerId) {
    res.status(400).send({ error: "Missing customerId" });
    return;
  }

  try {
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: "card",
    });

    const debitCards = paymentMethods.data.filter(
      (pm) => pm.card && pm.card.funding === "debit"
    );

    res.send({ paymentMethods: debitCards });
  } catch (error) {
    console.error("❌ Error listing payment methods:", error);
    res.status(500).send({ error: error.message });
  }
});

// ✅ Create SetupIntent
exports.createSetupIntent = functions.https.onCall(async (data, context) => {
  const { customerId } = data;
  if (!customerId) {
    throw new functions.https.HttpsError("invalid-argument", "Missing customerId");
  }

  try {
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      usage: "off_session",
      payment_method_types: ["card"]
    });

    return { clientSecret: setupIntent.client_secret };
  } catch (err) {
    console.error("❌ SetupIntent creation failed:", err.message);
    throw new functions.https.HttpsError("internal", err.message);
  }
});

exports.detachPaymentMethod = functions.https.onCall(async (data, context) => {
  const { paymentMethodId } = data;
  if (!paymentMethodId) {
    throw new functions.https.HttpsError("invalid-argument", "Missing paymentMethodId");
  }

  try {
    await stripe.paymentMethods.detach(paymentMethodId);
    console.log(`✅ Detached payment method: ${paymentMethodId}`);
    return { success: true };
  } catch (err) {
    console.error("❌ Failed to detach payment method:", err.message);
    throw new functions.https.HttpsError("internal", err.message);
  }
});

// ✅ Create PaymentIntent (Debits Only)
exports.createPaymentIntent = functions.https.onCall(async (data, context) => {
  const { amount, currency = "usd", customerId, paymentMethodId } = data;

  if (!amount || !customerId) {
    throw new functions.https.HttpsError("invalid-argument", "Missing amount or customerId");
  }

  if (paymentMethodId) {
    try {
      const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
      if (!pm || pm.card?.funding !== "debit") {
        console.warn(`❌ Rejected non-debit card: ${paymentMethodId}`);
        throw new functions.https.HttpsError("failed-precondition", "Only debit cards are allowed.");
      }
    } catch (err) {
      console.error("❌ PaymentMethod fetch failed:", err.message);
      throw new functions.https.HttpsError("internal", err.message);
    }
  }

  try {
    const intent = await stripe.paymentIntents.create({
      amount,
      currency,
      customer: customerId,
      automatic_payment_methods: { enabled: true },
      ...(paymentMethodId && { payment_method: paymentMethodId })
    });

    return { clientSecret: intent.client_secret };
  } catch (err) {
    console.error("❌ PaymentIntent creation failed:", err.message);
    throw new functions.https.HttpsError("internal", err.message);
  }
});

// ✅ Onboarding Link
exports.createAccountLink = functions.https.onRequest(async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  const doc = await getFirestore().collection("stripe_customers").doc(userId).get();
  const accountId = doc.get("connected_account_id");

  if (!accountId) return res.status(404).json({ error: "Connected account not found" });

  try {
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: "https://theoddjobsapp.com",
      return_url: "https://theoddjobsapp.com",
      type: "account_onboarding",
    });
    res.json({ url: accountLink.url });
  } catch (err) {
    console.error("❌ Stripe error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Dashboard Link
exports.createDashboardLink = functions.https.onRequest(async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  const doc = await getFirestore().collection("stripe_customers").doc(userId).get();
  const accountId = doc.get("connected_account_id");

  if (!accountId) return res.status(404).json({ error: "Connected account not found" });

  try {
    const link = await stripe.accounts.createLoginLink(accountId);
    res.json({ url: link.url });
  } catch (err) {
    console.error("❌ Dashboard link error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Release Worker Payment on Completion (STANDARD JOBS ONLY)
exports.releasePaymentOnCompletion = functions.firestore
  .document("jobPost/{jobId}")
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const jobId = context.params.jobId;

    if (before.progressStatus === "completed" || after.progressStatus !== "completed") {
      console.log(`ℹ️ No progress status change to 'completed' for job ${jobId}`);
      return;
    }

    console.log(`🔔 progressStatus changed to 'completed' for job ${jobId}`);

    const paymentsRef = getFirestore().collection("payments");

    const snapshot = await paymentsRef
      .where("jobId", "==", jobId)
      .where("type", "==", "job_payment")
      .limit(1)
      .get();

    if (snapshot.empty) {
      console.error(`❌ No STANDARD payment record found for job ${jobId}`);
      return;
    }

    const paymentDoc = snapshot.docs[0];
    const payment = paymentDoc.data();
    const paymentRef = paymentDoc.ref;

    if (payment.slotId) {
      console.warn(
        `⚠️ Payment for job ${jobId} has slotId=${payment.slotId}. Skipping standard payout trigger.`
      );
      return;
    }

    if (payment.payoutStatus === "paid" || payment.payoutStatus === "not_applicable") {
      console.log(`💸 Payment already finalized for job ${jobId}`);
      return;
    }

    const recipientId = payment.recipientId;
    const workerCut = payment.workerCut;

    if (!recipientId || typeof workerCut !== "number" || workerCut <= 0) {
      console.warn(`⚠️ Invalid recipient or workerCut for job ${jobId}`);
      return;
    }

    if (isSkippedPayout(payment)) {
      await recordSkippedPayout({
        paymentRef,
        payment,
        recipientId,
        workerCut,
        notificationMessage:
          "A completed job has been added to your earnings history. No in-app payout was required.",
        skipReason: "promo_or_off_platform",
      });

      console.log(`✅ Standard job ${jobId} completed without Stripe payout.`);
      return;
    }

    const amount = Math.round(workerCut * 100);

    const stripeDoc = await getFirestore().collection("stripe_customers").doc(recipientId).get();
    const connectedAccountId = stripeDoc.get("connected_account_id");

    if (!connectedAccountId) {
      console.error(`❌ No connected Stripe account found for user ${recipientId}`);
      return;
    }

    try {
      const transfer = await stripe.transfers.create({
        amount,
        currency: "usd",
        destination: connectedAccountId,
        metadata: { jobId, type: "worker_payout" }
      });

      console.log(`✅ Stripe transfer successful: ${transfer.id}`);

      await paymentRef.update({
        payoutStatus: "paid",
        status: "completed",
        payoutTimestamp: new Date(),
        stripeTransferId: transfer.id
      });

      await getFirestore()
        .collection("balance")
        .doc(recipientId)
        .set(
          {
            availableBalance: admin.firestore.FieldValue.increment(workerCut),
            totalEarned: admin.firestore.FieldValue.increment(workerCut),
            lastUpdated: new Date()
          },
          { merge: true }
        );

      await getFirestore().collection("notifications").add({
        receiverID: recipientId,
        senderName: "OddJobs",
        type: "pay",
        message: "You’ve been paid for completing a job.",
        timestamp: new Date()
      });

      console.log(`✅ Standard payment released and balance updated for user ${recipientId}`);
    } catch (err) {
      console.error(`❌ Stripe transfer failed for job ${jobId}:`, err.message);

      await getFirestore().collection("payout_pending_jobs").add({
        jobId,
        slotId: null,
        type: "job_payment",
        recipientId,
        workerCut,
        createdAt: new Date(),
        error: err.message
      });
    }
  });

// ✅ Release Worker Payment on SLOT completion (RESEARCH)
exports.releaseResearchPaymentOnSlotCompletion = functions.firestore
  .document("jobPost/{jobId}/slots/{slotId}")
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const { jobId, slotId } = context.params;

    if (before.status === "completed" || after.status !== "completed") {
      console.log(`ℹ️ No slot status change to 'completed' for job ${jobId} slot ${slotId}`);
      return;
    }

    console.log(`🔔 Slot completed for job ${jobId} slot ${slotId}`);

    const paymentsRef = getFirestore().collection("payments");

    const snap = await paymentsRef
      .where("jobId", "==", jobId)
      .where("slotId", "==", slotId)
      .where("type", "==", "research_payment")
      .limit(1)
      .get();

    if (snap.empty) {
      console.error(`❌ No payment record found for job ${jobId} slot ${slotId}`);
      return;
    }

    const paymentDoc = snap.docs[0];
    const payment = paymentDoc.data();
    const paymentRef = paymentDoc.ref;

    if (payment.payoutStatus === "paid" || payment.payoutStatus === "not_applicable") {
      console.log(`💸 Slot payment already finalized for job ${jobId} slot ${slotId}`);
      return;
    }

    const recipientId = payment.recipientId;
    const workerCut = payment.workerCut;

    if (!recipientId || typeof workerCut !== "number" || workerCut <= 0) {
      console.warn(`⚠️ Invalid recipient or workerCut for job ${jobId} slot ${slotId}`);
      return;
    }

    if (isSkippedPayout(payment)) {
      await recordSkippedPayout({
        paymentRef,
        payment,
        recipientId,
        workerCut,
        notificationMessage:
          "A completed study session has been added to your earnings history. No in-app payout was required.",
        skipReason: "promo_or_off_platform",
      });

      console.log(`✅ Research slot ${jobId}/${slotId} completed without Stripe payout.`);
      return;
    }

    const amount = Math.round(workerCut * 100);

    const stripeDoc = await getFirestore().collection("stripe_customers").doc(recipientId).get();
    const connectedAccountId = stripeDoc.get("connected_account_id");

    if (!connectedAccountId) {
      console.error(`❌ No connected Stripe account found for user ${recipientId}`);
      return;
    }

    try {
      const transfer = await stripe.transfers.create({
        amount,
        currency: "usd",
        destination: connectedAccountId,
        metadata: { jobId, slotId, type: "worker_payout_research" }
      });

      console.log(`✅ Stripe transfer successful (research): ${transfer.id}`);

      await paymentRef.update({
        payoutStatus: "paid",
        status: "completed",
        payoutTimestamp: new Date(),
        stripeTransferId: transfer.id
      });

      await getFirestore()
        .collection("balance")
        .doc(recipientId)
        .set(
          {
            availableBalance: admin.firestore.FieldValue.increment(workerCut),
            totalEarned: admin.firestore.FieldValue.increment(workerCut),
            lastUpdated: new Date()
          },
          { merge: true }
        );

      await getFirestore().collection("notifications").add({
        receiverID: recipientId,
        senderName: "OddJobs",
        type: "pay",
        message: "You’ve been paid for completing a study session.",
        timestamp: new Date()
      });

      console.log(`✅ Research slot payment released for user ${recipientId} job ${jobId} slot ${slotId}`);
    } catch (err) {
      console.error(`❌ Stripe transfer failed for job ${jobId} slot ${slotId}:`, err.message);

      await getFirestore().collection("payout_pending_jobs").add({
        jobId,
        slotId,
        type: "research_payment",
        recipientId,
        workerCut,
        createdAt: new Date(),
        error: err.message
      });
    }
  });

// ✅ Retry Pending Payouts (STANDARD + RESEARCH)
exports.retryPendingPayouts = functions.pubsub
  .schedule("every 1 hours")
  .onRun(async () => {
    const MAX_PAYOUTS_PER_RUN = 10;
    const db = getFirestore();

    const snapshot = await db
      .collection("payout_pending_jobs")
      .orderBy("createdAt", "asc")
      .limit(MAX_PAYOUTS_PER_RUN)
      .get();

    if (snapshot.empty) {
      console.log("ℹ️ No pending payouts to retry.");
      return;
    }

    for (const retryDoc of snapshot.docs) {
      const data = retryDoc.data();

      const jobId = data.jobId;
      const slotId = data.slotId || null;
      const recipientId = data.recipientId;
      const workerCut = data.workerCut;

      if (!jobId || !recipientId || typeof workerCut !== "number" || workerCut <= 0) {
        console.warn(`⚠️ Invalid retry doc ${retryDoc.id}. Missing jobId/recipientId/workerCut.`);
        continue;
      }

      let q = db.collection("payments").where("jobId", "==", jobId);

      if (slotId) {
        q = q.where("slotId", "==", slotId).where("type", "==", "research_payment");
      } else {
        q = q.where("type", "==", "job_payment");
      }

      const paymentSnap = await q.limit(1).get();

      if (paymentSnap.empty) {
        console.warn(`⚠️ No matching payment doc found for retry. jobId=${jobId} slotId=${slotId || "-"}`);
        continue;
      }

      const paymentDoc = paymentSnap.docs[0];
      const payment = paymentDoc.data();
      const paymentRef = paymentDoc.ref;

      if (isSkippedPayout(payment)) {
        await recordSkippedPayout({
          paymentRef,
          payment,
          recipientId,
          workerCut,
          notificationMessage: slotId
            ? "A completed study session has been added to your earnings history. No in-app payout was required."
            : "A completed job has been added to your earnings history. No in-app payout was required.",
          skipReason: "promo_or_off_platform_retry_cleanup",
        });

        await retryDoc.ref.delete();

        console.log(
          `✅ Removed retry for skipped payout job ${jobId}${slotId ? ` slot ${slotId}` : ""}`
        );
        continue;
      }

      const amount = Math.round(workerCut * 100);

      const stripeDoc = await db.collection("stripe_customers").doc(recipientId).get();
      const connectedAccountId = stripeDoc.get("connected_account_id");

      if (!connectedAccountId) {
        console.warn(`⚠️ No connected Stripe account for ${recipientId}`);
        continue;
      }

      try {
        const transfer = await stripe.transfers.create({
          amount,
          currency: "usd",
          destination: connectedAccountId,
          metadata: slotId
            ? { jobId, slotId, type: "worker_payout_retry_research" }
            : { jobId, type: "worker_payout_retry_standard" }
        });

        await paymentRef.update({
          payoutStatus: "paid",
          status: "completed",
          payoutTimestamp: new Date(),
          stripeTransferId: transfer.id
        });

        await db.collection("balance").doc(recipientId).set(
          {
            availableBalance: admin.firestore.FieldValue.increment(workerCut),
            totalEarned: admin.firestore.FieldValue.increment(workerCut),
            lastUpdated: new Date()
          },
          { merge: true }
        );

        await db.collection("notifications").add({
          receiverID: recipientId,
          senderName: "OddJobs",
          type: "pay",
          message: slotId
            ? "You’ve been paid for a previously pending study session."
            : "You’ve been paid for a previously pending job.",
          timestamp: new Date()
        });

        await retryDoc.ref.delete();

        console.log(`✅ Retried payout successful for job ${jobId}${slotId ? ` slot ${slotId}` : ""}`);

        await new Promise((res) => setTimeout(res, 1500));
      } catch (err) {
        console.error(`❌ Retry payout failed for job ${jobId}${slotId ? ` slot ${slotId}` : ""}:`, err.message);

        await retryDoc.ref.set(
          { lastError: err.message, lastTriedAt: new Date() },
          { merge: true }
        );
      }
    }
  });

exports.getDefaultPaymentMethod = functions.https.onCall(async (data, context) => {
  const { customerId } = data;
  if (!customerId) {
    throw new functions.https.HttpsError("invalid-argument", "Missing customerId");
  }

  try {
    const customer = await stripe.customers.retrieve(customerId);
    let defaultPM = customer.invoice_settings.default_payment_method;

    if (!defaultPM) {
      const methods = await stripe.paymentMethods.list({
        customer: customerId,
        type: "card",
      });

      if (methods.data.length > 0) {
        defaultPM = methods.data[0].id;
        console.warn(`⚠️ No default PM set; using first attached card: ${defaultPM}`);
      } else {
        console.warn(`⚠️ No payment methods found for customer ${customerId}`);
        return { paymentMethodId: null };
      }
    }

    console.log(`✅ Returning payment method: ${defaultPM}`);
    return { paymentMethodId: defaultPM };
  } catch (err) {
    console.error("❌ Failed to get payment method:", err.message);
    throw new functions.https.HttpsError("internal", err.message);
  }
});