# Backend capability inventory

## Count by type

The most complete available backend exports **48 functions**:

| Type | Count |
|---|---:|
| Callable | 21 |
| HTTP | 3 |
| Firestore trigger | 21 |
| Auth trigger | 1 |
| Scheduled | 2 |
| Realtime Database trigger | 0 |
| Stripe webhook | 0 |
| **Total** | **48** |

The count is based on `/backend/functions/*.js` in the sibling workspace. Deployment parity is unverified.

Reuse codes: **A** reuse as-is; **B** reuse with a web adapter; **C** refactor before web; **D** iOS-specific; **E** legacy/possibly unused; **F** security review required.

## Payments and Stripe (14)

| Function | Type; auth | Input → output | Data / external service | Current caller; web | Reuse / concern |
|---|---|---|---|---|---|
| `createStripeCustomerOnSignup` | Auth create; system | Auth user → none | writes `stripe_customers/{uid}`; Stripe Customer | implicit signup; yes | A; idempotency/retry should be verified |
| `createConnectedAccount` | Callable; authenticated UID | none/legacy userId → account id/status | R/W `stripe_customers/{uid}`; Stripe Express Account | `StripeService`; yes | B; ignore client userId and retain UID scope |
| `getStripeBalance` | Callable; authenticated UID | none → available/pending balances | reads `stripe_customers/{uid}`; Stripe Balance | `StripeService`; worker web | B |
| `createEphemeralKey` | Callable; **no auth check** | arbitrary customerId → secret | Stripe Ephemeral Key | `StripeService`, `MyApiClient`; yes | F; scope customer to authenticated UID |
| `listPaymentMethods` | HTTP; **unauthenticated** | query customerId → card list | Stripe PaymentMethods | `StripeService` hard-coded URL; yes | F; use authenticated callable/HTTP bearer token |
| `createSetupIntent` | Callable; **no auth check** | arbitrary customerId → client secret | Stripe SetupIntent | `StripeService`; yes | F |
| `detachPaymentMethod` | Callable; **no auth check** | arbitrary paymentMethodId → success | Stripe detach | iOS calls hard-coded HTTP URL despite callable implementation; yes | F; caller/protocol mismatch plus ownership check |
| `createPaymentIntent` | Callable; **no auth check** | client amount, currency, customerId, paymentMethodId → client secret | Stripe PaymentIntent/PaymentMethod | `StripeService`; yes | F; amount and customer are client-controlled |
| `createAccountLink` | HTTP; **unauthenticated** | query userId → Connect onboarding URL | reads `stripe_customers/{userId}`; Stripe AccountLink | `StripeService`; worker web | F |
| `createDashboardLink` | HTTP; **unauthenticated** | query userId → login URL | reads `stripe_customers/{userId}`; Stripe LoginLink | `StripeService`; worker web | F |
| `releasePaymentOnCompletion` | Firestore update | job enters completed → payout state | R `jobPost`, `payments`, `stripe_customers`; W `payments`, `balance`, `notifications`, `payout_pending_jobs`; Stripe Transfer | implicit iOS completion; yes | F; trusts payment `workerCut`/recipient and lacks transfer idempotency key |
| `releaseResearchPaymentOnSlotCompletion` | Firestore update | slot enters completed → payout state | same paths plus `jobPost/{jobId}/slots/{slotId}`; Stripe Transfer | implicit research completion; yes | F; same risks |
| `retryPendingPayouts` | Scheduled hourly | pending records → retry results | R/W `payout_pending_jobs`, `payments`, `stripe_customers`, `balance`, `notifications`; Stripe Transfer | system; yes | F; retry can duplicate a transfer after partial failure |
| `getDefaultPaymentMethod` | Callable; **no auth check** | arbitrary customerId → payment method | Stripe Customer/PaymentMethods | `StripeService`; yes | F |

## Auth, onboarding and worker capacity (4)

| Function | Type; auth | Input → output | Data / external service | Current caller; web | Reuse / concern |
|---|---|---|---|---|---|
| `decideWaitlistOnProfileSetup` | Callable; authenticated | client `lookingFor` → active/queued and position | reads `meta/workerStats` | `ProfileSetupViewModel`; yes | F; role selection/capacity decision is not persisted atomically and trusts client role |
| `updateWorkerStatsOnStatusChange` | Callable; authenticated | client isWorker/from/to → success | R/W `meta/workerStats`, `meta/workerStatsUsers/users/{uid}` | no current iOS call found | F; caller can choose whether it is a worker and destination bucket |
| `updateWorkerStatsOnSignup` | Callable; authenticated | client isWorker/becomingActive → success | same as above | `ProfileSetupViewModel` | E; documented legacy shim, also inherits validation concern |
| `finalizeNYCOnboarding` | Callable; authenticated | borough → status/claims | R/W `users/{uid}`; Firebase Auth claims | `AddressViewModel`; yes | B; server validates five borough names, not the actual address/coordinate |

## Referrals and connections (4)

| Function | Type; auth | Input → output | Data / external service | Current caller; web | Reuse / concern |
|---|---|---|---|---|---|
| `onJobCompleted_createConnection` | Firestore update | job enters completed → none | R `jobPost`; W `jobConnections/{poster_worker}` | implicit completion; yes | A |
| `fetchEligibleWorkers` | Callable; authenticated poster | optional posterId → worker summaries | R `users`, `jobConnections` | `ReferWorkerViewModel`; yes | B |
| `sendReferral` | Callable; authenticated poster/inviter | existing-worker or email invite → ok | R `users`, `jobPost`, `jobConnections`; W `referrals`, `notifications`; Gmail API | `ReferralService`; yes | B; retain dedupe and rate-limit email |
| `sendReferralEmail` | Callable; authenticated only | arbitrary recipient/subject/body → ok | Gmail API | no iOS caller found; unlikely | E; direct/testing endpoint enables authenticated email abuse |

The iOS `ReviewWorkerViewModel` calls `upsertJobConnection`, but no such export exists in the audited backend. The Firestore completion trigger appears to supersede it; deployed behavior requires verification.

## Product notifications (6)

| Function | Type; auth | Input → output | Data / external service | Current caller; web | Reuse / concern |
|---|---|---|---|---|---|
| `observeJobComments` | Firestore create | comment → notification docs | R `jobPost`; W `notifications` | implicit `CommentsViewModel`; yes | A; overlaps client-created notifications and needs one canonical producer |
| `observeFirestoreNotifications` | Firestore create | notification → delivery result | R `users/{receiverID}`; Firebase Messaging/APNs | implicit all notification writers; web needs delivery adapter | C; add preference checks and web-push channel rather than copy APNs assumptions |
| `observeJobPosts` | Firestore create | job → email | Gmail/nodemailer config | implicit job create; no | E; global kill switch is false and schema reads legacy flat address fields |
| `sendIncompleteOnboardingSmsReminders` | Scheduled daily | eligible users → SMS log/delivery | R `users`; W `sms_logs`; Twilio | system; potentially | A; consent fields and rate/retention policy need product review |
| `sendNewJobSmsMatches` | Firestore create | new job → matched worker SMS | R `users`; W `sms_logs`; Twilio | implicit job create; yes | A; bounded to 250 users and exact borough/category strings |
| `sendJobStatusSmsUpdates` | Firestore update | status transition → participant SMS | R `users`; W `sms_logs`; Twilio | implicit status writes; yes | A |

## Admin data and activity (20)

All seven callables use `verifyAdmin`, which requires Firebase authentication and an active `adminUsers/{uid}` record. They are consumed by `apps/Web/oddjobs-admin` or duplicate capabilities exposed through that app's server routes.

| Functions | Type; data | Reuse |
|---|---|---|
| `getUsers`, `getJobs`, `getPayments`, `getWithdrawals`, `searchUsers`, `getAdminActivity`, `getAdminAlerts` | Callable; R `adminUsers` plus the named collection; `searchUsers` scans up to 250 documents | B (7); keep admin-only and add per-role least privilege/pagination |
| `onUserCreatedAdminActivity`, `onJobPostedAdminActivity`, `onJobRequestAdminActivity`, `onPaymentCreatedAdminActivity`, `onWithdrawalCreatedAdminActivity`, `onAddressUpdateRequestAdminActivity`, `onVerificationIdRequestAdminActivity` | Firestore create; W `adminActivity` and sometimes `adminAlerts` | A (7) |
| `onPaymentUpdatedAdminActivity`, `onWithdrawalUpdatedAdminActivity`, `onJobPostUpdatedAdminActivity`, `onAddressUpdateRequestUpdatedAdminActivity`, `onVerificationIdRequestUpdatedAdminActivity` | Firestore update; W `adminActivity`/`adminAlerts` | A (5) |
| `onAdminAlertCreatedDiscord` | Firestore create; sends selected Discord webhook | A (1); secrets remain server-only |

Admin paths include `users`, `jobPost`, `jobRequests`, `payments`, `withdraws`, `updateAddress_requests`, `updateVerificationID_requests`, `adminActivity`, `adminAlerts`, and `adminUsers`.

## Cross-cutting gaps

- No backend command exists for canonical job creation, application creation, request acceptance/rejection, job start, completion, review eligibility, promo redemption, account deletion, messaging, or comment creation.
- No Stripe webhook exists.
- No Realtime Database capability was found.
- Function input schemas are ad hoc objects with limited runtime validation and no shared versioned contract.
- Region and HTTP URLs are hard-coded in iOS in several places.
