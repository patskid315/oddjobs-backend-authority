"use strict";
const { interpretGeneralCleaning } = require("./generalCleaningInterpreter");
// Pure advisory adapter: no database, persistence, policy or publication dependency.
function createCleaningInterpretationCallable({ HttpsError }) {
  return async (data, context) => {
    if (typeof context?.auth?.uid !== "string" || !context.auth.uid) throw new HttpsError("unauthenticated", "Sign in to review your job.");
    try { return interpretGeneralCleaning(data); }
    catch (error) {
      if (error.message === "CLEANING_INTERPRETATION_INPUT_INVALID") throw new HttpsError("invalid-argument", "Check your job details.");
      throw new HttpsError("internal", "Job understanding is temporarily unavailable.");
    }
  };
}
module.exports = { createCleaningInterpretationCallable };
