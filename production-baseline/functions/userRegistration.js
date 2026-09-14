// functions/index.js (v1 SDK style)
const functions = require("firebase-functions");                
const admin = require("./admin");                       
const db = admin.firestore();
const auth = admin.auth();
const FieldValue = admin.firestore.FieldValue;

// ---- Pin region (matches existing deploy) ----
const region = functions.region("us-central1");

// --------- Helpers ---------
const BOROUGHS = new Set(["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"]);
const workerStatsRef = db.collection("meta").doc("workerStats");
const workerUserMarker = (uid) =>
  db.collection("meta").doc("workerStatsUsers").collection("users").doc(uid);

function assertAuthed(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required.");
  }
  return context.auth.uid;
}

const isValidBucket = (v) => v === "active" || v === "queued" || v === null;

/**
 * Core transition logic (idempotent).
 * - Stores lastStatus per user.
 * - Increments/decrements meta counters with FieldValue.increment.
 */
async function applyWorkerStatusTransition({ uid, isWorker, from, to }) {
  if (!isWorker) return { success: true, skipped: "not-a-worker" };
  if (!isValidBucket(from) || !isValidBucket(to)) {
    throw new functions.https.HttpsError("invalid-argument", "from/to must be 'active' | 'queued' | null");
  }

  await db.runTransaction(async (tx) => {
    const markerRef = workerUserMarker(uid);
    const markerSnap = await tx.get(markerRef);
    const last = markerSnap.exists ? markerSnap.data()?.lastStatus ?? null : null;

    // Trust marker as source of truth for "from" to avoid client drift
    const effectiveFrom = last;

    if (to === effectiveFrom) {
      // Already counted; ensure marker exists and return
      if (!markerSnap.exists) {
        tx.set(
          markerRef,
          { lastStatus: to, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
      }
      return;
    }

    const inc = {};
    if (effectiveFrom === "active") inc.totalActive = (inc.totalActive || 0) - 1;
    if (effectiveFrom === "queued") inc.totalQueued = (inc.totalQueued || 0) - 1;
    if (to === "active") inc.totalActive = (inc.totalActive || 0) + 1;
    if (to === "queued") inc.totalQueued = (inc.totalQueued || 0) + 1;

    const updates = {};
    if (inc.totalActive) updates.totalActive = FieldValue.increment(inc.totalActive);
    if (inc.totalQueued) updates.totalQueued = FieldValue.increment(inc.totalQueued);

    if (Object.keys(updates).length > 0) {
      tx.set(workerStatsRef, updates, { merge: true });
    }

    tx.set(
      markerRef,
      { lastStatus: to, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  });

  return { success: true };
}

// --------- 1) Decide waitlist at profile step ----------
exports.decideWaitlistOnProfileSetup = region.https.onCall(async (data, context) => {
  assertAuthed(context);
  const lookingFor = String(data?.lookingFor || "");
  const isWorker = lookingFor === "Find Jobs";

  // Posters default to active immediately in this decision
  if (!isWorker) return { accountStatus: "active" };

  // For workers, use O(1) meta counters to decide queue vs active
  const MAX_ACTIVE = 100; // TODO: remote-config/admin doc

  const res = await db.runTransaction(async (tx) => {
    const statsSnap = await tx.get(workerStatsRef);
    const stats = statsSnap.exists ? statsSnap.data() : { totalActive: 0, totalQueued: 0 };

    if ((stats.totalActive || 0) >= MAX_ACTIVE) {
      // Assign a queue position based on queued count + 1
      const queuePosition = (stats.totalQueued || 0) + 1;
      // Do not mutate counters here; only mutate on confirmed status change
      return { accountStatus: "queued", queuePosition };
    }
    return { accountStatus: "active" };
  });

  return res;
});

// --------- 2) Transition-aware, idempotent stats updates ----------
/**
 * payload: { isWorker: boolean, from: "queued"|"active"|null, to: "queued"|"active"|null }
 */
exports.updateWorkerStatsOnStatusChange = region.https.onCall(async (data, context) => {
  const uid = assertAuthed(context);
  const isWorker = !!data?.isWorker;
  const from = data?.from ?? null;
  const to = data?.to ?? null;

  return applyWorkerStatusTransition({ uid, isWorker, from, to });
});

// --------- 2b) Backward-compatible shim (legacy callable) ----------
/**
 * Legacy payload: { isWorker: boolean, becomingActive: boolean }
 * Delegates to updateWorkerStatsOnStatusChange with { from: null, to: "active"|"queued" }
 */
exports.updateWorkerStatsOnSignup = region.https.onCall(async (data, context) => {
  const uid = assertAuthed(context);
  const isWorker = !!data?.isWorker;
  const to = !!data?.becomingActive ? "active" : "queued";
  return applyWorkerStatusTransition({ uid, isWorker, from: null, to });
});

// --------- 3) Finalize NYC onboarding & set claims ----------
/**
 * payload: { selectedBorough: "Manhattan" | ... }
 * - Validates borough
 * - Writes user fields: borough, onboardingStep="completed"
 * - Preserves existing accountStatus (queued/active) or defaults to "active"
 * - Sets custom claims: region:"nyc", onboarded:true, waitlist:true if queued
 */
exports.finalizeNYCOnboarding = region.https.onCall(async (data, context) => {
  const uid = assertAuthed(context);
  const selectedBorough = String(data?.selectedBorough || "");
  if (!BOROUGHS.has(selectedBorough)) {
    // Mark restricted to avoid loops
    await db.collection("users").doc(uid).set(
      {
        accountStatus: "restricted",
        onboardingStep: "completed",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    await auth.setCustomUserClaims(uid, { out_of_area: true });
    return { ok: false, reason: "OUT_OF_AREA" };
  }

  // Preserve queued/active
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  const current = userSnap.exists ? userSnap.data() : {};
  const currentStatus = current?.accountStatus || "active";
  const finalStatus = currentStatus === "queued" ? "queued" : "active";

  await userRef.set(
    {
      borough: selectedBorough,
      onboardingStep: "completed",
      nycValidatedAt: FieldValue.serverTimestamp(),
      accountStatus: finalStatus,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const claims = {
    region: "nyc",
    onboarded: true,
    waitlist: finalStatus === "queued",
  };
  await auth.setCustomUserClaims(uid, claims);

  return { ok: true, status: finalStatus, claims };
});