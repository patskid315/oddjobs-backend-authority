# Dependency risk report

Audit date: 2026-09-13

## Before remediation

18 vulnerable dependency entries: 16 moderate, 1 high, 1 critical. The critical `node-tar` path and high-severity aggregate were transitive through the Firebase CLI development dependency.

## Remediation applied

| Direct package | Before | After | Reason |
|---|---:|---:|---|
| firebase-admin | 12.5.0 | 13.10.0 | Newer Node 20-compatible server SDK |
| firebase-functions | 4.9.0 | 6.6.0 | Newer Node 20-compatible Gen 1 API support |
| stripe | 18.1.0 | 22.6.2 | Current Node 20-compatible Stripe SDK |
| firebase-tools | 14.x | 15.30.0 | Removes the critical/high `tar` chain |
| @firebase/rules-unit-testing | 4.x | 5.0.2 | Current Node 20-compatible Emulator test SDK |

The Node 22-only Firebase Admin 14 line was deliberately not selected because the verified production runtime is Node.js 20 and a runtime migration is outside the emergency diff.

## After remediation

Final `npm audit --json`: 18 moderate, 0 high, 0 critical. Remaining advisories are transitive families involving Firestore/Storage clients (`google-gax`, `retry-request`, `teeny-request`, `uuid`), CLI/test tooling (`@google-cloud/pubsub`, OpenTelemetry, `csv-parse`, `stream-json`), and Express/`qs` plus optional `re2` paths.

Runtime exposure is constrained because Option A exposes no new HTTP endpoint, the emergency trigger consumes Firestore events, transfer execution is disabled, and Firebase CLI packages are development-only. Nevertheless, the server SDK advisories affect dependencies that can load in the serverless process, so they are not silently waived.

## Proposed temporary risk acceptance—not approved

- Advisory families: `GHSA-8988-4f7v-96qf`, `GHSA-8cw4-87c7-c6xx`, `GHSA-x5fp-wj9c-mxmx`, `GHSA-4mjr-xmp4-gh2g`, `GHSA-ff84-5f28-78qj`, `GHSA-6hxr-mr5r-9836`, `GHSA-j4r3-hg7j-8chg`, `GHSA-8hcv-x26h-mcgp`, `GHSA-528h-pc64-c93x`, and related transitive `uuid`/Google client chains shown by the lockfile audit.
- Actual exposure: primarily denial-of-service or malformed-input paths; CLI-only findings are not deployed. No new public request surface is introduced by this candidate.
- Compensating controls: one-function deployment, executor disabled, no webhook deployment, least-privilege project selection, log/error alerts, immutable lockfile, and 24-hour canary observation.
- Proposed expiration: 2026-09-27.
- Proposed owner: OddJobs backend engineering owner.
- Planned remediation: validate Firebase Admin 14 on Node 22 in a separate runtime migration or adopt patched transitive releases when available.

Because an accountable owner has not approved this acceptance, remaining moderate runtime advisories are a **PASS WITH CONDITIONS / release approval blocker**, not an accepted risk.
