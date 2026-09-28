# Web migration matrix

| Domain | Capability | Current iOS implementation | Backend / Firebase | Web? | Reuse | Required work | Security concern | Order |
|---|---|---|---|---|---|---|---|---|
| Platform | Session/config shell | App lifecycle + Firebase SDK | Firebase project | Yes | Adapter | Environment matrix, error/telemetry baseline | Prevent server secrets in client | 1 |
| Design | Tokens/assets | Swift constants/assets + design-system files | none | Yes | Adapt | Generate typed web tokens/assets from one source | Licensing/accessibility review | 1 |
| Auth | Signup/login/reset/logout | Auth/ViewModels direct Firebase | Auth trigger; `users` | Yes | Refactor | Web auth adapter, server session, account-state gate | Rules/status enforcement unknown | 2 |
| Onboarding | Basic account/profile | Direct user/Storage writes | waitlist/stats callables | Yes | Refactor | Server-owned profile/mode transition | Client role/status changes | 2 |
| Location | NYC address eligibility | CLGeocoder + `NeighborhoodLocator` | borough-only finalizer | Yes | Refactor | Server normalized location result | Client can submit borough string | 2 |
| Verification | Submit/skip/review | Direct Storage/user meta writes | update queue/admin | Yes | Refactor | Submission vs decision contract | Sensitive images and client status | 2 |
| Users | Profile read/edit/delete | ViewModels direct Firestore | `users`, Storage | Yes | Adapter/refactor | Read repository; sensitive edits/deletion commands | Rule and account-state gaps | 3 |
| Jobs | Browse/list/filter | ViewModels query Firestore | `jobPost`; SMS/admin triggers | Yes | Adapter | Typed query repository/indexes | Visibility rules unknown | 3 |
| Jobs | Job detail/share | ViewModels + direct reads | `jobPost`, payment/user reads; Django `/j` | Yes | Adapter | Public/auth view policy, SSR share metadata | Address/privacy exposure | 3 |
| Jobs | Create standard job | `JobPostViewModel`/service direct writes | no command; `jobPost`, `payments`, Storage | Yes | Refactor | Quote + upload + create command | Client price/owner/payment | 4 |
| Research | Create study/slots | Research ViewModels direct writes | slot payout trigger | Yes | Refactor | Research quote/create/slot commands | Fee inconsistency and client state | 4 |
| Promotions | Apply code | Direct promo read/calculation | `promoCodes` | Yes | Refactor | Server redemption and usage record | Client discount manipulation | 4 |
| Requests | Apply | Direct `jobRequests`/notification write | admin trigger | Yes | Refactor | Authenticated create-request command | Sender/receiver/eligibility | 5 |
| Requests | Accept/reject | Client Firestore transaction + Stripe | no command | Yes | Refactor | Server assignment/rejection state machine | Ownership/payment/slot race | 5 |
| Active jobs | Start work | Direct job/request/slot update | SMS/admin triggers | Yes | Refactor | `startJob` command | Arbitrary status transition | 6 |
| Completion | Complete standard job | Client payment/job changes | payout/connection triggers | Yes | Refactor | Completion command + settlement orchestration | Transfer derives client data | 6 |
| Research | Complete participant/closeout | Client slot/job changes | slot payout trigger | Yes | Refactor | Slot completion/closeout commands | Same payout/state risks | 6 |
| Payments | Save/list cards | `StripeService` + PaymentSheet | unsafe Stripe endpoints | Yes | Security review | Auth-scope endpoints; Stripe.js adapter | Arbitrary customer/payment method | 4, before jobs |
| Payments | Charge Poster | client amount to PaymentIntent | unsafe callable | Yes | Security review | Server derives amount from quote/job | Client amount/currency | 4 |
| Payouts | Worker Connect/balance | `StripeService` | connected account/balance callables | Yes | Adapter after hardening | Web redirects/status repository | User/account link scoping | 4 |
| Payouts | Release/retry | completion triggers/scheduler | Stripe Transfers | Indirect | Security review | Idempotency, webhook reconciliation | Duplicate/wrong payout | 4–6 |
| Messaging | Conversations/chat | direct listeners/writes | Firestore only | Yes | Refactor | Participant rules, repository, send command decision | Sender/participant spoofing | 7 |
| Comments | Comments/mentions | direct batch + notifications | trigger also creates notifications | Yes | Refactor | Canonical send/comment event path | Duplicate/spoofed recipients | 7 |
| Notifications | In-app list/read | Firestore listeners/direct updates | notification docs | Yes | Adapter | Typed repository and read command/rules | Recipient access | 7 |
| Notifications | Push/SMS/email | AppDelegate + Functions | FCM/APNs/Twilio/Gmail | Yes | Refactor delivery | Device/channel registry, prefs, web push | Consent/rate/privacy | 7 |
| Reviews | Create/read review | direct Firestore | admin reads | Yes | Refactor | Eligibility command; read repository | Fake/duplicate reviews | 8 |
| Referrals | Past workers/invites | callable service | referral Functions | Yes | Adapter | Typed client + abuse limits | Direct email endpoint cleanup | 8 |
| Admin | Operational console | separate Next.js app | Admin SDK + admin callables | Existing | Separate | Reconcile auth/role schema and source control | Privileged boundary | Parallel gate |
| Marketing | Legal/content/contact/share | Django templates/endpoints | SMTP | Yes | Evaluate | Keep or replace independently of app | Committed secrets/anonymous abuse | Parallel gate |

## Ordering interpretation

Order is dependency-based, not a promise to expose each feature immediately. Payment hardening is scheduled before transactional job workflows even if the first UI slice is browse-only. Messaging and notifications follow account/job/request ownership contracts so their authorization can reference stable domain relationships.
