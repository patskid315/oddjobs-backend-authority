"use strict";

const SettlementStatus = Object.freeze({
  PENDING: "pending", CLAIMED: "claimed", PROCESSING: "processing",
  SUCCEEDED: "succeeded", FAILED: "failed", MANUAL_REVIEW: "manualReview",
  BLOCKED: "blocked", CANCELLED: "cancelled"
});

const terminal = new Set([SettlementStatus.SUCCEEDED, SettlementStatus.BLOCKED, SettlementStatus.CANCELLED]);
const transitions = new Map([
  [SettlementStatus.PENDING, new Set([SettlementStatus.CLAIMED, SettlementStatus.BLOCKED, SettlementStatus.CANCELLED])],
  [SettlementStatus.CLAIMED, new Set([SettlementStatus.PROCESSING, SettlementStatus.MANUAL_REVIEW, SettlementStatus.FAILED])],
  [SettlementStatus.PROCESSING, new Set([SettlementStatus.SUCCEEDED, SettlementStatus.MANUAL_REVIEW, SettlementStatus.FAILED])],
  [SettlementStatus.FAILED, new Set([SettlementStatus.CLAIMED, SettlementStatus.MANUAL_REVIEW, SettlementStatus.BLOCKED])],
  [SettlementStatus.MANUAL_REVIEW, new Set([SettlementStatus.CLAIMED, SettlementStatus.SUCCEEDED, SettlementStatus.BLOCKED])]
]);

function assertTransition(from, to) {
  if (from === to) return;
  if (terminal.has(from) || !transitions.get(from)?.has(to)) throw new Error(`Illegal settlement transition: ${from} -> ${to}`);
}

module.exports = { SettlementStatus, assertTransition };
