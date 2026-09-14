# Temporary dependency risk acceptance

Decision: **ACCEPT TEMPORARILY**  
Owner: Zach Wilcox  
Scope: Emergency Option A only  
Expiration: September 27, 2026

## Accepted posture

The final dependency audit reports 18 moderate, 0 high, and 0 critical findings. The critical and high Firebase CLI `tar` chain was removed by upgrading dependencies. Remaining findings divide into:

- Reachable server dependency graph: Firebase Admin/Functions through Firestore, Storage, Google client, retry, and UUID packages. The published findings are primarily malformed-input or denial-of-service classes; Option A adds no HTTP endpoint and performs no Stripe operation.
- Development/test tooling only: Firebase CLI, Pub/Sub tooling, OpenTelemetry, CSV parsing, streaming JSON, and optional regular-expression tooling used by local/CI workflows rather than the deployed function handler.
- Transitive but not exercised by Option A: Storage, Pub/Sub, webhook, transfer, payout, and optional RE2 paths.

## Conditions

1. No high or critical advisory may be present at build time.
2. Automatic settlement remains disabled and unexported.
3. Deployment is limited to `functions:releasePaymentOnCompletion`.
4. No HTTP endpoint, webhook, rules, indexes, configuration, or other Function is added.
5. Remediation must be tracked before any broader backend or automated-settlement rollout.
6. Re-review is mandatory if the lockfile, dependency graph, runtime, or deployment scope changes.
7. Acceptance expires at the end of September 27, 2026 and must not roll forward silently.

## Recommendation

This acceptance is technically sufficient for the narrow Option A replacement because the patch removes an active financial risk and does not expose the affected malformed-request surfaces. It is not sufficient for guarded execution, webhooks, or broader backend deployment.
