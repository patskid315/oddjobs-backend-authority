"use strict";

const { publishGeneralCleaningJob } = require("./publishOrdinaryJob");

function serverControls(env) {
  const open = Number(env.ODDJOBS_V2_MAX_OPEN_JOBS);
  const daily = Number(env.ODDJOBS_V2_MAX_DAILY_PUBLICATIONS);
  return { enabled: env.ODDJOBS_V2_PUBLICATION_ENABLED === "true",
    max_open_jobs: open, max_daily_publications: daily };
}

function createPublicationCallable({ db, auth, env, HttpsError,
  publish = publishGeneralCleaningJob }) {
  return async (data, context) => {
    const uid = context && context.auth && context.auth.uid;
    if (typeof uid !== "string" || !uid) {
      throw new HttpsError("unauthenticated", "Sign in to publish a job.");
    }
    try {
      return await publish({ db, auth, authContext: { uid }, command: data,
        controls: serverControls(env), now: new Date() });
    } catch (error) {
      // Do not expose account, moderation, location, policy or provider internals.
      if (error.message === "PUBLICATION_COMMAND_INVALID") {
        throw new HttpsError("invalid-argument", "Check the job details and try again.");
      }
      throw new HttpsError("failed-precondition",
        "This job cannot be published right now. Your draft is saved.");
    }
  };
}

module.exports = { createPublicationCallable, serverControls };
