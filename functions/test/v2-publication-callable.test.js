"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPublicationCallable, serverControls } = require("../src/v2/publicationCallable");

class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

test("callable binds owner to verified Firebase context, never the body", async () => {
  let received;
  const handler = createPublicationCallable({ db: {}, auth: {}, env: {
    ODDJOBS_V2_PUBLICATION_ENABLED: "true", ODDJOBS_V2_MAX_OPEN_JOBS: "2",
    ODDJOBS_V2_MAX_DAILY_PUBLICATIONS: "3" }, HttpsError,
  publish: async (args) => { received = args; return { job_ref: "job-1" }; } });
  await assert.rejects(handler({ owner_ref: "forged" }, {}),
    (error) => error.code === "unauthenticated");
  assert.deepEqual(await handler({ owner_ref: "forged" }, { auth: { uid: "poster-1" } }),
    { job_ref: "job-1" });
  assert.equal(received.authContext.uid, "poster-1");
  assert.equal(received.command.owner_ref, "forged");
  assert.deepEqual(received.controls, { enabled: true, max_open_jobs: 2,
    max_daily_publications: 3 });
});

test("publication is disabled without explicit server configuration and errors stay generic", async () => {
  assert.equal(serverControls({}).enabled, false);
  assert.equal(Number.isNaN(serverControls({}).max_open_jobs), true);
  const handler = createPublicationCallable({ db: {}, auth: {}, env: {}, HttpsError,
    publish: async () => { throw new Error("PRIVATE_MODERATION_DECISION"); } });
  await assert.rejects(handler({}, { auth: { uid: "poster-1" } }),
    (error) => error.code === "failed-precondition" &&
      !error.message.includes("PRIVATE_MODERATION_DECISION"));
});
