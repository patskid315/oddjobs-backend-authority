# Cloud Function reuse analysis

## Totals

Each of the 48 exports has one primary disposition in [backend capabilities](backend-capabilities.md).

| Class | Count | Meaning |
|---|---:|---|
| A — reuse as-is | 19 | Background behavior is platform-neutral, subject to normal tests/operations review |
| B — reuse with client adapter | 12 | Backend contract can be wrapped in typed TypeScript after schema validation |
| C — refactor before web | 1 | Delivery behavior is mobile-specific or incomplete for web |
| D — iOS-specific | 0 | No server export is intrinsically iOS-only |
| E — legacy / possibly unused | 3 | Confirm before retaining or deleting |
| F — security review required | 13 | Unsafe to expose to a new public client in current form |
| **Total** | **48** | |

## A — reuse as-is

This group is primarily event-driven infrastructure: Auth customer provisioning, completed-job connection creation, comment notification-document generation, 12 admin activity triggers, Discord alert delivery and three SMS jobs. “As-is” means no platform fork is required; it does not waive deployed parity, rate, privacy, monitoring, or rules verification.

## B — reuse with a web adapter

The reusable callable contracts are connected-account creation, Stripe balance, NYC finalization, eligible-worker lookup, referral sending, and seven admin reads. A web adapter should:

- expose typed inputs/results and normalize Function error codes;
- derive region and endpoint from configuration;
- attach Firebase identity automatically;
- avoid accepting redundant user IDs;
- enforce runtime schemas and stable enums;
- keep admin and consumer adapters in separate trust boundaries.

## C — refactor before web

`observeFirestoreNotifications` assumes a single FCM token on the user and sends mobile push/APNs-oriented payloads. Preserve the notification document as the channel-neutral event, then add registered-device/channel records and a web-push delivery adapter. Preferences, consent, token cleanup and delivery diagnostics should be common.

## D — iOS-specific

No Cloud Function belongs exclusively to iOS. MapKit, UIKit presentation, APNs registration and Stripe PaymentSheet presentation are client responsibilities but are not Functions.

## E — legacy / possibly unused

- `observeJobPosts`: disabled by a source-code kill switch and reads legacy flat address fields.
- `updateWorkerStatsOnSignup`: explicitly documented as a backward-compatible shim.
- `sendReferralEmail`: direct/testing callable with no iOS caller found; it accepts arbitrary recipient, subject and body from any authenticated user.

Confirm deployed invocation/logs before removal. If the direct email callable is retained, restrict content to server templates and add rate/abuse controls.

## F — security review required

Eleven Stripe functions are unsafe or depend on unsafe client-owned records: eight callable/HTTP customer/payment endpoints plus two payout triggers and the retry scheduler. The other two are worker waitlist/stats functions that trust client role/status inputs.

Required fixes are described in [Stripe architecture](stripe-architecture.md), [Security readiness](security-readiness.md), and [Shared business rules](shared-business-rules.md). Do not create a web wrapper around an F-class endpoint; fix and test its server contract first.

## Missing capabilities are more important than new adapters

Function reuse alone does not make the product web-ready. The server currently lacks commands for job creation, promo redemption, requests, assignment, start, completion, reviews, verification decisions, messaging and comments. Build those as platform-neutral use cases and migrate iOS callers incrementally; otherwise web would duplicate Swift logic.
