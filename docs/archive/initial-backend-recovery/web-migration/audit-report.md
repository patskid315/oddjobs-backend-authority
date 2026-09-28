# Complete production web migration audit

## 1. Audit conclusion

OddJobs has a functioning iOS marketplace and a meaningful set of reusable Firebase capabilities, but it does not yet have a platform-neutral application layer. The current system is best described as a Firebase client application with selected server triggers and callables—not as an API-backed product whose rules are uniformly enforced on the server.

The consumer web application should not begin with a broad UI port. The safest path is to establish one authoritative backend, recover and test deployed Firebase policy, then migrate security-sensitive behaviors into shared server commands one vertical slice at a time. Read-only web browsing can begin earlier only after rules and privacy behavior are proven.

### Readiness decision

| Area | Status | Reason |
|---|---|---|
| Repository authority | Blocked | The most complete backend is not in a verifiable Git worktree and differs from the tracked snapshot |
| Read-only marketplace web | Conditionally ready | Requires deployed rules/index review and approved public/private field projections |
| Authentication | Needs hardening | Firebase Auth is reusable, but account/role/status policy is partly client-driven |
| Job creation and requests | Blocked | Authoritative validation and transitions live in Swift/direct Firestore writes |
| Payments and payouts | Blocked | Unscoped endpoints, client amounts, no webhooks, and transfer idempotency risk |
| Messaging/comments | Blocked pending rules | Direct writes require participant/author policy and abuse controls |
| Notifications | Partially reusable | Event records/triggers are useful; delivery is mobile-centric and has duplicate producers |
| Admin tooling | Existing but separate | Real Next.js admin app exists; its privileged code is not a consumer-web base |
| Design system | Reusable input | Existing assets/tokens can seed web presentation after source ownership is approved |

## 2. Evidence and limitations

### Audited sources

- Clean iOS worktree: `recovery/ios-design-system-work` at `745ec8208ea5ad6ac221308ca78ef720c63b86cd`.
- More complete sibling backend: `/Users/zachwilcox/Desktop/Projects/OddJobsNewYorkProduct/backend`.
- Separate Next.js admin repository at `cc0ad84b4631857201d1b1754eded531a4dfcd03`.
- Legacy Django site under `apps/Web/oddjob-web`.
- Shared design assets, token JSON, category JSON and tooling directories.

### Not available

- Proof of the source commit currently deployed to Firebase.
- Deployed Firestore rules, Storage rules, composite indexes or App Check policy.
- Live data samples, production logs, function metrics or Stripe Dashboard configuration.
- Product-approved role, fee, status-transition, retention and verification policies.

Any conclusion involving these items is marked unverified or requires product/security review. No live system was queried or changed.

## 3. Current architecture

```text
iOS SwiftUI
├── Views and components ───────────────┐
├── ViewModels ─────────────────────────┼→ Firebase client SDK
└── Services ───────────────────────────┘  ├→ Auth
                                           ├→ Firestore
                                           ├→ Storage
                                           └→ Functions

Firebase Functions
├── callable/HTTP account operations
├── Firestore event processing
├── scheduled SMS/payout retry
└── integrations: Stripe, FCM, Twilio, Gmail, Discord

Separate web systems
├── Next.js admin → Firebase client/Admin SDK and callables
└── Django marketing → templates, AASA, contact/referral email
```

There are no consistent repositories between presentation and Firebase. Services exist for Auth, Storage, jobs, requests, users, referrals and Stripe, but many ViewModels and Views bypass them. The web application must not reproduce that coupling.

## 4. Backend inventory

The most complete source exports 48 Functions:

| Type | Count | Primary domains |
|---|---:|---|
| Callable | 21 | Stripe, onboarding, referrals, admin reads |
| HTTP | 3 | Stripe payment methods and Connect links |
| Firestore trigger | 21 | payments, notifications, connections, admin, SMS |
| Auth trigger | 1 | Stripe Customer provisioning |
| Scheduled | 2 | payout retry and onboarding SMS |

### Source-level export register

| Source | Exports |
|---|---|
| `backend/functions/payments.js:85–755` | `createStripeCustomerOnSignup`, `createConnectedAccount`, `getStripeBalance`, `createEphemeralKey`, `listPaymentMethods`, `createSetupIntent`, `detachPaymentMethod`, `createPaymentIntent`, `createAccountLink`, `createDashboardLink`, `releasePaymentOnCompletion`, `releaseResearchPaymentOnSlotCompletion`, `retryPendingPayouts`, `getDefaultPaymentMethod` |
| `backend/functions/userRegistration.js:82–184` | `decideWaitlistOnProfileSetup`, `updateWorkerStatsOnStatusChange`, `updateWorkerStatsOnSignup`, `finalizeNYCOnboarding` |
| `backend/functions/referrals.js:189–526` | `fetchEligibleWorkers`, `sendReferral`, `sendReferralEmail` |
| `backend/functions/connections.js:61–96` | `onJobCompleted_createConnection` |
| `backend/functions/notifications.js:5–135` | `observeJobComments`, `observeFirestoreNotifications` |
| `backend/functions/jobAlerts.js:16–79` | `observeJobPosts` |
| `backend/functions/smsNotifications.js:189–320` | `sendIncompleteOnboardingSmsReminders`, `sendNewJobSmsMatches`, `sendJobStatusSmsUpdates` |
| `backend/functions/adminActivity.js:96–658` | 12 create/update audit triggers for users, jobs, requests, payments, withdrawals, address requests and verification requests |
| `backend/functions/adminData.js:88–265` | `getUsers`, `getJobs`, `getPayments`, `getWithdrawals`, `searchUsers`, `getAdminActivity`, `getAdminAlerts` |
| `backend/functions/adminDiscordNotifications.js:49–213` | `onAdminAlertCreatedDiscord` |

Inputs, outputs, paths, callers and reuse dispositions for every export are in [Backend capabilities](backend-capabilities.md).

## 5. Data stores

### Firestore

The core aggregate paths are:

```text
users/{uid}
├── meta/verification
jobPost/{jobId}
├── slots/{slotId}
├── comments/{commentId}
└── commenters/{uid}
jobRequests/{requestId}
conversations/{sortedUidPair}/messages/{messageId}
notifications/{id}
reviews/{workerId}/userReviews/{reviewId}
payments/{id}
stripe_customers/{uid}
balance/{uid}
payout_pending_jobs/{id}
withdraws/{id}
promoCodes/{code}
jobConnections/{poster_worker}
referrals/{id}
meta/workerStats
adminUsers/{uid}
adminActivity/{id}
adminAlerts/{id}
sms_logs/{dedupeKey}
```

There are also draft, analytics and update-request collections. Legacy names such as `workers`, `completedJobs`, `jobsInProgress`, and older comment/message paths appear in iOS and require usage confirmation.

### Storage

Observed paths include profile images, identity evidence, published job images and standard/research draft images. Exact rules are unavailable. Verification images must not be treated as ordinary public assets.

### Realtime Database

No application usage or trigger was found.

## 6. Authentication and authorization

### Authentication fact pattern

- Email/password signup and login through Firebase Auth.
- Firebase password-reset email.
- Auth state listener controls routing.
- A Firestore profile drives onboarding and account-state routing.
- Auth creation provisions a Stripe Customer.
- No social, phone, magic-link or MFA flow was confirmed.

### Authorization fact pattern

- Worker/Poster mode is primarily the mutable `lookingFor` string.
- NYC onboarding adds region/onboarding/waitlist custom claims, not role or verification claims.
- Referrals enforce authentication, Poster mode and prior connection server-side.
- Admin reads require an `adminUsers` record, but active/status schema differs between Functions and the Next.js admin.
- Most marketplace ownership and transition checks are direct-client/rules dependent.

### Client-enforced items requiring migration

Role selection, account status, onboarding progression, geographic eligibility, identity submission status, job pricing, request assignment, completion, reviews, payment values and several notification decisions are writable or decided by the client.

## 7. Domain findings

| Domain | Current authoritative behavior | Web migration requirement |
|---|---|---|
| Authentication | Firebase Auth plus user document | Reuse Auth; centralize account-state authorization |
| Profiles | Direct client reads/writes and Storage | Separate safe self-edit fields from server-owned state |
| Worker/Poster | Mutable strings and client mode | Canonical enum and server transition |
| Jobs | iOS computes and writes job | Server quote/create/update commands |
| Requests | iOS creates and transitions requests | Server create/accept/reject commands |
| Active/completion | iOS changes job/request/slot state | Server state machine and idempotency |
| Research | Parallel iOS pricing/slot logic | Shared research commands and approved fee policy |
| Messaging | Direct conversation/message writes | Participant rules and typed repository/command |
| Comments | Direct batch plus two notification paths | Canonical writer and one event producer |
| Notifications | Firestore records + mobile push | Channel-neutral event and device/channel registry |
| Payments | iOS quote/payment record + Functions | Server pricing, scoped Stripe API and webhooks |
| Reviews | Client determines eligibility/write | Server completion-derived eligibility |
| Referrals | Server callables enforce useful rules | Typed web adapter and abuse controls |
| Location | iOS geocoder/neighborhood data | Server-derived normalized eligibility |
| Verification | Applicant writes source-of-truth-like state | Separate submission from trusted decision |
| Admin | Separate privileged Next.js app | Preserve boundary; reconcile authorization schema |

The detailed model/view/controller/service/path mapping is in [Domain map](domain-map.md) and [iOS dependencies](ios-backend-dependencies.md).

## 8. Shared business rules

### Verified implementation values

- Standard Poster fee is 10% of base.
- Standard Worker receives 95% of base.
- Standard gross platform amount is therefore 15% before processing costs when no promo applies.
- Research adds 10% to the Poster but stores Worker payout equal to participant pay.
- Worker capacity uses a hard-coded maximum of 100 active Workers.
- NYC eligibility accepts Manhattan, Brooklyn, Queens, Bronx and Staten Island at the server borough-string layer.
- Standard jobs use `active → assigned → inProgress → completed` in the principal path.
- Research slots use `open → accepted → inProgress → completed`, with cancellation variants.
- Full, percent and fixed promos exist; zero/full-promo flows can skip Stripe payout.

These values describe source behavior. Fee differences, worker capacity and allowed transitions require explicit product approval before becoming shared contracts.

## 9. Stripe assessment

### Reusable foundation

Stripe Customers, Express Connect accounts, SetupIntents, PaymentIntents, PaymentSheet and Transfers are already present. Authenticated connected-account creation and balance lookup can be retained with typed adapters.

### Production blockers

- Eight customer/account/payment-method endpoints are unauthenticated or not owner-scoped.
- PaymentIntent amount/currency/customer are supplied by the client.
- Client-created payment documents provide `recipientId` and `workerCut` to payout triggers.
- Transfer calls lack deterministic idempotency keys.
- The retry scheduler cannot distinguish every uncertain partial transfer outcome.
- There is no webhook/event ledger for Stripe-authoritative state.
- iOS mixes callable and raw HTTP invocation conventions.

The target is a server quote, authenticated job/payment command, verified webhook ledger and idempotent settlement state machine. Client SDKs only collect/confirm payment details and render state.

## 10. Security findings

### Blockers before public transactional web

1. Recover and test deployed Firestore/Storage policy.
2. Scope every Stripe operation to verified identity.
3. Stop accepting client-authoritative charge and payout values.
4. Move roles, critical status changes and verification decisions behind server policy.
5. Implement Stripe webhooks and transfer idempotency.
6. Rotate committed Django/SMTP credentials and remove them from history.
7. Establish one canonical, version-controlled backend source.

### Important during implementation

- Runtime schemas and bounded inputs for all commands.
- Rate/abuse controls for auth, contact, referrals, messages, comments and notifications.
- CSRF/session/revocation strategy for browser sessions.
- Device/channel notification model and consent enforcement.
- Privacy/retention policy for identity, address, message, phone and device-token data.
- App Check decision and tests.
- Least-privilege admin role matrix.

## 11. Reuse decision

| Classification | Count |
|---|---:|
| Reuse as-is | 19 |
| Reuse with client adapter | 12 |
| Refactor before web | 1 |
| iOS-specific | 0 |
| Legacy / possibly unused | 3 |
| Security review required | 13 |

The 31 A/B capabilities are mostly event processing, admin reads, referrals and authenticated account operations. This does not cover the missing server commands needed for core marketplace mutations.

## 12. Recommended web architecture

```text
React component
→ feature controller / ViewModel-style hook
→ domain use case
→ repository interface
→ Firebase read adapter or authenticated command client
→ shared backend capability
```

Use Next.js and TypeScript unless a later repository decision establishes another consumer stack. Keep Firebase Admin code server-only. Share runtime schemas, domain IDs/enums, use-case contracts, categories/tools, pricing policy versions and deterministic test fixtures. Keep rendering, navigation, map provider, push registration and Stripe presentation platform-specific.

## 13. Implementation sequence

1. Canonical backend and deployed parity.
2. Versioned Firebase rules/indexes and emulator tests.
3. Consumer shell, design tokens, environment and telemetry baseline.
4. Read-only job browse/detail.
5. Auth/session/account-state policy.
6. Profile, NYC location and verification trust boundary.
7. Stripe endpoint hardening, quotes, webhooks and idempotency.
8. Standard/research job creation.
9. Requests, assignment and slot allocation.
10. Active work, completion, reviews and payouts.
11. Messaging, comments, notification channels and preferences.
12. Referrals, history, secondary profile and marketing integration.

Each phase should migrate the corresponding iOS caller to the same command before considering the capability fully shared.

## 14. Decision and unknown register

| Decision / unknown | Owner needed | Why it matters |
|---|---|---|
| Which backend commit is deployed? | Backend/operations | All implementation and security work depends on it |
| What are deployed Firestore/Storage rules? | Backend/security | Determines whether current direct writes are safe |
| Can a user switch Worker/Poster modes? | Product/security | Defines claims, profile model and authorization |
| What are the approved standard/research fees? | Product/finance/legal | Current implementations differ |
| What constitutes a valid job/request transition? | Product/operations | Required server state machine |
| Is verification optional, and who can approve it? | Product/legal/operations | Defines access and sensitive-data policy |
| Which job fields may be public? | Product/privacy | Required for browse/share/SEO |
| Does Django remain production marketing infrastructure? | Web/operations | Affects universal links, email and secret rotation |
| Which notifications support web push/SMS/email? | Product/communications | Defines consent and delivery model |
| Are legacy collections still live? | Backend/data | Prevents adopting obsolete schemas |

## 15. Validation and change boundary

- Documentation files are the only changed/untracked paths in the clean recovery worktree.
- No Swift, Function, Firebase, Stripe, Xcode, web application, dependency or configuration file changed.
- No deployment, build, synchronization, dependency installation or live data access occurred.
- Markdown whitespace and internal-link checks pass.

## 16. Next checkpoint

Convene a backend-authority and security-contract review. The meeting should end with:

1. An approved canonical backend repository and deployed source reference.
2. A reviewed export of rules/indexes and a rules-test plan.
3. Approved role/account/verification and standard/research fee policies.
4. Approved command boundaries for job, request, completion and payment workflows.
5. A Gate 0 implementation plan with owners, tests and rollback requirements.

Do not start transactional consumer-web implementation until those outputs are approved.
