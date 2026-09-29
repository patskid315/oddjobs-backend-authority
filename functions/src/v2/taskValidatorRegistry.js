"use strict";

const { resolveCanonicalTask } = require("./publicationPrerequisites");
const { cleaningV1, cleaningV2, cleaningV2Text3 } = require("./generalCleaningValidator");
// Server-owned registrations only. V1 remains read/replay compatible; new
// confirmations use an explicitly selected current task schema.
const registrations = new Map([["general_cleaning", new Map([[1, cleaningV1], [2, cleaningV2Text3]])]]);
function taskValidator(taskTypeId, taxonomyVersion, schemaVersion, textRuleVersion) {
  const task = resolveCanonicalTask({ taskTypeId, taxonomyVersion });
  if (task.kind !== "CANONICAL_TASK" || task.separateResearchLifecycle) return null;
  const current = registrations.get(taskTypeId)?.get(schemaVersion);
  if (!current) return null;
  if (textRuleVersion === undefined) return current;
  if (textRuleVersion === current.textRuleVersion) return current;
  if (schemaVersion === 2 && textRuleVersion === cleaningV2.textRuleVersion) return cleaningV2;
  return null;
}
module.exports = { taskValidator };
