# iOS to backend dependencies

## Actual dependency shape

The project has useful ViewModel and Service types, but it does not consistently implement repository boundaries. Firebase SDK calls occur in the app delegate, components, Views, ViewModels, Services and even model helpers.

```text
SwiftUI View
├── sometimes → ViewModel → Firestore / Auth / Functions / Stripe
├── sometimes → ViewModel → Service → Firebase
└── sometimes → Firebase directly
```

Representative direct-Firebase presentation files include profile/payment screens, main/feed screens, job detail/footer, request/completion screens, comments/mentions, notifications, messages, and onboarding views. Components such as `NotificationRow` and `CommentAvatar` also read/write backend data.

## Representative traces

| User journey | Actual path | Architectural observation |
|---|---|---|
| Signup | `SignUpView` → `SignUpViewModel` → Firebase Auth + direct `users/{uid}` transaction | No backend signup/profile command |
| Login/session | `LoginView` → `LoginViewModel` → `AuthService` → Auth + Firestore; `SessionRouter` separately re-reads user | Client routes by mutable profile state |
| Profile type | `ProfileSetupView` → `ProfileSetupViewModel` → Storage + waitlist callable + direct user write + stats callable | Multi-system update is non-atomic |
| Address | `AddressInputView` → `AddressViewModel` → CLGeocoder/NeighborhoodLocator → direct user write → NYC callable | Server receives only client-derived borough |
| Identity | `VerifyIdentityView` → `VerifyIdentityViewModel` → Storage + direct verification/user writes | Sensitive status/data rule-dependent |
| Standard post | posting Views → `JobPostViewModel` → `JobPostService`/`StorageService` → Storage + direct `jobPost` → direct `payments` | Price, fees, promo and worker cut are client-computed |
| Research post | research Views → `ResearchPostViewModel`/`JobPostService` → Storage + direct job/slot/payment writes | Parallel pricing/state implementation |
| Browse/detail | main/category/detail Views → ViewModels → direct job/user/payment queries | Suitable for repository extraction; rules still required |
| Apply | job detail/footer → request ViewModel/service → direct `jobRequests` + notifications | Identity and transition authorization depend on rules |
| Accept request | request screen → `JobRequestViewModel` → Firestore transaction over request/job or slot → Stripe PaymentSheet → payment record | High-risk command belongs server-side |
| Start work | detail/active views → `JobDetailViewModel`/completion ViewModels → direct job/request/slot updates | State-machine enforcement is client-side |
| Complete/pay | completion/review ViewModels → direct payment/job/slot changes → payout trigger → Stripe Transfer | Trigger trusts client-created payment fields |
| Message | message/chat Views → `MessagesViewModel` → direct conversation/message writes/listeners | Extract repository; prove participant rules |
| Comment | comments Views → `CommentsViewModel` → direct comment/commenter batch + client notifications; trigger also observes comment | Duplicate notification producer |
| Notifications | `AppDelegate` → FCM token → direct user write; ViewModels listen/read; rows mark read | Token model is iOS/single-device oriented |
| Referral | referral view/ViewModel → `ReferralService` → `fetchEligibleWorkers`/`sendReferral` callables | Good candidate for a web adapter |
| Stripe account | profile/job gates → `StripeService` → callables and hard-coded Function URLs | Mixed protocol and insufficient endpoint auth |

## Callable Function usage found in iOS

`createConnectedAccount`, `getStripeBalance`, `createEphemeralKey`, `createSetupIntent`, `createPaymentIntent`, `getDefaultPaymentMethod`, `decideWaitlistOnProfileSetup`, `updateWorkerStatsOnSignup`, `finalizeNYCOnboarding`, `fetchEligibleWorkers`, `sendReferral`, and `upsertJobConnection` are referenced. The last has no matching audited backend export.

HTTP calls in `StripeService` directly target deployed URLs for payment methods, detach, Account Link and Dashboard Link. The code calls `detachPaymentMethod` as HTTP even though the available backend declares it callable, which should be reconciled against the deployed function before migration.

## Proposed extraction boundary

For each domain, keep UI state in a ViewModel-style controller and introduce a protocol-backed repository. Do not initially rewrite all iOS code. Extract one vertical slice as its web capability is prepared:

```text
React/SwiftUI view
→ controller/hook or ViewModel
→ domain use case
→ repository interface
→ Firebase read repository OR authenticated command client
→ Firestore/Storage/Function
```

Live listeners and read-only queries can remain Firebase client operations once rules tests prove access. Pricing, ownership, role, state transition, payment, verification and moderation mutations should be server commands.
