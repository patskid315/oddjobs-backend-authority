# Current security-policy coverage

This classification reflects the exact deployed Firestore and Storage rules retrieved read-only on 2026-08-09. It assesses client authorization only. Admin SDK and Functions bypass rules and must enforce their own authorization.

## Firestore

| Capability / path | Classification | Current effective protection | Main gap |
|---|---|---|---|
| `users/{uid}` | **PARTIALLY PROTECTED** | Signed-in users can create/update only their own document; verification-status changes are blocked; any signed-in user can read every user | Owners can change most other fields, including role-adjacent/profile state; delete is represented by client-set `accountStatus=deleted`; no least-privilege public projection |
| `users/{uid}/meta/*` | **PROTECTED** | Owner-only read/write | Schema and retention still need contract tests |
| `users/{uid}/verify/*` | **PARTIALLY PROTECTED** | Owner-only read/write | User can write arbitrary verification metadata; decision versus submission boundary is not modeled |
| `jobPost/{jobId}` | **CLIENT-TRUSTED** | Public read; signed-in owner can create/update/delete; assigned standard-job worker may update an allowed key list | Poster is not NYC/account-state gated and can set authoritative price/state/assignment fields; worker may choose arbitrary status strings |
| `jobPost/{jobId}/slots/*` | **PARTIALLY PROTECTED** | Poster may mutate slots when NYC-authorized; accepted worker can update a limited field list | Poster controls authoritative slot state; worker status values are not state-machine constrained |
| `jobRequests/{id}` | **CLIENT-TRUSTED** | NYC-authorized sender may create; sender or receiver may read/update | Either party may write arbitrary transition fields; no job ownership, eligibility, uniqueness, or transaction invariant |
| `conversations/{id}/messages/{id}` | **PARTIALLY PROTECTED** | Only IDs listed in parent `participants` may read/write messages | Message sender/content fields are not bound to caller; no rule authorizes or validates parent conversation creation in recovered policy |
| `jobPost/{id}/comments/{id}` | **PARTIALLY PROTECTED** | Public read; authenticated author-ID match on create; author-only delete; no update | Public exposure may include user text; no job visibility/account-state or mention-recipient validation |
| `notifications/{id}` | **CLIENT-TRUSTED** | Recipient-only read | Any signed-in user may create/update/delete any notification, including recipient/sender/type; trigger can turn spoofed documents into pushes |
| nested `reviews/{uid}/userReviews/{id}` | **CLIENT-TRUSTED** | Any signed-in user may read/create; update/delete denied | No author, job, participant, completion, target, or duplicate validation |
| root `reviews/{id}` | **PROTECTED** | Read only for recorded Poster/Worker; all client writes denied | Two incompatible review shapes require consolidation |
| `payments/{id}` | **CLIENT-TRUSTED** | NYC-authorized sender may create; sender/recipient may read/update; unfiltered list and delete are denied | Client chooses amount, recipient, Stripe and settlement fields; either party may rewrite authoritative state. A party-scoped query may satisfy the broader `allow read` despite a separate `allow list: false` statement because matching allows are ORed |
| `payout_pending_jobs/{id}` | **PROTECTED** | Recipient-only get; list/write denied | Server retry/idempotency still requires testing |
| `balance/{uid}` | **CLIENT-TRUSTED** | Owner read; NYC-authorized owner or a caller named in `fromJobPoster` may write | Client controls monetary aggregates and can assert poster relationship in request data |
| `withdraws/{id}` | **CLIENT-TRUSTED** | Owner-claimed create; owner read/update | Client can set amount and status; no immutable/transition field policy; delete falls through deny |
| `stripe_customers/{uid}` | **PROTECTED** | Owner-only read; client writes denied | Callable/HTTP Stripe endpoints remain a separate critical boundary |
| `updateAddress_requests/{id}` | **PARTIALLY PROTECTED** | Authenticated caller can create only for self | Payload fields and duplicate/rate behavior are not validated; no client read/update rule |
| `updateVerificationID_requests/{id}` | **PARTIALLY PROTECTED** | Self create with basic types, self read, no client update/delete | `newValue` contents are not constrained; sensitive-data minimization is unproven |
| `connections/{id}` | **PROTECTED** | Participant-only read; all client writes denied | Source uses `jobConnections` elsewhere, so path/schema parity must be reconciled |
| `promoCodes/{code}` | **PARTIALLY PROTECTED** | Signed-in read; no client write | Full promo definitions may be exposed; redemption/usage is not server-enforced by rules |
| `job_post_events/{id}` | **CLIENT-TRUSTED** | Any signed-in user may create; no reads/updates/deletes | Event identity/content is not validated |
| `workers/{uid}/jobsInProgress/*`, `completedJobs/*` | **PARTIALLY PROTECTED** | Owner-only read/write | Client controls derived workflow history |
| `job_post_drafts/{uid}`, `research_post_drafts/{uid}` | **PROTECTED** | Owner-only read/write | Document-vs-subcollection shape must match actual client paths |
| admin collections (`adminUsers`, `adminActivity`, `adminAlerts`) | **PROTECTED from client SDK** | No explicit match; final deny applies | Admin SDK/Function authorization uses separate code and inconsistent activation conventions |
| Unmatched collections | **PROTECTED** | Final recursive deny | New collections fail closed, which is desirable |

## Storage

| Path | Classification | Current behavior | Main gap |
|---|---|---|---|
| `verification_images/{uid}/**` | **PROTECTED** | Owner-only read/write | File size/type/content and immutable submission policy absent |
| `verificationID/{uid}_{front|back}.jpg` | **PROTECTED** | Filename-bound owner read/write | No size/content validation; legacy duplicate verification path |
| `jobCompletionPhotos/{job}/{worker}/**` | **PARTIALLY PROTECTED** | Path worker may write; public read | No proof worker is assigned to job; sensitive completion imagery is public |
| `jobCompletionPhotos/{job}/slots/{slot}/{worker}/**` | **PARTIALLY PROTECTED** | Path worker may write; public read | No accepted-slot check; public exposure |
| `jobPostImages/**` | **CLIENT-TRUSTED** | Any authenticated user may write; public read | No owner/job binding, size/type constraint, or cleanup policy |
| `job_post_drafts/{uid}/{draft}/**` | **PROTECTED** | Owner-only read/write | Add size/type limits and lifecycle tests |
| `research_post_drafts/{uid}/{draft}/**` | **PROTECTED** | Owner-only read/write | Add size/type limits and lifecycle tests |
| `profile_images/{uid}/**` | **PARTIALLY PROTECTED** | Owner write; public read | No size/type limits; public privacy expectation must be approved |
| Other Storage paths | **PROTECTED** | No catch-all allow | Confirm Firebase default deny in emulator |

## Security summary

- **Protected:** direct client access to unspecified/admin collections, Stripe customer records, payout-pending records, owner metadata/drafts, and several user-owned storage paths.
- **Partially protected:** profile/verification, messages, comments, slots, addresses, promo reads, worker history, and public image paths.
- **Client-trusted:** job authority, request transitions, notifications, nested reviews, payments, balances, withdrawals, and event documents.
- **Unknown:** App Check enforcement, IAM/service-account scope, Firebase Auth password/session policy, deployed logging/retention, and any policy outside the retrieved default database/bucket.

Cloud Functions do not compensate for these allows when iOS or web can write the same documents directly. Transactional web work remains blocked until the server owns money, identity/role, eligibility, assignment, and state transitions.
