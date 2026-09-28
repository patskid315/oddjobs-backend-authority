# Authentication and authorization

## Authentication lifecycle

1. `OddJobs_New_YorkApp` configures Firebase and installs a `SessionRouter`.
2. `SessionRouter.start()` observes Firebase Auth state, refreshes the ID token, reads `users/{uid}.onboardingStep`, and selects auth, setup, profile, interests, address, verification, or main routing.
3. Signup uses Firebase email/password directly in `SignUpViewModel`, then writes a minimal `users/{uid}` profile with `accountStatus=created` and `onboardingStep=setupAccount`.
4. Account setup, profile type, interests/tools, address and identity are written from iOS in successive steps.
5. Login uses Firebase email/password in `AuthService`, then reads `users/{uid}.accountStatus`; `deleted` is a client-side soft-delete gate followed by sign-out.
6. Password reset uses Firebase Auth email reset directly.
7. Logout uses Firebase Auth sign-out.

No Apple, Google, phone, anonymous, magic-link, or multi-factor authentication flow was found. `GuestAuth.swift` exists, but no production anonymous-auth contract was established by this audit.

## Account type and state

Worker/Poster is represented primarily by the mutable user field `lookingFor` with string values `Find Jobs` and `Post Jobs`. Other code also tolerates `accountType` or `role`, which creates drift. Account lifecycle uses `created`, `queued`, `active`, `restricted`, `suspended`, and a soft-delete value `deleted` even though `deleted` is absent from the `AccountStatus` enum.

Onboarding uses:

```text
setupAccount → profileSetup → interestSelection → addressInput
→ verifyIdentity → completed
```

Server custom claims are set only by `finalizeNYCOnboarding`: `region=nyc`, `onboarded=true`, `waitlist=<bool>`, or `out_of_area=true`. No Worker/Poster or verification claim is set.

## Server-enforced authorization observed

- Authenticated UID scoping exists for `createConnectedAccount`, `getStripeBalance`, NYC finalization, referrals, and worker-stat callables.
- Referral functions read the caller's `users/{uid}.lookingFor`, require Poster semantics, match any provided poster ID to the token UID, and require a completed-job connection for existing-worker referrals.
- Admin callables require authentication and an `adminUsers/{uid}` record. The Function implementation checks `active`; the Next.js admin verifier checks an allowed role and `status=active`. This schema mismatch needs reconciliation.
- The payout and notification triggers execute as trusted server code, but their input documents are populated by clients.

## Client-only or rule-dependent enforcement

The following are not backed by an observed server command and therefore depend entirely on unavailable Firestore/Storage rules:

- A user writing only its own profile and onboarding fields.
- Worker versus Poster feature access and role changes.
- Soft-deleted/suspended/queued/restricted users being denied data access.
- Job ownership, create/edit/cancel permissions and pricing.
- Request sender/receiver identity, acceptance/rejection authority, and valid transitions.
- Research slot assignment/completion authority.
- Message participant access and sender identity.
- Comment author identity and mention targets.
- Notification sender/receiver/read permissions.
- Review eligibility and one-review-per-completed-job rules.
- Payment record creation, prices, recipient and payout amount.
- Promo validity/redemption and usage limits.
- Verification status and identity-image access.
- Account soft deletion.

These are **unverified blockers**, not proof that deployed rules are permissive. The rules simply were not present to establish safety.

## High-risk flows

### Role and waitlist

`ProfileSetupViewModel` sends `lookingFor`, stores it directly, and calls worker stats with client booleans. The server capacity decision uses a hard-coded limit of 100 but does not atomically persist the selected role/status with the count decision. A public web client must not be able to promote itself or manipulate capacity counters.

### NYC eligibility

iOS geocodes and runs `NeighborhoodLocator`, then writes address coordinates and passes only a borough name to the server. The server validates the borough string against five names, not the coordinate/address. Move geographic eligibility to a server-owned normalized address command or verify a signed/provider-derived result.

### Identity verification

iOS uploads ID images and writes `users/{uid}/meta/verification`, including `pending`; it can also skip verification and advance onboarding. Product screens use a client-side verification gate. Establish separate applicant-owned submission fields and reviewer/server-owned decision fields.

### Account status

The app enforces `deleted` at login by reading Firestore. Server resources and functions do not consistently check account status. Authorization should reject disabled states centrally, with token revocation/session invalidation as appropriate.

## Web authentication recommendation

Use Firebase Auth email/password initially to preserve account compatibility. The Next.js client obtains an ID token; server routes exchange/verify it and set a secure, `HttpOnly`, `Secure`, `SameSite` session cookie where server rendering requires one. Client repositories may use Firestore only for explicitly read-safe/listener use cases proven by tests; sensitive commands go through callable/HTTP server handlers that derive UID and role from verified identity, never from payload fields.

Add Auth emulator and rules tests for each role/state, CSRF protection for cookie-authenticated mutations, App Check assessment, rate limiting, revocation handling, and audit logging. Product approval is required for cross-device session policy and whether a user can switch Worker/Poster modes.
