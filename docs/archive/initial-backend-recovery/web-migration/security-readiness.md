# Security readiness for web expansion

This is an architectural review for adding a public client, not a penetration test. “Unverified” means the necessary deployed policy was unavailable.

## Blockers

| Finding | Evidence / impact | Required checkpoint |
|---|---|---|
| Firebase rules and indexes absent | No Firestore or Storage rules/index source found; direct client writes cannot be evaluated | Export deployed rules/indexes, put under review, add emulator tests |
| Unauthenticated Stripe customer/account endpoints | Eight endpoints accept arbitrary customer, payment-method or user identifiers without sufficient auth | Require Firebase identity and derive resources from UID |
| Client-controlled PaymentIntent amount | `createPaymentIntent` trusts amount/currency/customer from caller | Server quote/order authority |
| Client-controlled payout | iOS writes recipient and `workerCut`; completion triggers transfer stored value | Server assignment/settlement calculation and immutable inputs |
| Non-idempotent transfer retry | Transfer can succeed before Firestore update; retry creates another transfer | Stable Stripe idempotency key and reconciliation state machine |
| No Stripe webhooks | Payment/account/dispute state lacks provider-authoritative reconciliation | Verified webhook endpoint and event ledger |
| Client-owned critical transitions | Job/request/slot/completion/review/payment changes happen in Swift | Authenticated command boundary with ownership/state checks |
| Client-owned roles/status | `lookingFor`, worker counter inputs, onboarding and soft-delete/status are client-written | Server account commands and claims/policy enforcement |
| Verification trust boundary | iOS writes verification status document and public-style download URLs; Storage rules unavailable | Separate submissions from admin decisions; strict Storage policy |
| Committed legacy web secrets | Django settings contain a secret key and SMTP password | Rotate immediately, remove from history, environment-only config |

## Important

| Finding | Recommendation |
|---|---|
| Backend deployment source is unverified | Establish one canonical Git backend and compare deployed function/source hashes |
| Admin schemas differ | Reconcile Function `active` with Next.js `status` and define per-role permissions |
| Admin web contains a local environment file and is separately dirty/versioned | Audit secret history and repository hygiene without copying values |
| Account `deleted` is not a model enum and is checked client-side | Centralize disabled-state authorization and revoke sessions |
| Direct referral email callable accepts arbitrary content | Remove after usage check or template/rate-limit it |
| Comment notification has two producers | Select trigger or command as canonical producer |
| Single `fcmToken` per user | Model devices/channels, rotate tokens, apply preferences |
| SMS scale/query limits | Add paging/queueing, consent audit, STOP handling verification and retention policy |
| Hard-coded Function URLs/regions | Typed environment-aware client configuration |
| Functions v1 runtime config | Migrate secrets/config to supported secret/parameter management |
| Input validation is ad hoc | Shared runtime schemas, bounds, enum validation and structured errors |
| No App Check evidence | Decide and test App Check for public Firebase clients |
| Legacy Django email endpoints allow anonymous requests | Add abuse controls/CSRF or replace with a server-owned contact service |

## Technical debt

- Inconsistent collection/field/status naming and legacy aliases.
- Generic `StorageService` accepts caller-provided paths.
- Many presentation files import Firebase directly.
- No backend/domain/rules tests were found.
- Backend tree includes generated/local dependencies and runtime files in some locations.
- Client logs include operational identifiers and verbose payment state; define a privacy-safe logging policy.

## Minimum public-web security gate

- Canonical backend source and deployed parity recorded.
- Firestore/Storage rules and indexes versioned with emulator tests for unauthenticated, Worker, Poster, suspended/deleted/queued and admin identities.
- Server-owned job, request, assignment, completion, review, verification and payment commands.
- Stripe endpoint hardening, idempotency and webhooks complete.
- Role/account state model approved and enforced from verified identity.
- Rate limits/abuse controls for auth, messaging, comments, referrals, contact and notification creation.
- Privacy/retention review for identity images, phone/email, precise addresses, device tokens, SMS logs and messages.
- Audit/logging/alerting and incident rollback plan.
