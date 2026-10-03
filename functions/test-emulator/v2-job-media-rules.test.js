"use strict";
const test = require("node:test");
const fs = require("node:fs");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
let env;
test.before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-oddjobs-media",
    storage: { host: "127.0.0.1", port: 9199, rules: fs.readFileSync("../storage.rules", "utf8") },
    firestore: { host: "127.0.0.1", port: 8080, rules: fs.readFileSync("../firestore.rules", "utf8") } });
});
test.after(async () => { await env?.cleanup(); });
test("existing draft rules isolate uploads; published namespace denies every client write/delete/read", async () => {
  const bytes = new Uint8Array([255, 216, 255, 217]);
  const draft = "job_post_drafts/poster/flow/photo_0.jpg";
  await assertSucceeds(env.authenticatedContext("poster").storage().ref(draft).put(bytes, { contentType: "image/jpeg" }));
  await assertFails(env.authenticatedContext("other").storage().ref(draft).put(bytes));
  await assertFails(env.authenticatedContext("other").storage().ref(draft).getDownloadURL());
  const published = `v2PublishedJobMedia/${"a".repeat(64)}.jpg`;
  await env.withSecurityRulesDisabled((context) => context.storage().ref(published).put(bytes, { contentType: "image/jpeg" }));
  for (const context of [env.authenticatedContext("poster"), env.authenticatedContext("other"), env.unauthenticatedContext()]) {
    await assertFails(context.storage().ref(published).put(bytes));
    await assertFails(context.storage().ref(published).delete());
    await assertFails(context.storage().ref(published).getDownloadURL());
  }
});
test("media authority documents are inaccessible to clients including claimed owner", async () => {
  const path = `v2JobMedia/${"a".repeat(64)}`;
  await env.withSecurityRulesDisabled((context) => context.firestore().doc(path).set({ owner_ref: "poster", state: "FINALIZED" }));
  for (const uid of ["poster", "other"]) {
    const ref = env.authenticatedContext(uid).firestore().doc(path);
    await assertFails(ref.get()); await assertFails(ref.set({ owner_ref: uid, state: "PUBLISHED" })); await assertFails(ref.delete());
  }
});
