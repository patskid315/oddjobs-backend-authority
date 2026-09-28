# Shared business rules

## Rules that must gain one authoritative owner

| Rule | Current implementation | Server validation observed | Web needs it | Recommended owner |
|---|---|---|---|---|
| Worker vs Poster selection | iOS `ProfileSetupViewModel`; `users.lookingFor` | Referral checks role string; waitlist trusts payload | Yes | Server account-mode command + canonical enum |
| Worker active capacity | Function hard-codes 100; iOS calls two-step decision/stats | Partial, non-atomic | Yes | Transactional server command/config document |
| NYC eligibility | iOS geocoder + `NeighborhoodLocator`; address payload | Function checks only one of five borough strings | Yes | Server normalized location/eligibility service |
| Onboarding progression | Multiple iOS ViewModels write `onboardingStep` | NYC function sets completed, but client can also do so | Yes | Server transition policy; client owns drafts only |
| Account status / deletion | iOS writes `accountStatus=deleted`; login checks it | Not consistently checked by Functions | Yes | Auth/account service with token revocation |
| Adult confirmation | iOS requires `isConfirmed=true` and writes it | None found | Yes | Server profile validation plus legal/product policy |
| Verification submission/decision | iOS uploads images and writes status document | None found for moderation decision | Yes | Separate submission command and admin decision command |
| Job pricing | iOS clamps ranges and computes duration/subtotal | None | Yes | Server price quote + create-job command |
| Poster platform fee | iOS applies 10% | None | Yes | Server versioned pricing policy |
| Worker platform fee | Standard iOS payment sets worker cut to 95% of base | Payout trusts stored cut | Yes | Server settlement policy |
| Research pricing | iOS uses cents, 10% poster fee, no observed 5% worker deduction | Payout trusts stored amount | Yes | Server research quote/settlement policy |
| Promo validation/redemption | iOS reads `promoCodes` and computes discount | Payout special-cases one code/zero charge | Yes | Server redemption transaction and usage ledger |
| Job creation/ownership | iOS uploads and writes job/payment docs | Triggers observe result only | Yes | Authenticated create-job command |
| Job visibility/discovery | iOS queries/filtering | Rules unavailable | Yes | Shared query specification + rules/indexes |
| Request eligibility | iOS creates requests | None found | Yes | Server create-request command |
| Accept/reject request | iOS Firestore transaction | Local status checks only | Yes | Server transition command deriving poster/worker |
| Research slot capacity | iOS transaction checks open slot | No server command | Yes | Server assignment transaction |
| Start/completion transitions | iOS writes job/request/slot statuses | Triggers react after writes | Yes | Server state machine commands |
| Payout eligibility/amount | iOS writes recipient/workerCut and completion | Trigger checks transition/payment status | Yes | Server recomputation from immutable quote/charge |
| Review eligibility | iOS completion/review ViewModels | None found | Yes | Server one-review-per-completed-assignment command |
| Connection eligibility | completion trigger derives poster/worker | Yes, after trusted job state | Yes | Keep trigger after completion becomes server-owned |
| Referral eligibility/dedupe | Functions check Poster, connection and deterministic IDs | Yes | Yes | Existing referral Functions |
| Message participation | deterministic conversation ID in iOS | Rules unavailable | Yes | Rules + optional server conversation command |
| Comment author/mentions | iOS writes author/profile fields and recipients | Trigger consumes comment | Yes | Server-derived author or strict rules; one notification producer |
| Notification routing/preferences | iOS and Functions choose recipients/types | Partial; push ignores prefs | Yes | Server notification event policy + channel adapters |
| SMS matching | Function matches exact borough/category and consent fields | Yes | Indirectly | Existing Function with scalable query strategy |

## Pricing facts

- Standard posting fee: 10% of base (`subTotal * 0.10`).
- Standard worker cut: 95% of base, implying a 5% worker/completion-side platform deduction.
- Without a discount, `platformProfit = totalCharged - workerCut`, or 15% of base before Stripe costs.
- Research: 10% poster fee per participant; the accepted-slot payment stores worker cut equal to pay per participant, so no 5% worker deduction was observed.
- Promo types: full discount, percent off capped to 0–100, and fixed amount capped at the total.
- `NEIGHBORS2026`, any zero total, or `paymentSkipped` results in no Stripe payout and recorded earnings behavior.

These are observed implementation facts, not approved policy. The standard/research inconsistency and treatment of platform fees under discounts require product/finance review before encoding a shared rule.

## State-machine recommendation

Define versioned transition functions that accept intent, not arbitrary destination state. For example, `acceptJobRequest(requestId)` derives caller, job, worker, payment quote and legal next state. Store transition actor, source version, timestamp and idempotency key. Both iOS and web consume the same command/result contract.
