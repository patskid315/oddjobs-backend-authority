# Function export parity

## Summary

| Set | Count | Composition |
|---|---:|---|
| Most complete local source | 48 | 25 tracked marketplace functions + 20 untracked admin functions + 3 untracked SMS functions |
| Git-tracked source | 25 | Payments, onboarding, referrals, comments/push, job alerts, connections |
| Deployed production | 45 | All 25 tracked names + all 20 untracked admin names; no SMS exports |

There are no deployed-only names relative to the 48-export source. Name parity does not prove byte parity or a Git revision. “Provenance gap” below means the name and a local implementation exist, but no deploy record binds production to that file/commit.

## Complete 48-function matrix

| Function | Complete source | Tracked source | Deployed evidence | Source mismatch | Risk | Recommended action |
|---|---|---|---|---|---|---|
| `createStripeCustomerOnSignup` | Yes | Yes | Active, Node 20, us-central1 | Provenance gap | High | Recover deploy manifest; test idempotent Auth provisioning |
| `createConnectedAccount` | Yes | Yes | Active | Provenance gap | High | Bind caller UID; contract and Stripe test |
| `getStripeBalance` | Yes | Yes | Active | Provenance gap | High | Prove account ownership and response projection |
| `createEphemeralKey` | Yes | Yes | Active | Provenance gap | Critical | Derive customer from caller; reject arbitrary IDs |
| `listPaymentMethods` | Yes | Yes | Active HTTP | Provenance gap | Critical | Authenticate HTTP request and scope customer |
| `createSetupIntent` | Yes | Yes | Active | Provenance gap | Critical | Derive customer from caller; add replay tests |
| `detachPaymentMethod` | Yes | Yes | Active | Provenance gap | Critical | Verify payment-method ownership; reconcile callable/HTTP client mismatch |
| `createPaymentIntent` | Yes | Yes | Active | Provenance gap | Critical | Derive amount, currency, customer, and metadata server-side |
| `createAccountLink` | Yes | Yes | Active HTTP | Provenance gap | Critical | Authenticate; derive Connect account; restrict redirects |
| `createDashboardLink` | Yes | Yes | Active HTTP | Provenance gap | Critical | Authenticate; derive Connect account |
| `releasePaymentOnCompletion` | Yes | Yes | Active Firestore trigger | Provenance gap | Critical | Freeze existing behavior; add settlement ledger/idempotency |
| `releaseResearchPaymentOnSlotCompletion` | Yes | Yes | Active Firestore trigger | Provenance gap | Critical | Freeze slot settlement; add idempotency/reconciliation |
| `retryPendingPayouts` | Yes | Yes | Active scheduled | Provenance gap | Critical | Define retry ownership, dedupe, terminal states, alerts |
| `getDefaultPaymentMethod` | Yes | Yes | Active | Provenance gap | High | Scope customer to caller; minimize card metadata |
| `decideWaitlistOnProfileSetup` | Yes | Yes | Active | Provenance gap | High | Make account state server-owned; freeze claim transitions |
| `updateWorkerStatsOnStatusChange` | Yes | Yes | Active | Provenance gap | High | Stop trusting caller-supplied status; test authorization |
| `updateWorkerStatsOnSignup` | Yes | Yes | Active | Provenance gap | High | Make role/stat mutations idempotent and server-derived |
| `finalizeNYCOnboarding` | Yes | Yes | Active | Provenance gap | High | Validate normalized address, not submitted borough alone |
| `fetchEligibleWorkers` | Yes | Yes | Active | Provenance gap | Medium | Preserve authenticated Poster/connection checks in contract tests |
| `sendReferral` | Yes | Yes | Active; distinct hash and secret binding | Provenance gap | High | Add rate/abuse tests and template-only content |
| `sendReferralEmail` | Yes | Yes | Active; distinct hash and secret binding | Provenance gap | High | Decide whether to retain; otherwise deprecate safely |
| `onJobCompleted_createConnection` | Yes | Yes | Active Firestore trigger | Provenance gap | Medium | Freeze idempotent connection creation and legacy path aliases |
| `observeJobComments` | Yes | Yes | Active Firestore trigger | Provenance gap | High | Remove duplicate/spoofable notification paths after freeze |
| `observeFirestoreNotifications` | Yes | Yes | Active Firestore trigger | Provenance gap | High | Test recipient, preference, token, and channel rules |
| `observeJobPosts` | Yes | Yes | Active Firestore trigger | Provenance gap | Medium | Move notification credentials; define recipients and retention |
| `onUserCreatedAdminActivity` | Yes | No | Active Firestore trigger | **Deployed source absent from Git** | High | Recover reviewed source and event schema |
| `onJobPostedAdminActivity` | Yes | No | Active Firestore trigger | **Deployed source absent from Git** | High | Recover reviewed source and event schema |
| `onJobRequestAdminActivity` | Yes | No | Active Firestore trigger | **Deployed source absent from Git** | High | Recover reviewed source and event schema |
| `onPaymentCreatedAdminActivity` | Yes | No | Active Firestore trigger | **Deployed source absent from Git** | Critical | Recover source; ensure sensitive values are redacted |
| `onWithdrawalCreatedAdminActivity` | Yes | No | Active Firestore trigger | **Deployed source absent from Git** | Critical | Recover source; validate financial audit handling |
| `onAddressUpdateRequestAdminActivity` | Yes | No | Active Firestore trigger | **Deployed source absent from Git** | High | Recover source; minimize address data in logs |
| `onVerificationIdRequestAdminActivity` | Yes | No | Active Firestore trigger | **Deployed source absent from Git** | Critical | Recover source; prevent identity-document leakage |
| `onPaymentUpdatedAdminActivity` | Yes | No | Active Firestore trigger | **Deployed source absent from Git** | Critical | Recover source; freeze transition/audit semantics |
| `onWithdrawalUpdatedAdminActivity` | Yes | No | Active Firestore trigger | **Deployed source absent from Git** | Critical | Recover source; freeze transition/audit semantics |
| `onJobPostUpdatedAdminActivity` | Yes | No | Active Firestore trigger | **Deployed source absent from Git** | High | Recover source; bound event volume |
| `onAddressUpdateRequestUpdatedAdminActivity` | Yes | No | Active Firestore trigger | **Deployed source absent from Git** | High | Recover source; validate reviewer identity |
| `onVerificationIdRequestUpdatedAdminActivity` | Yes | No | Active Firestore trigger | **Deployed source absent from Git** | Critical | Recover source; validate reviewer identity and redaction |
| `getUsers` | Yes | No | Active callable | **Deployed source absent from Git** | Critical | Recover source; test admin status/role and field projection |
| `getJobs` | Yes | No | Active callable | **Deployed source absent from Git** | High | Recover source; test admin authorization and pagination |
| `getPayments` | Yes | No | Active callable | **Deployed source absent from Git** | Critical | Recover source; restrict financial fields |
| `getWithdrawals` | Yes | No | Active callable | **Deployed source absent from Git** | Critical | Recover source; restrict financial fields |
| `searchUsers` | Yes | No | Active callable | **Deployed source absent from Git** | Critical | Recover source; add least-privilege projection and audit |
| `getAdminActivity` | Yes | No | Active callable | **Deployed source absent from Git** | High | Recover source; reconcile admin activation schema |
| `getAdminAlerts` | Yes | No | Active callable | **Deployed source absent from Git** | High | Recover source; reconcile admin activation schema |
| `onAdminAlertCreatedDiscord` | Yes | No | Active Firestore trigger | **Deployed source absent from Git** | High | Recover source; rotate/configure webhooks in managed secrets |
| `sendIncompleteOnboardingSmsReminders` | Yes | No | **Not deployed** | **Untracked source-only** | High | Keep quarantined pending consent/product review; do not deploy accidentally |
| `sendNewJobSmsMatches` | Yes | No | **Not deployed** | **Untracked source-only** | High | Keep quarantined pending matching/consent/rate review |
| `sendJobStatusSmsUpdates` | Yes | No | **Not deployed** | **Untracked source-only** | High | Keep quarantined pending consent/recipient/state review |

## Deployment shape

The live trigger mix is 21 callable functions, 3 HTTP functions, 19 Firestore triggers, 1 Auth-create trigger, and 1 scheduled function. The three absent SMS exports would add two Firestore triggers and one scheduled function, producing the previously audited 48-function shape.

## Reconciliation rule

Do not bulk-deploy the 48-export tree. First capture packaged-source evidence from production if available, review/import the 20 admin implementations, explicitly classify the three SMS implementations as disabled/quarantined, and make a no-change deployment plan that compares expected deletions/creations before approval.
