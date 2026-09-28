# Firebase data model

This is a code-derived path inventory, not a live database export. Fields are listed only when reads/writes corroborate them. Security-rule behavior is **unverified** because no rule files were found.

## Firestore paths

| Path | Purpose / major observed fields | Writers | Readers / associated functions |
|---|---|---|---|
| `users/{uid}` | profile, email/name/phone, `lookingFor`, interests/tools, profile image, address, borough, `accountStatus`, `onboardingStep`, queue, SMS prefs/token | iOS signup/profile/address/preferences/deletion; onboarding function | most iOS domains; onboarding, referrals, notifications, SMS, admin |
| `users/{uid}/meta/verification` | status, deferred flag, ID type and front/back URLs | iOS verification and profile update code | iOS posting/request verification gate; no server reviewer transition found |
| `jobPost/{jobId}` | standard/research job, poster `userId`, title/description/category/photos, pricing, address/location, schedule, progress, assigned worker, research counts | iOS `JobPostService`/ViewModels | feed/detail/history, triggers for alerts/SMS/admin/payout/connection |
| `jobPost/{jobId}/slots/{slotId}` | research slot index/status, accepted worker, timestamps, escrow | iOS `SlotService` and request/completion ViewModels | research UI; research payout trigger |
| `jobPost/{jobId}/comments/{commentId}` | clientId, author identity, body, mentions, createdAt | iOS `CommentsViewModel` | iOS listener; comment notification trigger |
| `jobPost/{jobId}/commenters/{uid}` | commenter name/avatar/lastCommentAt | iOS comment batch | iOS mention candidate listener |
| `jobRequests/{requestId}` | sender, receiver, job, message, status, slot, assignment/rejection/start/completion timestamps | iOS request/completion ViewModels | iOS request UI; admin triggers/admin web |
| `conversations/{sortedUidPair}` | participants, last message/update, unread flag | iOS `MessagesViewModel` | iOS conversations listener; admin web |
| `conversations/{id}/messages/{messageId}` | sender, receiver, text, timestamp | iOS `MessagesViewModel` | iOS chat listener |
| `notifications/{id}` | sender/receiver, job/slot/comment, message, type, read, timestamp | iOS notification service, comment code, referral and payout functions | iOS notification listeners; FCM trigger |
| `reviews/{workerId}/userReviews/{reviewId}` | job, worker/poster, ratings, text, reviewer, category, timestamp | iOS review ViewModels | iOS review/profile; admin web |
| `payments/{id}` | job/slot, sender/recipient, base, poster fee, charged total, worker cut, platform profit, promo, Stripe/payment/payout state | iOS posting/request/completion code; payout functions | iOS payments/detail/completion; payouts/admin |
| `stripe_customers/{uid}` | Stripe customer id, connected account id and cached account status | Auth/Stripe Functions | iOS `StripeService`; payout functions |
| `balance/{uid}` | available/pending/earned aggregates | payout functions and iOS reads/writes | iOS `PaymentsViewModel`; admin web |
| `payout_pending_jobs/{id}` | failed payout retry data/status | payout triggers/scheduler | scheduler, iOS/admin views |
| `withdraws/{id}` | withdrawal amount/status/user metadata | iOS payments flow (exact creation path needs product review) | iOS payments, admin functions/web |
| `promoCodes/{CODE}` | active flag, type, value, description | `PromoSeeder`/admin web | iOS directly calculates discount |
| `jobConnections/{poster_worker}` | poster/worker, job ID map, last job/completion | completion trigger | referral functions |
| `referrals/{deterministicId}` | job, type, sender/poster/worker or invite, note, status | referral function | admin web |
| `meta/workerStats` | active/queued worker counters | worker stats callables | waitlist callable |
| `meta/workerStatsUsers/users/{uid}` | last counted worker status | worker stats callables | worker stats callables |
| `job_post_drafts/{id}` / `research_post_drafts/{id}` | resumable draft fields and photo paths | iOS draft ViewModels | iOS draft restore; admin web reads job drafts |
| `job_post_events/{id}` | posting analytics events | iOS analytics service | admin analytics/system tooling |
| `updateAddress_requests/{uid_type}` | requested address change, status/timestamp | iOS profile view | admin activity/Discord/admin web |
| `updateVerificationID_requests/{id}` | ID update URLs/type/status | iOS profile view | admin activity/Discord/admin web |
| `adminUsers/{uid}` | admin role/status or active flag | admin tooling | admin callables and Next.js request verifier |
| `adminActivity/{id}` / `adminAlerts/{id}` | normalized audit/event/alert records | admin Firestore triggers | admin callables/web; Discord trigger |
| `sms_logs/{dedupeKey}` | recipient, body, provider id, status/error, metadata | SMS functions | operations/audit only |

Additional iOS references—`workers`, `completedJobs`, `jobsInProgress`, and some legacy top-level `comments`/`messages` paths—suggest older or parallel schemas. Confirm their live use before migration; do not make them web contracts by default.

## Storage paths

| Path | Purpose | Writer/reader |
|---|---|---|
| `profile_images/{uid}/profile_image.jpg` | profile avatar | `ProfileSetupViewModel`; profile/comment UI reads URL |
| `verification_images/{uid}/{Front|Back}_{uuid}.jpg` | identity evidence | `VerifyIdentityViewModel`; profile/admin via stored URL |
| `jobPostImages/{uuid}.jpg` | published job photos | `StorageService` / `JobPostService`; feed/detail URL reads |
| `job_post_drafts/{uid}/{draftId}/photo_{index}.jpg` | standard draft photos | `DraftPhotoStorage` |
| `research_post_drafts/{uid}/{draftId}/photo_{index}.jpg` | research draft photos | `ResearchDraftPhotoStorage` |
| Caller-supplied paths | generic photo upload/delete | `StorageService`; audit each call before exposing on web |

No Storage rules were available. Identity images require especially strict owner-upload/admin-read controls, content/size limits, retention policy, and non-public download handling.

## Realtime Database

No `Database.database()` usage, path, or Realtime Database trigger was found in application source. Firebase's dependency code is not evidence that RTDB is used.

## Data consistency observations

- Roles use multiple representations: `lookingFor` values (`Find Jobs`, `Post Jobs`), occasional `accountType`/`role`, and custom claims for region/onboarding/waitlist—not Worker/Poster claims.
- Job worker identity appears as `workerId`, `assignedWorkerId`, and `assignedWorkerID` in different code.
- Address fields appear nested under `address` in current iOS writes, while some legacy functions expect flat fields.
- Notification and payment status strings are not centrally versioned.
- Payment data is created and updated by clients, then trusted by payout triggers.
- Comments may create notifications both in the iOS client and in `observeJobComments`, creating duplicate-delivery risk.
- `users/{uid}/meta/verification` is described as a source of truth but is written directly by iOS, including `pending` state and image URLs.

## Required schema checkpoint

Before web coding, export a redacted sample/schema inventory, deployed composite indexes, Firestore rules, Storage rules, and deployed Function trigger manifest. Reconcile aliases and define versioned TypeScript/Swift contracts for users, jobs, requests, payments, notifications, reviews, messages, and research slots.
