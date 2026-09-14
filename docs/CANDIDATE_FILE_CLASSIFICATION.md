# Candidate file classification and commit plan

## Production baseline

`production-baseline/functions/*`, `production-baseline/MANIFEST.md`, `production-baseline/function-inventory.json`, `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `firebase.json`, and `.firebaserc`.

## Emergency patch

`functions/index.js`, `functions/src/settlement/completionHandler.js`, `functions/src/settlement/firestoreSettlementRepository.js`, `functions/src/settlement/idempotency.js`, `functions/src/settlement/model.js`, and `firestore.emergency.rules`. Only the function code—not rules—is in the first proposed canary.

## Test

`functions/test/*`, `functions/test-emulator/*`, `functions/test-stripe/*`, `firebase.emulator.json`, and `scripts/run-stripe-test-mode.js`.

## Release infrastructure

`functions/package.json`, `functions/package-lock.json`, `.github/workflows/verify.yml`, `scripts/verify-release-guards.js`, `scripts/rollback-drill.js`, `.gitignore`, and `docs/RELEASE_METADATA_SCHEMA.json`.

## Documentation

`README.md` and `docs/*.md`.

## Agent/governance

`AGENTS.md` and `.agents/*.md`.

## Future V2—excluded from emergency release

`firestore.v2.rules`, `functions/src/settlement/executor.js`, `stripeTransferService.js`, `settlementService.js`, `reconciliationService.js`, and `functions/src/webhooks/*`. These remain testable design evidence but are not exported by the emergency entry point.

## Excluded generated or sensitive material

`node_modules`, `firestore-debug.log`, Firebase debug logs, `.runtimeconfig.json`, `.env*`, archives, `production-baseline/raw`, `.DS_Store`, local credentials, and test/live Stripe secrets are ignored or absent.

## Planned commits

1. `chore(authority): preserve recovered production baseline`
2. `fix(payments): replace completion transfer with pending obligation`
3. `test(release): add emulator, Stripe, rollback, and release guards`
4. `docs(governance): record evidence, runbooks, and agent policy`

The recovered baseline can be faithfully represented as Commit 1, but it must be described as recovered authority—not historical deployed Git provenance. Commits are prohibited until reconciliation and independent review blockers are resolved.
