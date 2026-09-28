# OddJobs production web migration audit

Audit date: 2026-08-09
Documentation baseline: `recovery/ios-design-system-work` at `745ec8208ea5ad6ac221308ca78ef720c63b86cd`

## Executive summary

OddJobs is a Firebase-backed iOS marketplace whose production behavior is split across Swift clients, Firebase Functions, Firestore triggers, Firebase Storage, Stripe, FCM/APNs, Twilio, Gmail, Discord, MapKit/Core Location, and a separate Next.js admin application. It is not yet a shared-domain platform: many security-sensitive rules and mutations live in iOS ViewModels or services and write directly to Firestore.

The most reusable server capabilities are event-driven notifications, administrative activity capture, referrals, NYC claim finalization, and several authenticated account operations. Public web launch is blocked by the absence of source-controlled Firebase rules in the audited workspace, unauthenticated or insufficiently scoped Stripe endpoints, client-controlled prices and payout amounts, client-driven role/status transitions, and the lack of Stripe webhook reconciliation/idempotency.

The recommended direction is an incremental Next.js TypeScript consumer application backed by the existing Firebase project, with platform-neutral domain contracts and repository interfaces. Security-sensitive commands should move behind authenticated, ownership-validating server capabilities before their corresponding web feature ships. iOS and web should then call the same server commands. The existing backend should be hardened and versioned, not replaced wholesale.

## Audit boundary and evidence

Facts in this package were derived from:

- The clean iOS recovery worktree listed above.
- The sibling product workspace at `/Users/zachwilcox/Desktop/Projects/OddJobsNewYorkProduct`.
- The newer-looking but unversioned sibling `backend/` directory for the 48-function inventory.
- The independently versioned `apps/Web/oddjobs-admin` Next.js repository at commit `cc0ad84b4631857201d1b1754eded531a4dfcd03`.
- The legacy Django marketing site under `apps/Web/oddjob-web`.

The top-level product workspace and its sibling `backend/` directory are not Git repositories. The clean iOS worktree contains a tracked backend snapshot, but that snapshot lacks the newer admin, Discord, and SMS modules found in the sibling backend. Which source produced the currently deployed functions could not be verified. Deployment inventory, deployed configuration, Firebase rules, indexes, App Check policy, and live data were not inspected.

**Gate 0 update (2026-08-09):** read-only production inventory has now recovered the deployed Function list, rules, and indexes without accessing application data. The deployed Git commit remains unknown, and the recovered policy is not yet source-controlled. See [Gate 0 — backend authority and safety](gate-0/README.md).

Labels used throughout:

- **Fact**: directly observed in source.
- **Recommendation**: proposed future work.
- **Unverified**: requires deployed configuration, rules, logs, or product confirmation.

## Launch disposition

**Not ready for a public consumer web client.** The next checkpoint is a backend-authority and security-contract review: identify the deployed function source, export rules/indexes without changing them, inventory deployed function versions, and approve server-owned command boundaries for auth/profile, jobs, requests, completion, and payments.

## Documents

- [Gate 0 — backend authority and safety](gate-0/README.md)
- [Complete audit report](audit-report.md)
- [Repository overview](repository-overview.md)
- [Backend capabilities](backend-capabilities.md)
- [Firebase data model](firebase-data-model.md)
- [Authentication and authorization](authentication-authorization.md)
- [Domain map](domain-map.md)
- [iOS to backend dependencies](ios-backend-dependencies.md)
- [Cloud Function reuse](cloud-function-reuse.md)
- [Shared business rules](shared-business-rules.md)
- [Stripe architecture](stripe-architecture.md)
- [Security readiness](security-readiness.md)
- [Web migration matrix](web-migration-matrix.md)
- [Recommended web architecture](recommended-web-architecture.md)
- [Implementation roadmap](implementation-roadmap.md)
