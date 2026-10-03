"use strict";

const { resolveCanonicalTask } = require("./publicationPrerequisites");
const { cleaningV1, cleaningV2, cleaningV2Text3, cleaningV2Text4, cleaningV2Text5 } = require("./generalCleaningValidator");
const { cleaningV2Text6, cleaningV2Text7, cleaningV2Text8 } = require("./generalCleaningReconciliationV6");
// Server-owned registrations only. V1 remains read/replay compatible; new
// confirmations use an explicitly selected current task schema.
const registrations = new Map([["general_cleaning", new Map([[1, cleaningV1], [2, cleaningV2Text5]])]]);
function taskValidator(taskTypeId, taxonomyVersion, schemaVersion, textRuleVersion) {
  const task = resolveCanonicalTask({ taskTypeId, taxonomyVersion });
  if (task.kind !== "CANONICAL_TASK" || task.separateResearchLifecycle) return null;
  const current = registrations.get(taskTypeId)?.get(schemaVersion);
  if (!current) return null;
  if (textRuleVersion === undefined) return current;
  if (schemaVersion === 2 && textRuleVersion === cleaningV2Text6.textRuleVersion) return cleaningV2Text6;
  if (schemaVersion === 2 && textRuleVersion === cleaningV2Text7.textRuleVersion) return cleaningV2Text7;
  if (schemaVersion === 2 && textRuleVersion === cleaningV2Text8.textRuleVersion) return cleaningV2Text8;
  if (textRuleVersion === current.textRuleVersion) return current;
  if (schemaVersion === 2 && textRuleVersion === cleaningV2.textRuleVersion) return cleaningV2;
  if (schemaVersion === 2 && textRuleVersion === cleaningV2Text3.textRuleVersion) return cleaningV2Text3;
  if (schemaVersion === 2 && textRuleVersion === cleaningV2Text4.textRuleVersion) return cleaningV2Text4;
  return null;
}
module.exports = { taskValidator };
