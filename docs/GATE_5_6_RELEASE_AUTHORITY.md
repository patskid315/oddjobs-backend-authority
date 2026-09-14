# Gate 5.6 release authority closure

Scope: Emergency Option A only

The committed runtime candidate must export only `releasePaymentOnCompletion`, create an idempotent pending obligation, and contain no path to Stripe. Rules, indexes, webhooks, guarded execution, other Functions, configuration changes, and client changes are outside the candidate.

## Immutable reference model

- `recovered-production-baseline` identifies recovered authority evidence and explicitly does not claim original historical production Git provenance.
- `emergency-option-a-candidate` identifies the final reviewed local repository commit.
- Deployment and rollback archives are generated from committed runtime paths only and stored under ignored `release-artifacts/` with sidecar SHA-256 files and manifests.

## Release decision

The remaining financial records are safe to leave unchanged during Option A because no historical record is consumed or mutated and no Stripe call is possible. The 18 moderate advisories are temporarily acceptable only under the signed scope and conditions in `DEPENDENCY_RISK_ACCEPTANCE.md`.

No production deployment is authorized by this document.
