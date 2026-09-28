# Stripe architecture

## Current model

- Firebase Auth creation provisions a Stripe Customer and stores its ID in `stripe_customers/{uid}`.
- Workers receive Stripe Connect **Express** accounts. Account and capability status are cached in the same document.
- iOS uses Stripe PaymentSheet for SetupIntents and PaymentIntents.
- iOS calculates job price, posting fee, promo discount, worker cut and platform profit, then writes a `payments` document.
- Standard job completion and research slot completion trigger separate Stripe Transfers to the connected account.
- Failed transfers create `payout_pending_jobs`; an hourly scheduler retries them.
- Balance aggregates and pay notifications are updated after payout or recorded-payment handling.

## Actual fees

| Flow | Poster side | Worker side | Observed total platform amount before processor costs |
|---|---:|---:|---:|
| Standard, no promo | 10% of base | 5% of base (worker receives 95%) | 15% of base |
| Research | 10% per participant | No deduction observed; payment `workerCut` equals participant pay | 10% of base |
| Zero/full promo | Client marks payment skipped; worker earnings may be recorded without Stripe transfer | Product behavior needs review | May be negative/zero after worker obligation; client clamps platform profit only |

No server-owned quote or policy version proves these numbers. Confirm with product/finance/legal before web implementation.

## iOS responsibilities today

- Select test/live publishable key at build time.
- Fetch its Stripe customer document.
- List/detach cards and request ephemeral keys, SetupIntents and PaymentIntents.
- Present PaymentSheet.
- Start Connect onboarding and Dashboard links.
- Calculate amount in cents passed to `createPaymentIntent`.
- Calculate and write payment, promo and payout fields.
- Change completion states that trigger transfer.

Web should own only presentation: Stripe.js/Elements or hosted onboarding redirects, client-secret use, and displaying server-derived payment status. It must not calculate an authoritative charge, worker cut or payout.

## Blockers

1. `createEphemeralKey`, `createSetupIntent`, `detachPaymentMethod`, `createPaymentIntent`, and `getDefaultPaymentMethod` do not verify authentication/ownership.
2. `listPaymentMethods`, `createAccountLink`, and `createDashboardLink` are unauthenticated HTTP endpoints accepting arbitrary customer/user IDs.
3. `createPaymentIntent` trusts client amount/currency/customer/payment method.
4. Payout triggers trust client-written `workerCut`, `recipientId`, `paymentSkipped`, promo fields and status.
5. Stripe Transfers do not use stable idempotency keys. A crash after transfer and before Firestore success can produce another transfer on retry.
6. No Stripe webhook exists for PaymentIntent, SetupIntent, account capability, dispute/refund, charge or transfer reconciliation.
7. Some iOS code calls callable implementations through raw HTTP URLs, creating protocol/deployment ambiguity.
8. Connect status is cached but has no webhook-driven refresh.

## Production-safe target

1. Authenticated server `createJobQuote` computes price/fees and returns an expiring versioned quote.
2. `createJob` validates ownership/input and persists the immutable quote snapshot.
3. `createPaymentIntentForJob(jobId, quoteId)` derives amount/customer/payment metadata server-side and uses an idempotency key.
4. Web/iOS confirms payment with Stripe SDK only.
5. A verified webhook owns payment state reconciliation.
6. Request acceptance and completion commands derive the legitimate worker and payout from job/assignment/charge data.
7. Payout uses deterministic transfer group/idempotency keys and a state machine that can reconcile uncertain outcomes.
8. Connect Account Links/Dashboard Links derive the account from authenticated UID.

Secret keys, webhook signing secrets and Connect credentials remain backend-only. Client Firebase configuration and Stripe publishable keys can be public but should be environment-managed.
