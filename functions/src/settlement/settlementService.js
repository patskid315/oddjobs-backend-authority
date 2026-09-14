"use strict";

function validateEligibility(o) {
  if (!o || o.jobStatus !== "completed" || o.paymentStatus !== "succeeded") throw new Error("Settlement not eligible");
  if (!o.jobId || !o.paymentId || o.jobPaymentId !== o.paymentId || o.paymentJobId !== o.jobId) throw new Error("Job payment mismatch");
  if (!o.workerId || o.workerId !== o.paymentRecipientId) throw new Error("Worker mismatch");
  if (!Number.isSafeInteger(o.workerAmount) || o.workerAmount <= 0 || !o.currency) throw new Error("Invalid trusted amount");
  if (!o.destinationAccountId || o.cancelled || o.refunded || o.disputed || o.priorSettlement) throw new Error("Settlement blocked");
}

module.exports = { validateEligibility };
