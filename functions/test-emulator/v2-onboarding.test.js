"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
let env;
test.before(async () => { env = await initializeTestEnvironment({ projectId: "demo-oddjobs-home", firestore: { host: "127.0.0.1", port: 8080, rules: fs.readFileSync("../firestore.rules", "utf8") } }); });
test.after(async () => { await env?.cleanup(); });
test.beforeEach(async () => env.clearFirestore());
test("only backend establishes completion; legitimate progression and existing users remain supported", async () => {
  const user = env.authenticatedContext("owner").firestore().doc("users/owner");
  await assertFails(user.set({ onboardingStep: "completed", accountStatus: "created", verificationStatus: "none" }));
  await assertSucceeds(user.set({ onboardingStep: "setupAccount", accountStatus: "created", verificationStatus: "none" }));
  await assertSucceeds(user.update({ onboardingStep: "addressInput" }));
  await assertFails(user.update({ onboardingStep: "completed" }));
  await assertFails(user.update({ accountStatus: "deleted", onboardingStep: "completed" }));
  await assertSucceeds(user.update({ onboardingStep: "verifyIdentity" }));
  await env.withSecurityRulesDisabled(async ctx => ctx.firestore().doc("users/owner").update({ onboardingStep: "completed", accountStatus: "active" }));
  await assertSucceeds(user.update({ displayName: "Synthetic owner" }));
  assert.equal((await user.get()).data().onboardingStep, "completed");
});
test("home linkage and protected evidence are never client readable/writable, even for their owner", async () => {
  for (const uid of ["owner", "other"]) {
    const db = env.authenticatedContext(uid).firestore();
    for (const path of ["v2SavedHomeLocations/owner", "v2ProtectedLocations/synthetic"]) {
      await assertFails(db.doc(path).set({ owner_ref: uid, derivation_state: "VALIDATED" }));
      await assertFails(db.doc(path).get()); await assertFails(db.doc(path).delete());
    }
  }
});
