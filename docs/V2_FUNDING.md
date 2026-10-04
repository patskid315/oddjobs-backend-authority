# V2 selected-job funding

`v2Funding` implements the bounded financial transition from `FUNDING_REQUIRED`
to `FUNDED`. Job lifecycle remains `SELECTION_PENDING_FUNDING`; it creates no
assignment, work authorization, Stripe Transfer, settlement, or worker payout.

The poster first requests an authoritative quote. The backend authenticates the
owner, revalidates the job, provisional selection, selected response, standing,
and (for hourly work) the current matching bilateral agreement. It creates one
private immutable snapshot before any Stripe mutation. Fixed base is the current
authoritative offer. Hourly base and fees use `ORDINARY_V2_USD_HALF_UP_V1` integer
formulas. Clients supply no amount, fee, currency, customer, worker, or provider ID.

After explicit poster continuation, the same intent creates or recovers one
automatic-capture USD PaymentIntent using its durable Stripe idempotency key.
The poster customer is resolved server-side and ownership-checked at Stripe. The
selected worker's existing Express account is retrieved server-side and must be
owned, submitted, charge-enabled, and payout-enabled before payment preparation.
No destination charge or Transfer is created.

PaymentSheet completion is presentation evidence only. `status` performs an
authoritative Stripe retrieval. `v2FundingWebhook` verifies the raw-body Stripe
signature and accepts the relevant PaymentIntent events. Both paths require exact
PaymentIntent, amount, currency, customer, automatic-capture, mode, and bounded
metadata matches before setting `FUNDED`. Duplicate events are claimed once;
stale failures cannot demote `FUNDED`. Unknown provider outcomes lock the single
obligation and are reconciled rather than replaced.

Private data lives in `v2FundingObligations`, `v2StripeCustomers`, and
`v2StripeEvents`, which inherit the ruleset's default deny. Callable projections
exclude customer, Connect, PaymentIntent, event, worker, response, binding, and
reconciliation references. The PaymentIntent client secret is returned only by
the authenticated preparation response required by PaymentSheet and is never
persisted or logged.

## Activation prerequisites

Activation is not authorized by this implementation. Before a separately approved
deployment, configure `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in Secret
Manager for one verified Stripe environment/account. Register the deployed
`v2FundingWebhook` URL for `payment_intent.succeeded`,
`payment_intent.processing`, `payment_intent.payment_failed`, and
`payment_intent.canceled`; verify raw-body delivery and mode isolation. Approve
funding-specific retention, monitoring, canary, kill-switch, and rollback. A
rollback must stop new PaymentIntent preparation while leaving status/webhook
reconciliation available for existing attempts. Confirm the current production
function inventory before any selective deployment.

Expected selective targets after those gates are satisfied:

```sh
firebase deploy --project theoddjobsappnewyork --only functions:v2Funding,functions:v2FundingWebhook,functions:v2Marketplace
```

The marketplace target is included because its selection projection now tolerates
the independent `PROCESSING`, `UNKNOWN`, and `FUNDED` financial states while the
job remains unassigned. No rules or index deployment is required by this change.
