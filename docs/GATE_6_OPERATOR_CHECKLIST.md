# Gate 6 Option A operator checklist

This is a frozen runbook, not deployment authorization.

## Pre-deploy

- Confirm project ID is exactly `theoddjobsappnewyork`.
- Confirm `git status --short` is empty and HEAD/tag match the reviewed manifest.
- Verify both artifact sidecar SHA-256 values.
- Record the current deployed `releasePaymentOnCompletion` version and build ID read-only.
- Confirm no concurrent backend deployment or incident.
- Confirm the artifact entry point exports exactly one Function.
- Confirm no `stripe_transfer_attempt`, Stripe import, executor import, or execution flag exists in the entry dependency closure.
- Confirm the rollback artifact is local, digest-verified, and extracted successfully.

## Deploy—future authorized Gate 6 only

From the verified emergency artifact extraction directory:

`firebase deploy --only functions:releasePaymentOnCompletion --project theoddjobsappnewyork`

Abort if the CLI proposes rules, indexes, configuration, extensions, hosting, or another Function.

## Post-deploy

- Verify the new Function version/build and trigger path `jobPost/{jobId}`.
- Run every filter in `MONITORING_RUNBOOK.md` at deploy, 5 minutes, 30 minutes, first qualifying completion, and 24 hours.
- Require zero Function errors, zero legacy transfer messages, and zero `stripe_transfer_attempt` messages.
- On the first qualifying completion, confirm exactly one pending obligation/audit event and no claimed, processing, or succeeded settlement created by Option A.
- Verify Stripe transfer inventory did not change because of the completion.

## Rollback triggers

Immediately roll back and open an incident for any Stripe attempt, legacy transfer message, unexpected deployed resource, duplicate pending obligation, candidate-created claimed/processing/succeeded state, unobservable logs, permission regression, or unexplained Function error.

## Rollback

- Verify the rollback archive digest.
- Extract it into a clean temporary directory.
- Run the same single-function deploy command from that extraction directory.
- Re-verify version/build, pending-only behavior, and zero Stripe attempts at 5 and 30 minutes and on the next qualifying completion.
