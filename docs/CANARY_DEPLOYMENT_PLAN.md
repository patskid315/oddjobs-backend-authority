# Canary deployment plan

Status: plan only; **not authorized**

## Pre-deploy checklist

- Clean reviewed emergency-candidate commit and immutable artifact digests match.
- All three agent reviews permit release and risk acceptance is approved.
- Record reconciliation blocker is cleared.
- Production project, authenticated operator, current 45-function inventory, rules/index digests, and rollback artifact are independently verified.
- `SETTLEMENT_EXECUTOR_ENABLED` is absent/false; no webhook or rules deployment is included.
- Monitoring queries and alert recipients are validated.

## Exact deployment command — document only, do not run during Gate 5.5

From the immutable artifact/commit only:

`firebase deploy --only functions:releasePaymentOnCompletion --project theoddjobsappnewyork`

Abort if Firebase proposes any other function, rules, indexes, extensions, hosting, or configuration change.

## Preconditions

- Resolve every Gate 5 blocker and every dependency advisory or document approved risk acceptance.
- Import and review the full production function source; preserve all unrelated exports.
- Implement and test durable webhook-event storage and provider reconciliation.
- Reconcile all ambiguous production financial records.
- Produce a clean reviewed commit, immutable build, source/rules/index digests, explicit project/environment approval, and three GO verdicts.
- Confirm rollback artifacts and monitoring queries in a staging project first.

## Staged rollout

1. Deploy rules-only additive server boundaries to staging; prove current client flows and denials.
2. Deploy the completion-to-pending trigger with execution disabled; compare obligation creation against expected test fixtures.
3. Deploy webhook/reconciliation in test mode; verify signature failures, replay, delayed delivery, and alerts.
4. Enable one synthetic settlement canary in staging and prove ledger/Stripe convergence.
5. If separately authorized for production, deploy code with execution disabled and observe completion events.
6. Enable only an explicit allowlisted production canary. Stop after one obligation and require human verification in Stripe and Firestore.
7. Expand gradually only with zero duplicate, ambiguous, security, or reconciliation alerts.

The only emergency Function deployment target is `releasePaymentOnCompletion`; rules are a separate reviewed deployment. The expected production inventory remains the 45-name allowlist in `production-baseline/function-inventory.json`. Any other addition, deletion, rename, region/generation change, or unexpected prompt is a hard stop. The exact semantic code change is: remove transfer creation from the completion event and replace it with idempotent pending-obligation creation plus audit/issue recording. `SETTLEMENT_EXECUTOR_ENABLED` remains absent/false. Observe for at least one full normal completion cycle and 24 hours after the first allowlisted canary, whichever is longer. Queries must cover pending/claimed/processing/manual-review age, duplicate identities, lease expiry, failed attempts, unmatched Stripe metadata, webhook failures, and unexpected transfer count. Manual settlement requires two-person record validation against Stripe and a separately approved operational procedure; it is not implemented by this patch.

## Automatic stop conditions

Any duplicate identity, unexpected amount/destination, ambiguous Stripe result, missing webhook, unresolved event, lease anomaly, rules denial regression, inventory drift, or monitoring gap stops rollout and invokes rollback.

## Timed verification

- Post-deploy: verify version, source/build digest, trigger path, service identity, and only one changed function.
- 5 minutes: zero `stripe_transfer_attempt`, zero legacy transfer messages, zero errors; confirm no inventory drift.
- 30 minutes: repeat zero-transfer checks; inspect pending/manual-review counts and duplicate suppression.
- First completion: confirm exactly one pending obligation and audit event, unchanged Stripe transfer count, and no claimed/processing/succeeded settlement.
- 24 hours: reconcile every completion and confirm zero transfer attempts before considering the emergency patch stable.

Rollback triggers are any Stripe attempt, legacy transfer message, unexpected deployment resource, duplicate obligation, candidate-created succeeded settlement, permission regression, unhandled function error, or inability to observe the invariant.
