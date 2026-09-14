# Privacy-safe production record reconciliation

Capture date: 2026-09-13  
Method: authenticated read-only Firestore and Stripe console inspection. Hashes are truncated SHA-256 labels generated solely for this report. No production record or Stripe object was changed.

## Summary

- Jobs: 46 — 36 active and 10 completed; no assigned or in-progress jobs were visible.
- Payments: 14 — 8 pending, 2 not applicable, and 4 marked paid/completed.
- Paid group: three records expose transfer references that do not match the sole visible live Stripe transfer; one paid record did not expose a transfer reference in the current console view.
- Withdrawals: 3 — all requested.
- Balance records: 3 — `totalEarned`/`lastUpdated` legacy shape with no lifecycle status.
- Visible live Stripe payments: 4 — one succeeded, two refunded, one failed.
- Visible live OddJobs transfer: 1. Platform payouts: 0. Live webhook endpoints: 0.

## Payment treatment ledger

| Privacy-safe record | Observed state | Classification | Migration treatment |
|---|---|---|---|
| pay:574727793050 | pending; paymentSkipped=true | NOT PAYMENT-ELIGIBLE / stale status | Exclude from settlement; normalize only in a separately reviewed migration |
| pay:f3c53ebf5048 | pending; not skipped | UNKNOWN | Join to job and Stripe payment before any settlement action |
| pay:45b305812c6e | pending; not skipped | UNKNOWN | Join to job and Stripe payment before any settlement action |
| pay:80dce010133e | pending; not skipped | UNKNOWN | Join to job and Stripe payment before any settlement action |
| pay:9c970b62e5ed | pending; not skipped | UNKNOWN | Join to job and Stripe payment before any settlement action |
| pay:8924136840ba | pending; not skipped | UNKNOWN | Join to job and Stripe payment before any settlement action |
| pay:7362006e19ac | pending; not skipped | UNKNOWN | Join to job and Stripe payment before any settlement action |
| pay:e84c66bb083d | pending; not skipped | UNKNOWN | Join to job and Stripe payment before any settlement action |
| pay:2cc593e9be48 | not_applicable; paymentSkipped=true | NOT PAYMENT-ELIGIBLE | Preserve exclusion; no transfer |
| pay:bca3bd35b32a | not_applicable; paymentSkipped=true | NOT PAYMENT-ELIGIBLE | Preserve exclusion; no transfer |
| pay:ee851dd10341 | paid/completed; transfer reference unmatched | MANUAL REVIEW REQUIRED | Retrieve historical transfer in correct account/mode before accepting as settled |
| pay:efd303b8c007 | paid/completed; transfer reference unmatched | MANUAL REVIEW REQUIRED | Retrieve historical transfer in correct account/mode before accepting as settled |
| pay:96da41f368d9 | paid/completed; transfer reference unmatched | MANUAL REVIEW REQUIRED | Retrieve historical transfer in correct account/mode before accepting as settled |
| pay:f4c2f70bb05c | paid; no transfer reference exposed | MANUAL REVIEW REQUIRED | Search Stripe by payment/job metadata and adjudicate; never replay automatically |

The earlier aggregate showed four completed records without transfer references. The current record-level console pass exposes one paid/no-reference record plus seven unresolved non-skipped pending records; job-document correlation was not reliable enough in the console to assign the remaining completed subset safely. They therefore remain UNKNOWN rather than being guessed.

## Withdrawal treatment ledger

| Privacy-safe record | State | Classification | Migration treatment |
|---|---|---|---|
| withdraw:7b516a0a8197 | requested | MANUAL REVIEW REQUIRED | Determine whether a Stripe payout/transfer or manual payment exists; do not execute automatically |
| withdraw:23bac959f420 | requested | MANUAL REVIEW REQUIRED | Determine whether a Stripe payout/transfer or manual payment exists; do not execute automatically |
| withdraw:4da0c4f37b1a | requested | MANUAL REVIEW REQUIRED | Determine whether a Stripe payout/transfer or manual payment exists; do not execute automatically |

## Balance treatment ledger

| Privacy-safe record | State | Classification | Migration treatment |
|---|---|---|---|
| balance:05cc14afa912 | legacy totalEarned; no status | LEGACY DATA | Recompute from adjudicated financial events before migration |
| balance:6b62f4f24536 | legacy totalEarned; no status | LEGACY DATA | Recompute from adjudicated financial events before migration |
| balance:672f7471fb4b | legacy totalEarned; no status | LEGACY DATA | Recompute from adjudicated financial events before migration |

## Cause and authority conclusion

The evidence supports legacy architecture and stale/incomplete Firestore lifecycle data. It does not prove deletion or restriction of Stripe objects, and it does not exclude a historical account or mode mismatch. Stripe is authoritative for whether money moved; Firestore is currently an incomplete application ledger.

Reconciliation is **not complete enough to authorize automated settlement or an emergency release candidate commit**. At minimum, 7 pending payments, 4 paid records, 3 withdrawals, and 3 balance records require further adjudication. No PII, card/bank data, secret, or full provider identifier appears here.
