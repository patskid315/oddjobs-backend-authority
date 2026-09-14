# Production authority matrix

Evidence date: 2026-09-13  
Production inventory: 45 active Gen 1 functions, `us-central1`, Node.js 20  
Recovered source archive SHA-256: `b20af904df4ba6c861711ca1e297f14b106ee75e3cfe06aac553f4a439f8175c`

The byte-identical recovered first-party source is now stored under `production-baseline/functions/`. Runtime configuration, logs, downloaded archives, and bundled dependencies were deliberately excluded. Every module below matches the recovered deployment evidence byte-for-byte. This recovered baseline is authority evidence, not historical Git provenance.

| Function | Baseline module | Baseline status | Emergency candidate difference |
|---|---|---|---|
| createAccountLink | payments.js | Exact recovered source | None; excluded from deployment |
| createConnectedAccount | payments.js | Exact recovered source | None; excluded from deployment |
| createDashboardLink | payments.js | Exact recovered source | None; excluded from deployment |
| createEphemeralKey | payments.js | Exact recovered source | None; excluded from deployment |
| createPaymentIntent | payments.js | Exact recovered source | None; excluded from deployment |
| createSetupIntent | payments.js | Exact recovered source | None; excluded from deployment |
| createStripeCustomerOnSignup | payments.js | Exact recovered source | None; excluded from deployment |
| decideWaitlistOnProfileSetup | userRegistration.js | Exact recovered source | None; excluded from deployment |
| detachPaymentMethod | payments.js | Exact recovered source | None; excluded from deployment |
| fetchEligibleWorkers | referrals.js | Exact recovered source | None; excluded from deployment |
| finalizeNYCOnboarding | userRegistration.js | Exact recovered source | None; excluded from deployment |
| getAdminActivity | adminData.js | Exact recovered source | None; excluded from deployment |
| getAdminAlerts | adminData.js | Exact recovered source | None; excluded from deployment |
| getDefaultPaymentMethod | payments.js | Exact recovered source | None; excluded from deployment |
| getJobs | adminData.js | Exact recovered source | None; excluded from deployment |
| getPayments | adminData.js | Exact recovered source | None; excluded from deployment |
| getStripeBalance | payments.js | Exact recovered source | None; excluded from deployment |
| getUsers | adminData.js | Exact recovered source | None; excluded from deployment |
| getWithdrawals | adminData.js | Exact recovered source | None; excluded from deployment |
| listPaymentMethods | payments.js | Exact recovered source | None; excluded from deployment |
| observeFirestoreNotifications | notifications.js | Exact recovered source | None; excluded from deployment |
| observeJobComments | notifications.js | Exact recovered source | None; excluded from deployment |
| observeJobPosts | jobAlerts.js | Exact recovered source | None; excluded from deployment |
| onAddressUpdateRequestAdminActivity | adminActivity.js | Exact recovered source | None; excluded from deployment |
| onAddressUpdateRequestUpdatedAdminActivity | adminActivity.js | Exact recovered source | None; excluded from deployment |
| onAdminAlertCreatedDiscord | adminDiscordNotifications.js | Exact recovered source | None; excluded from deployment |
| onJobCompleted_createConnection | connections.js | Exact recovered source | None; excluded from deployment |
| onJobPostUpdatedAdminActivity | adminActivity.js | Exact recovered source | None; excluded from deployment |
| onJobPostedAdminActivity | adminActivity.js | Exact recovered source | None; excluded from deployment |
| onJobRequestAdminActivity | adminActivity.js | Exact recovered source | None; excluded from deployment |
| onPaymentCreatedAdminActivity | adminActivity.js | Exact recovered source | None; excluded from deployment |
| onPaymentUpdatedAdminActivity | adminActivity.js | Exact recovered source | None; excluded from deployment |
| onUserCreatedAdminActivity | adminActivity.js | Exact recovered source | None; excluded from deployment |
| onVerificationIdRequestAdminActivity | adminActivity.js | Exact recovered source | None; excluded from deployment |
| onVerificationIdRequestUpdatedAdminActivity | adminActivity.js | Exact recovered source | None; excluded from deployment |
| onWithdrawalCreatedAdminActivity | adminActivity.js | Exact recovered source | None; excluded from deployment |
| onWithdrawalUpdatedAdminActivity | adminActivity.js | Exact recovered source | None; excluded from deployment |
| releasePaymentOnCompletion | payments.js | Exact recovered source; digest `2cf777bd04bc96f1e0cae58cb0d504a8a4b10aee1011bf8dbaa242c409c9e908` | Replaced locally by completion-to-pending; only intended deployment target |
| releaseResearchPaymentOnSlotCompletion | payments.js | Exact recovered source | None; excluded from deployment |
| retryPendingPayouts | payments.js | Exact recovered source | None; excluded from deployment |
| searchUsers | adminData.js | Exact recovered source | None; excluded from deployment |
| sendReferral | referrals.js | Exact recovered source | None; excluded from deployment |
| sendReferralEmail | referrals.js | Exact recovered source | None; excluded from deployment |
| updateWorkerStatsOnSignup | userRegistration.js | Exact recovered source | None; excluded from deployment |
| updateWorkerStatsOnStatusChange | userRegistration.js | Exact recovered source | None; excluded from deployment |

The baseline entry module and dependency manifests are also preserved byte-for-byte. The candidate entry module intentionally exports only the one emergency deployment target, preventing unrelated functions from being included in the scoped deployment command. Inventory drift is checked against `production-baseline/function-inventory.json`.
