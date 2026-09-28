# Repository overview

## Meaningful workspace tree

```text
OddJobsNewYorkProduct/                         # workspace container; not a Git repository
├── apps/
│   ├── Android/                               # no application source found
│   ├── Web/
│   │   ├── free-nextjs-admin-dashboard/       # upstream-style dashboard template
│   │   ├── oddjob-web/                        # Django marketing/legal/share site
│   │   └── oddjobs-admin/                     # separate Next.js/Firebase Admin repository
│   └── iOS/                                   # production iOS Git repository; original checkout dirty
├── backend/                                   # newer-looking Firebase Functions tree; not versioned here
├── design-system/                             # Poppins assets and token JSON
├── design-tools/                              # separate Figma importer/tooling Git repository
└── shared/                                    # category/tool JSON, not consumed as a shared runtime package

OddJobsNewYorkProduct-worktrees/
└── ios-design-system-recovery/                # clean iOS recovery worktree used for these docs
    ├── OddJobs New York/                      # SwiftUI production app
    ├── OddJobs New YorkUITests/               # design-catalog screenshot tests
    ├── Scripts/                               # catalog/export tooling
    ├── backend/                               # tracked but older Functions snapshot
    └── docs/web-migration/                    # this audit
```

## Application areas

| Area | Observed implementation | Architectural status |
|---|---|---|
| Production iOS | SwiftUI with Views, ViewModels, Services and Firebase SDK calls | Current product behavior source; boundaries are mixed |
| Firebase backend | CommonJS Node 20, Firebase Functions v1 APIs | 48 exports in the sibling backend; deployed authority unverified |
| Firestore | Direct iOS reads/writes plus callable and trigger functions | Primary data store; rules/indexes absent from audited source |
| Realtime Database | No application references or triggers found | Not currently evidenced |
| Firebase Auth | Email/password, client SDK sessions, Auth create trigger | Used by iOS and admin; only limited server claims |
| Firebase Storage | Profile, verification, job and draft photos | Direct iOS uploads/downloads; rules unavailable |
| Stripe | iOS PaymentSheet plus Functions using Customers, Connect Express, PaymentIntents, SetupIntents and Transfers | Material security/idempotency work required |
| Notifications | Firestore notifications + FCM/APNs; SMS via Twilio; disabled email job alert | Platform-specific delivery needs adapters |
| Messaging/comments | Direct Firestore conversation/message and job comment subcollections | No server command boundary; rule-dependent |
| Location | iOS geocoding and in-bundle NYC neighborhood lookup; server validates only borough string | Web would otherwise duplicate authoritative logic |
| Admin | Independent Next.js application using Firebase client/Admin SDK and callable functions | Useful precedent; not a consumer-web foundation by itself |
| Legacy web | Django static/marketing pages, universal-link response and unauthenticated email endpoints | Active status unverified; contains committed secret material |
| Design system | Tokens/assets plus separate design-tooling repository | Reusable presentation input, not business-domain code |
| Tests | Catalog identity/screenshot tests; no backend/domain unit tests found | Production workflows lack automated contract coverage |

## Backend source-authority problem

The tracked recovery snapshot and sibling backend are not equivalent. The sibling adds `adminActivity.js`, `adminData.js`, `adminDiscordNotifications.js`, `smsNotifications.js`, and a README, and changes `index.js`, `package.json`, and its lockfile. The sibling directory also contains local dependencies/logs/runtime configuration and is not a Git worktree. Therefore:

1. The 48-function inventory documents the most complete code available.
2. It must not be treated as proof of what is deployed.
3. Before implementation, create a single version-controlled canonical backend and compare its compiled/deploy manifest with the Firebase project.
4. Do not copy runtime configuration or local dependency folders into that repository.

## Existing web directions

- `oddjobs-admin` is a real Next.js 16/React 19 TypeScript application. It verifies Firebase ID tokens server-side and checks `adminUsers/{uid}` for active roles. It demonstrates useful server-route/repository layering, but it is separately versioned and has broad Admin SDK access; consumer code must not import its privileged repositories.
- `free-nextjs-admin-dashboard` is a generic template, not OddJobs product architecture.
- `oddjob-web` is a Django marketing/legal site with an AASA universal-link endpoint and email endpoints. It is not a marketplace implementation. Its settings include a committed Django secret and SMTP credential; rotate them and remove them from history before relying on this service.

## Configuration and environments

- Firebase project alias: `theoddjobsappnewyork` in the sibling backend `.firebaserc`.
- Functions region is mostly `us-central1`; iOS also hard-codes `us-central1` HTTP URLs.
- iOS contains test/live Stripe publishable keys selected by compilation condition. Publishable keys are client identifiers, not secret keys, but should move to environment-specific build configuration.
- Stripe secret keys, Twilio configuration, Gmail service account JSON, notification mail credentials, and Discord webhooks are read server-side. Several use deprecated `functions.config()` conventions.
- No source-controlled Firestore rules, Storage rules, Realtime Database rules, or Firestore index file was found anywhere under the product workspace.

## Meaningful scripts and tests

The iOS repository contains design-catalog screenshot/export scripts and tests. No Cloud Function unit/integration tests, Firestore emulator tests, security-rule tests, or production-domain iOS tests were found. The existing tests do not validate marketplace authorization, pricing, jobs, requests, completion, messaging, or payments.
