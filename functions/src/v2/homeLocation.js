"use strict";
const { projectEligibilityGeography } = require("./publicationPrerequisites");
const { commandPayloadDigest } = require("./foundation");
const BOROUGHS = { "nyc:borough:manhattan": "Manhattan", "nyc:borough:bronx": "Bronx", "nyc:borough:brooklyn": "Brooklyn", "nyc:borough:queens": "Queens", "nyc:borough:staten_island": "Staten Island" };
function createHomeAuthorities({ db, auth, HttpsError, timestamp = () => new Date() }) {
  const fail = (reason, code = "failed-precondition") => { throw new HttpsError(code, "Review your saved address and try again.", { domain: "v2_home_location", version: 1, reason }); };
  const owner = (context) => { const uid = context?.auth?.uid; if (typeof uid !== "string" || !uid || uid.includes("/")) fail("authentication_required", "unauthenticated"); return uid; };
  async function location(tx, uid, ref) {
    if (typeof ref !== "string" || !/^[a-f0-9]{64}$/.test(ref)) fail("verified_home_required");
    const snap = await tx.get(db.collection("v2ProtectedLocations").doc(ref));
    const value = snap.exists && snap.data();
    if (!value || value.owner_ref !== uid || value.protected_ref !== ref) fail("verified_home_required");
    let geography;
    try { geography = projectEligibilityGeography(value); } catch (_) { fail("verified_home_required"); }
    if (geography.applicability !== "IN_PERSON" || !value.exact_address || commandPayloadDigest(value.exact_address) !== value.address_digest) fail("verified_home_required");
    return { protected_ref: ref, eligibility_geography: geography, address: value.exact_address };
  }
  async function home(tx, uid) {
    const snap = await tx.get(db.collection("v2SavedHomeLocations").doc(uid));
    if (!snap.exists) return null;
    const link = snap.data();
    if (link.owner_ref !== uid || link.schema_version !== 1) fail("verified_home_required");
    return location(tx, uid, link.protected_ref);
  }
  async function safely(action) {
    try { return await action(); } catch (error) {
      if (error instanceof HttpsError) throw error;
      fail("temporarily_unavailable", "unavailable");
    }
  }
  return {
    savedHome: (data, context) => safely(async () => {
      const uid = owner(context);
      const op = data?.operation;
      const keys = op === "set" ? ["operation", "protected_ref"] : ["operation"];
      if (!["get", "set"].includes(op) || Object.keys(data).sort().join() !== keys.sort().join()) fail("invalid_request", "invalid-argument");
      return db.runTransaction(async tx => {
        if (op === "get") return { schema_version: 1, home: await home(tx, uid) };
        const value = await location(tx, uid, data.protected_ref);
        tx.set(db.collection("v2SavedHomeLocations").doc(uid), { schema_version: 1, owner_ref: uid, protected_ref: value.protected_ref });
        return { schema_version: 1, home: value };
      });
    }),
    finalize: (data, context) => safely(async () => {
      const uid = owner(context);
      if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(k => k !== "selectedBorough")) fail("invalid_request", "invalid-argument");
      // Compatibility selectedBorough is deliberately ignored. Only server evidence grants access.
      const checked = await db.runTransaction(async tx => {
        const value = await home(tx, uid);
        if (!value) fail("verified_home_required");
        const profile = await tx.get(db.collection("users").doc(uid));
        if (!profile.exists) fail("profile_required");
        return { value, status: profile.data().accountStatus === "queued" ? "queued" : "active" };
      });
      const user = await auth.getUser(uid);
      // Preserve unrelated claims; this callable owns only the NYC onboarding claims.
      const claims = { ...(user.customClaims || {}), region: "nyc", onboarded: true, waitlist: checked.status === "queued" };
      delete claims.out_of_area;
      await auth.setCustomUserClaims(uid, claims);
      await db.collection("users").doc(uid).set({ borough: BOROUGHS[checked.value.eligibility_geography.borough_id],
        onboardingStep: "completed", nycValidatedAt: timestamp(), accountStatus: checked.status, updatedAt: timestamp() }, { merge: true });
      return { ok: true, status: checked.status, claims: { region: "nyc", onboarded: true, waitlist: checked.status === "queued" } };
    })
  };
}
module.exports = { createHomeAuthorities };
