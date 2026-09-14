# Rollback plan

Status: plan only; no deployment performed.

The safe fallback is Option A: completion records a pending settlement but never moves money. The executor remains disabled by default.

## Prepared rollback sequence

1. Disable settlement execution immediately; do not delete settlement or event records.
2. Restore the previously fingerprinted function artifact and rules/index artifacts from the immutable release manifest, using an explicitly selected project.
3. Preserve webhook delivery and reconciliation visibility while blocking new execution.
4. Classify every claimed, processing, failed, or manual-review settlement against Stripe before retrying anything.
5. Verify function inventory, source/build/rules/index digests, client access, alerts, and financial counts after rollback.

Never roll back by replaying completion updates, deleting audit data, clearing idempotency identities, or retrying an ambiguous transfer without first querying Stripe. The recovered archive is evidence, not a deployable rollback artifact, until secrets are removed and the full source is reviewed.

## Local drill evidence

Command: `npm run test:rollback --prefix functions`

Result on 2026-09-13: `ROLLBACK_DRILL_OK candidate=pending_only fallback=pending_only transfer_attempts=0`.

The drill executes a completion against both the emergency candidate and simulated safe fallback, asserts one pending write, and asserts zero Stripe calls. A simulated runtime failure therefore falls back to the same non-paying behavior rather than the recovered unsafe handler.

Candidate and fallback artifact IDs remain intentionally blank because no reviewed commit/artifact may be created while reconciliation and approval blockers remain. Before Gate 6, both IDs and their source digests must be inserted and the drill rerun from extracted artifacts.
