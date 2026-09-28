# Recommended web architecture

## Decision

Create a consumer Next.js TypeScript app after the security-contract checkpoint. Reuse the existing Firebase project and incrementally harden the existing Functions. Do not base the consumer app on privileged admin repositories or the Django runtime. Reuse visual tokens/assets and platform-neutral domain contracts through explicit packages.

## Target flow

```text
Next.js page / React component
        ↓
ViewModel-style hook or controller
        ↓
Domain use case
        ↓
Repository interface
        ↓
Firebase read adapter | authenticated command API | Stripe.js adapter
        ↓
Firebase Functions / Firestore / Storage / Stripe
```

UI components receive state and callbacks. They do not construct Firestore paths, calculate authoritative fees, choose role/status transitions, or accept arbitrary backend IDs.

## Proposed repository shape

The workspace does not yet provide a canonical consumer-web monorepo. A safe target is:

```text
apps/
└── web/                                  # consumer application, not admin
    ├── src/app/                          # routes/layouts/server endpoints
    ├── src/features/                     # vertical UI/controller slices
    ├── src/presentation/                 # composed product UI
    └── tests/
packages/
├── design-tokens/                        # generated from approved design source
├── domain-contracts/                     # schemas, IDs, enums, DTOs; no Firebase
├── domain-use-cases/                     # platform-neutral orchestration
├── firebase-client/                      # auth/read/listener/storage adapters
├── backend-client/                       # typed authenticated command client
├── validation/                           # shared pure validation, server authoritative
└── test-fixtures/                        # non-production fixtures
backend/
├── functions/src/domains/                # canonical server commands/triggers
├── functions/src/integrations/           # Stripe, FCM, Twilio, Gmail, Discord
├── functions/src/contracts/              # runtime request/result schemas
└── tests/                                # emulator/rules/integration tests
```

The exact workspace tooling is a future decision. Do not create these directories until backend authority and the target Git repository are approved.

## Boundary rules

### Presentation

- React components are pure or side-effect-light.
- Feature hooks/controllers own loading/error/form/navigation state.
- Accessibility, responsive behavior and browser-specific upload/Stripe UI remain platform-specific.

### Domain

- IDs, enums, states, money in integer minor units, validation results and command DTOs are Firebase-independent.
- Use cases express intents such as `createJob`, `acceptRequest`, `completeSlot`, not generic document writes.
- Server remains authoritative for money, roles, ownership, eligibility and transitions.

### Data

- Read repositories may use Firebase client SDK where rules tests prove least privilege and realtime behavior matters.
- Command repositories call authenticated Functions/server routes.
- Firestore snapshots are mapped at adapter boundaries; UI does not consume raw documents.
- Server/admin SDK code is never included in client bundles.

### Shared vs platform-specific

Share domain schemas, validation messages/codes, category/tool registries, pricing policy identifiers, status transitions, API clients and test vectors. Keep React/SwiftUI rendering, navigation, browser/iOS storage APIs, MapKit versus web map providers, APNs versus web push, and PaymentSheet versus Stripe.js platform-specific.

## Authentication

Use Firebase Auth for account continuity. For browser server rendering, verify ID tokens server-side and use secure session cookies. Derive UID/claims on every command. Model Worker/Poster mode and account/verification state in one server-owned policy, not route guards alone.

## Environment configuration

- Define local/emulator, staging and production environment contracts.
- Expose only Firebase client config and Stripe publishable key to the browser.
- Store Stripe/Twilio/Gmail/Discord/Admin credentials in managed server secrets.
- Eliminate hard-coded deployed Function URLs.
- Validate environment completeness at startup without printing secret values.

## Testing

- Pure domain unit tests shared as language-neutral fixtures where practical.
- Runtime contract tests for every command.
- Firebase emulator/rules tests across unauthenticated, Worker, Poster, account-state and admin cases.
- Function integration tests for idempotency and state transitions.
- Stripe test-clock/webhook/idempotency tests.
- Repository contract tests for client adapters.
- React component/accessibility tests and end-to-end tests for approved vertical slices.

## Evolution strategy

Do not attempt an up-front iOS rewrite. Build/harden one server capability, add typed adapters for web and iOS, move the iOS caller, verify parity, then ship the web slice. This creates a shared backend through proven vertical migrations rather than a second implementation.
