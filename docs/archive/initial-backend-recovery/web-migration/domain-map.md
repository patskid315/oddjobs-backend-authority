# Business domain map

## Domain inventory

| Domain | iOS models / controllers | Data and backend | Key rules / gaps |
|---|---|---|---|
| Authentication | `AuthService`, `LoginViewModel`, `SignUpViewModel`, `SessionRouter` | Firebase Auth; `users/{uid}`; Auth create trigger | Email/password; soft-delete gate is client-side |
| Users / Profiles | `User`, profile/edit/preferences ViewModels | `users`, profile Storage paths | Self-service fields and status boundaries depend on rules |
| Workers | `ProfileSetupViewModel`, `MainViewViewModel`, worker toolkit | `users`, `meta/workerStats*`, Stripe Connect | Active cap 100; client passes role/status inputs |
| Posters | `ProfileSetupViewModel`, job/referral ViewModels | `users`, jobs, referrals | Poster represented by mutable string field |
| Jobs | `JobModel`, `JobPost`, `JobPostViewModel`, `JobPostService` | `jobPost`, `jobPostImages`, analytics/drafts | iOS computes price and writes canonical job directly |
| Job discovery | fetch/main/category/detail ViewModels | queries `jobPost`, `users`, `payments` | visibility and eligibility are query/client driven |
| Job posting | standard/research posting flows | `jobPost`, `payments`, drafts, photos | requires a server command before web |
| Applications / requests | `JobRequest`, `JobRequestViewModel`, service | `jobRequests`, job/slot/payment writes | accept/reject/assignment are client transactions |
| Active jobs | `ActiveJobViewModel`, `JobDetailViewModel` | job/request/slot status | client writes `inProgress` and assignment state |
| Completion | completion/review ViewModels | job/slot, payment, reviews, notifications | client initiates final states that trigger transfers |
| Messaging | `Conversation`, `Message`, messaging ViewModels | `conversations/{pair}/messages` | deterministic pair id; no server command |
| Comments / mentions | `JobComment`, `CommentsViewModel` | job comment/commenter subcollections, notifications | client and trigger both appear to emit notifications |
| Notifications | notification model/ViewModels, AppDelegate | `notifications`, `users.fcmToken`; FCM/APNs | token is single-valued; preferences not checked by push trigger |
| Payments | `StripeService`, posting/completion/payment ViewModels | Stripe Functions, `payments`, `stripe_customers`, `balance` | client controls charge and payout inputs |
| Stripe Connect / payouts | `StripeService`, payment info/profile | Express accounts; transfer triggers/scheduler | no webhooks, weak auth on endpoints, retry idempotency risk |
| Reviews | `Review`, review ViewModels | `reviews/{worker}/userReviews` | client writes review/completion; eligibility is not server-owned |
| Referrals | referral models/service/ViewModel | `jobConnections`, `referrals`, notifications/Gmail | server poster/connection checks are reusable |
| Research jobs | research draft/post/slot models and ViewModels | `jobPost` plus `slots`, research payment records | separate per-participant cents math; client assigns/completes slots |
| Address / location | address/posting ViewModels, `NeighborhoodLocator` | user/job nested addresses; NYC claim function | geocoding/neighborhood authority is iOS-only |
| Verification | verification ViewModels/gate | verification Storage and user meta, update queue | applicant can write status document; admin decision contract unclear |
| Admin | Next.js admin repositories/routes; activity Functions | `adminUsers`, operational collections, `adminActivity`, `adminAlerts` | separate repo; least-privilege matrix requires review |

## Core domain transitions observed

```text
User: created → active | queued | restricted
Onboarding: setupAccount → profileSetup → interestSelection → addressInput
            → verifyIdentity → completed
Standard job: active → assigned → inProgress → completed
Request: pending → assigned | rejected → inProgress/completed fields
Research slot: open → accepted → inProgress → completed | canceled
Payment/payout: active/pending → completed + pending → paid
                or not_applicable for zero/promo jobs
Verification: none → pending → verified | rejected
```

The transition labels above are facts observed across code, but the legal transition graph is not centrally defined and variants such as `inprogress`, `in_progress`, `in-progress`, `canceled`, and `cancelled` are normalized only in some models.

## External integrations by domain

- Firebase Auth: authentication/session.
- Firestore: all marketplace and admin domains.
- Firebase Storage: profiles, IDs, jobs and drafts.
- Stripe/Stripe Connect: cards, charges, worker accounts and transfers.
- FCM/APNs: mobile push.
- Twilio: onboarding/job SMS.
- Gmail API/nodemailer and Django SMTP: referrals, disabled alerts, contact/referral email.
- Discord webhooks: admin alerts.
- Core Location/MapKit: iOS address validation and job maps.
- Universal links: Django AASA and `/j/{jobId}/` share URL.

## Missing domain owners

There is no canonical server/domain owner for job commands, request commands, status transitions, pricing/promo redemption, completion, review eligibility, verification decisions, conversation access, or comment creation. Those are the first shared capabilities to define; duplicating Swift logic in React would preserve the current risk and create divergent behavior.
