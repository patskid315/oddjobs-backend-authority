"use strict";

const { resolveCanonicalTask } = require("./publicationPrerequisites");
const { cleaningV1, cleaningV2 } = require("./generalCleaningValidator");
// Server-owned registrations only. V1 remains read/replay compatible; new
// confirmations use an explicitly selected current task schema.
const registrations = new Map([["general_cleaning", new Map([[1, cleaningV1], [2, cleaningV2]])]]);
function taskValidator(taskTypeId, taxonomyVersion, schemaVersion) {
  const task = resolveCanonicalTask({ taskTypeId, taxonomyVersion });
  if (task.kind !== "CANONICAL_TASK" || task.separateResearchLifecycle) return null;
  return registrations.get(task.taskTypeId)?.get(schemaVersion) || null;
}
module.exports = { taskValidator };
