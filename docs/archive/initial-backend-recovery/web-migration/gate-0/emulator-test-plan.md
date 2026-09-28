# Minimum Firebase Emulator test plan

## Readiness

Plan only. Tests were not created because no canonical rules source or Firebase emulator configuration exists in Git. Implementing against an unapproved copy would create a competing policy authority.

Minimum services:

- Authentication Emulator for unauthenticated, Worker, Poster, waitlisted, restricted, and admin identities with explicit custom claims.
- Firestore Emulator for policy tests and deterministic fixtures.
- Storage Emulator for ownership/public-read tests.
- Functions Emulator for authenticated callable/HTTP boundaries and selected trigger/idempotency tests.
- `@firebase/rules-unit-testing` with Admin-context seeding that bypasses rules only during fixture setup.

Each test must start from a clean emulator state, use fixed IDs/timestamps, assert the current result even where it exposes an unsafe allow, and attach the deployed-policy fingerprint `326738f1…c96b` to the baseline suite.

## Firestore and Auth matrix

| Area | Actor | Initial state | Operation | Expected current result |
|---|---|---|---|---|
| Authentication | Unauthenticated | Existing `users/workerA` | Read profile | **DENY** |
| Authentication | Signed-in `workerB` | Existing `users/workerA` | Read another profile | **ALLOW** |
| Profile ownership | `workerA` | No own profile | Create `users/workerA` | **ALLOW** |
| Profile ownership | `workerB` | Existing `users/workerA` | Update profile A | **DENY** |
| Profile policy | `workerA` | Own profile with role/status | Change a role-adjacent field only | **ALLOW** (unsafe baseline) |
| Profile policy | `workerA` | Own profile | Change `verificationStatus` | **DENY** |
| Profile policy | `workerA` | Own profile | Set `accountStatus=deleted` and alter another field | **ALLOW** (branch is not changed-key constrained) |
| Worker/Poster claims | Signed-in, no NYC claims | No job | Create own `jobPost` | **ALLOW** (job create is not NYC-gated) |
| Worker/Poster claims | Waitlisted NYC user | No request/payment | Create `jobRequests` or `payments` | **DENY** |
| Job read | Unauthenticated | Existing job | Get/list `jobPost` | **ALLOW** |
| Job create | Signed-in Poster | No job | Create with own `userId` | **ALLOW** |
| Job create | Signed-in Poster | No job | Create with another `userId` | **DENY** |
| Job authority | Job owner | Existing own job | Change price, assignment, and status | **ALLOW** (unsafe baseline) |
| Job worker update | Assigned Worker | Standard job | Change only allowed completion fields with valid types | **ALLOW** |
| Job worker update | Unassigned Worker | Standard job | Change completion status | **DENY** |
| Assignment | Job owner | Unassigned own job | Set `assignedWorkerID` directly | **ALLOW** (client-trusted) |
| Request create | NYC-authorized Worker | Existing job | Create request with caller as `senderID` | **ALLOW** |
| Request spoof | NYC-authorized Worker | Existing job | Create with another `senderID` | **DENY** |
| Request transition | Request receiver | Existing request | Rewrite status/assignment-related fields | **ALLOW** (unsafe baseline) |
| Completion | Assigned Worker | Standard job | Set arbitrary string `progressStatus` in allowed key set | **ALLOW** (no state enum/transition check) |
| Research completion | Accepted slot Worker | Existing slot | Write allowed completion fields | **ALLOW** |
| Research slot | Unrelated Worker | Existing slot | Update slot | **DENY** |
| Messaging | Conversation participant | Parent has actor in `participants` | Create message with own sender ID | **ALLOW** |
| Messaging spoof | Conversation participant | Parent has actor in `participants` | Create message claiming another sender ID | **ALLOW** (unsafe baseline) |
| Messaging | Nonparticipant | Existing conversation | Read/write message | **DENY** |
| Comments | Unauthenticated | Existing comment | Read comments | **ALLOW** |
| Comments | Signed-in author | Existing public job | Create with matching `authorId`/`jobId` | **ALLOW** |
| Comments spoof | Signed-in user | Existing public job | Create with another `authorId` | **DENY** |
| Notifications | Signed-in user | No notification | Create notification for arbitrary receiver/sender/type | **ALLOW** (critical unsafe baseline) |
| Notifications | Recipient | Existing notification | Read | **ALLOW** |
| Notifications | Other signed-in user | Existing notification | Read | **DENY** |
| Reviews | Any signed-in user | Existing user/job not involving actor | Create nested user review | **ALLOW** (unsafe baseline) |
| Reviews | Signed-in participant | Existing root review | Read | **ALLOW** |
| Reviews | Any client | Root review path | Create/update/delete | **DENY** |
| Verification | Signed-in user | No request | Create typed request for self | **ALLOW** |
| Verification spoof | Signed-in user | No request | Create request for another user | **DENY** |
| Verification decision | Request owner | Existing request | Update/delete request | **DENY** |
| Payment create | NYC-authorized Poster | No payment | Create as sender with arbitrary amount/recipient | **ALLOW** (critical unsafe baseline) |
| Payment create | Waitlisted Poster | No payment | Create as sender | **DENY** |
| Payment update | Recorded recipient | Existing payment | Rewrite amount/status/payout fields | **ALLOW** (critical unsafe baseline) |
| Payment query | Payment participant | Several payments | Unfiltered collection list | **DENY**; individual get **ALLOW** |
| Payment query | Payment participant | Several payments | Query constrained to `senderId == uid`, then `recipientId == uid` | **ALLOW expected; verify both**, because broader `allow read` may authorize a provably party-scoped query |
| Balance | NYC-authorized owner | Own balance | Rewrite financial aggregate | **ALLOW** (critical unsafe baseline) |
| Withdrawal | Signed-in owner | No withdrawal | Create arbitrary amount/status for self | **ALLOW** (critical unsafe baseline) |
| Withdrawal | Recorded owner | Existing withdrawal | Rewrite status/amount | **ALLOW** (critical unsafe baseline) |
| Admin client boundary | Signed-in admin or user | Existing `adminUsers`, `adminActivity`, `adminAlerts` | Direct SDK read/write | **DENY** |
| Admin callable | Unauthenticated | Functions emulator | Invoke admin data callable | **DENY / unauthenticated** |
| Admin callable | Authenticated non-admin | No `adminUsers/{uid}` | Invoke admin data callable | **DENY / permission-denied** |
| Admin callable | Authenticated active admin | Valid admin record | Invoke admin data callable | **ALLOW**, with approved field projection |

## Storage matrix

| Area | Actor | Initial state | Operation | Expected current result |
|---|---|---|---|---|
| Verification | Owner | Empty owner path | Write/read `verification_images/{uid}` | **ALLOW** |
| Verification | Other user | Existing owner object | Read/write owner path | **DENY** |
| Legacy verification | Owner | Empty | Write matching `{uid}_front.jpg` | **ALLOW** |
| Legacy verification | Owner | Empty | Write nonmatching filename | **DENY** |
| Job image | Any authenticated user | No ownership fixture | Upload anywhere under `jobPostImages` | **ALLOW** (unsafe baseline) |
| Job image validation | Any authenticated user | Empty path | Upload oversized/non-image bytes | **ALLOW by rules** (unsafe baseline) |
| Job image read | Unauthenticated | Existing image | Read | **ALLOW** |
| Completion image | Authenticated user whose UID equals path worker segment | User is not assigned to job | Upload | **ALLOW** (unsafe baseline) |
| Completion image | Unauthenticated | Existing completion image | Read | **ALLOW** (privacy review required) |
| Draft image | Owner | Own draft path | Read/write | **ALLOW** |
| Draft image | Other user | Owner draft path | Read/write | **DENY** |
| Profile image | Owner | Own path | Write | **ALLOW** |
| Profile image | Unauthenticated | Existing profile image | Read | **ALLOW** |
| Unmatched path | Any client | Any object | Read/write | **DENY** |

## Function behavior freeze

After rules tests pass against the exact deployed policy, add focused Function emulator/integration tests for the 45 deployed names: authentication derivation, duplicate event handling, transaction retry, no client-selected payment amount, notification recipient binding, admin active-role checks, and Stripe transfer idempotency. These tests document current behavior first; desired security changes belong to later reviewed commits.

## Exit criteria

- Exact recovered rules/indexes are source-controlled and their hashes match the baseline.
- All allow/deny cases above are deterministic in CI.
- Known unsafe allows are explicitly labeled and cannot disappear without reviewed expectation changes.
- Emulator project IDs and credentials cannot target production.
- No test requires or reads production data.
