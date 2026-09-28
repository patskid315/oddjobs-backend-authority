# Implementation roadmap

## Gate 0 — establish authority and safety

1. Identify the exact Git source and commit deployed to Firebase.
2. Inventory deployed Functions, regions, runtime versions and triggers; reconcile against the 48 exports.
3. Export current Firestore/Storage rules and indexes read-only, version them through an approved change, and build emulator tests.
4. Rotate/remove exposed Django and any other committed secrets.
5. Approve canonical user/account/role, job/request/slot, payment and verification schemas.
6. Decide whether the existing Django marketing site and Next.js admin remain separately deployed.

**Exit:** one authoritative backend, reviewed deployed parity, rule test harness, no unresolved credential exposure.

## Phase 1 — platform contracts and read-only shell

- Create the consumer Next.js TypeScript shell in the approved repository.
- Integrate approved design tokens/assets and accessibility baseline.
- Add environment validation, Firebase client bootstrap, error handling and telemetry policy.
- Define platform-neutral IDs/enums/runtime schemas and typed error contract.
- Implement read-only public/auth job browse and detail behind proven rules.

**Exit:** no sensitive writes; environment and read authorization tests pass.

## Phase 2 — authentication, session and profile

- Email/password signup/login/reset/logout and secure browser session.
- Server-owned account-mode/onboarding/status transitions.
- Normalize role/account state; migrate iOS one step at a time.
- Server-owned NYC address validation.
- Verification submission/decision separation and secure Storage rules.

**Exit:** Worker/Poster and account-state access is server-enforced for both clients.

## Phase 3 — payment foundation before transactional jobs

- Auth-scope all Stripe customer/account/payment-method operations.
- Add server price quotes, policy versioning and promo redemption.
- Derive PaymentIntent amount/customer from quote/job.
- Add verified Stripe webhooks, event ledger and idempotent Connect/payout operations.
- Resolve standard versus research fee policy.

**Exit:** client cannot choose charge/payout amounts; retry/reconciliation tests pass.

## Phase 4 — Poster create job

- Upload policy and draft repository.
- Standard/research create-job commands using quotes.
- Schedule/address/category validation and immutable pricing snapshot.
- Migrate iOS posting caller to the same command.

**Exit:** equivalent iOS/web jobs produce the same canonical records.

## Phase 5 — Worker discovery and requests

- Authenticated discovery eligibility queries.
- Create-request, reject and accept/assign commands.
- Transactional research slot allocation.
- Migrate iOS request flows and verify race/idempotency behavior.

## Phase 6 — active work, completion and payouts

- Start, cancel, complete and research closeout state machines.
- Review eligibility tokens/commands.
- Connect completion to server-derived settlement/payout.
- Preserve/refine connection trigger and audit events.

## Phase 7 — communications

- Conversation participation and message repository/command.
- Canonical comment/mention writer with one notification producer.
- Device/channel registry, preferences, web push and token lifecycle.
- SMS/email rate/consent/retention controls.

## Phase 8 — secondary capabilities

- Reviews UI, referrals, payment history/balance, profile update queues.
- Universal-link/share metadata and marketing integration.
- Operational/admin reconciliation, observability and support runbooks.

## Release strategy

Use staging/emulators first, then gated vertical slices. Every mutation phase requires contract tests, rules tests, idempotency tests, iOS parity verification, audit visibility and rollback instructions. Do not launch public web payments or completion until Phase 3 controls and Phase 6 state machines are both complete.

## Recommended next checkpoint

Hold a backend-authority/security-contract review with backend, iOS, web, product/finance and operations owners. Required inputs: deployed Function list, exported rules/indexes, Stripe event/payout model, role/account-state decision, fee policy, verification handling, and selected canonical Git repository. The output should be an approved Gate 0 work plan—not application code.
