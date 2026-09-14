# Firebase Emulator test report

Date: 2026-09-13  
Environment: local Firestore Emulator, isolated project `oddjobs-gate5-test`  
Result: **26 passed, 0 failed, 0 skipped**

Verified cases:

1. Completion creates exactly one pending settlement.
2. Duplicate completion events converge on one obligation.
3. Repeated completed updates are ignored.
4. Concurrent leases have one winner.
5. An expired lease can be reclaimed.
6. An active lease cannot be stolen.
7. An unauthorized client cannot mutate settlement state.
8. Cancelled jobs are blocked.
9. Refunded payments are blocked.
10. Disputed payments are blocked.
11. Worker mismatch is blocked.
12. Destination mismatch is blocked.
13. Amount mismatch is blocked.
14. Missing payment cannot create an obligation.
15. Failed payment is ineligible.
16. A valid succeeded payment is eligible.
17. A processing record left by a crash becomes recoverable only after lease expiry.
18. Stripe event metadata is persisted durably without raw payload storage.
19. A processed Stripe event returns its prior result on replay.
20. An active Stripe-event processing lease cannot be stolen.
21. An expired Stripe-event lease resumes safely after a crash.
22. A failed Stripe event requires an explicit deliberate retry.
23. An unauthorized client cannot mutate Stripe-event state.
24. Future V2 clients cannot modify payment settlement outcomes.
25. Future V2 clients cannot modify withdrawal outcomes.
26. Future V2 clients cannot modify balance authority.

The final run completed successfully. Emulator logs are generated artifacts and are Git-ignored.
