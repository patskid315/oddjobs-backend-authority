# Repository agent routing

Use only the relevant blocking agent instructions:

- `.agents/backend-authority.md` for source, Firebase configuration, provenance, or deployment changes.
- `.agents/payments-security.md` for payments, Stripe, settlement, ledger, refund, transfer, payout, withdrawal, or financial-rule changes.
- `.agents/testing-release.md` for every release candidate and any runtime/rules change.

All three run for a payment deployment. Agents review and report; they never deploy or expose secrets without explicit user authorization.

