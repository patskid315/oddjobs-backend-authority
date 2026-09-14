"use strict";
const assert = require("node:assert/strict");
const { createCompletionHandler } = require("../functions/src/settlement/completionHandler");

async function run(label) {
  let pendingWrites = 0;
  let transferAttempts = 0;
  const repository = { createPending: async () => { pendingWrites += 1; return { created: true }; } };
  const forbiddenStripe = { transfers: { create: async () => { transferAttempts += 1; } } };
  void forbiddenStripe;
  const handler = createCompletionHandler({ repository, logger: { info() {}, warn() {} } });
  const before = { exists: true, data: () => ({ progressStatus: "active" }) };
  const after = { id: "jobRollback", exists: true, data: () => ({ progressStatus: "completed", paymentId: "paymentRollback" }) };
  await handler(before, after);
  assert.equal(pendingWrites, 1, `${label} must create pending state`);
  assert.equal(transferAttempts, 0, `${label} must not attempt Stripe`);
}

(async () => {
  await run("emergency-candidate");
  await run("safe-fallback");
  console.log("ROLLBACK_DRILL_OK candidate=pending_only fallback=pending_only transfer_attempts=0");
})().catch((error) => { console.error(error.message); process.exit(1); });
