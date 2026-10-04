# Verified home and onboarding authority

This slice is implemented source, not deployed evidence. Gate 6 remains NOT PROVEN DEPLOYED.

## Recovered behavior and explicit differences

The recovered `production-baseline/functions/userRegistration.js:142` finalizer authenticated the caller, trusted `selectedBorough` membership, wrote `users/{uid}.onboardingStep = completed`, mapped queued status to queued and all other statuses to active, and set NYC/onboarded/waitlist custom claims. An invalid borough marked the user restricted/completed and replaced claims with out_of_area.

The maintained `functions/src/v2/homeLocation.js` preserves authentication, queued-versus-active mapping, successful response shape, borough/profile timestamp writes, and intended NYC/waitlist claims. Authorized hardening requires verified owner-bound saved-home evidence. Compatibility `selectedBorough` is ignored. Missing/foreign/unverified evidence returns a bounded `v2_home_location` reason and does not mutate profile or claims; it no longer marks a failed attempt completed/restricted. Successful finalization preserves unrelated existing custom claims and clears the obsolete out_of_area claim instead of replacing all claims. Identity approval is not introduced as an eligibility requirement: existing submit/skip semantics remain intact.

Auth claim updates and Firestore writes cannot be one atomic transaction. Evidence is checked before either; a later service failure may leave verified authorization granted while the profile write is pending. The same finalization is safely repeatable. Unverified users receive no authorization. Existing completed users are not inspected/migrated/revoked at login. Old clients attempting NEW finalization without verified-home evidence will receive a failure; activation requires the updated onboarding client.

## Private home link

`v2SavedHomeLocation` accepts `{operation: "get"}` or `{operation: "set", protected_ref}`. Auth supplies the owner. Both paths validate the protected record's owner/ref, existing geography provenance, and exact-address digest. `set` writes only `{schema_version:1, owner_ref, protected_ref}` to `v2SavedHomeLocations/{uid}`. Exact address remains solely in `v2ProtectedLocations`; an authenticated owner-only read returns the bounded receipt and address for display/reuse. Neither private collection permits direct client reads/writes. No historical profile address becomes evidence.

Protected records remain immutable identities. Changing the home link changes future choices only. Publication uses the chosen protected reference, revalidates its owner through existing T01 authority, and keeps pending publication payloads unchanged. No publication authority code is changed.

## Client flow

Signup retains authenticated resumable accounts, existing MapKit suggestions, and SuggestionsPopover. Its ViewModel uses the same protected-location repository and server equivalence/correction policy as posting; no second validator/normalizer exists. Address edits clear prior errors; unchanged retries preserve the command, material edits create a new identity. Corrections require explicit acceptance and a subsequent verification; units remain separate and retained. After verification, save the home link and advance to verifyIdentity. Both identity submit and skip call the finalization repository, refresh Auth claims, and navigate only after success. Failures preserve the account and resumable step.

The V2 posting location step offers My address / Somewhere else. Saved owner addresses display through the existing presentation formatter and reuse the immutable protected receipt. Manual entry keeps existing verification/correction behavior. Users without a verified home are directed to manual entry. No normalizer, provider request, photo, marketplace or payment contract is changed.

## Rules and activation

Rules prohibit creating a completed profile and transitioning incomplete -> completed, including the account-deletion update branch. Legitimate incomplete steps and unrelated edits on existing completed profiles remain allowed. Completion authorization in Storage/Firestore still comes from server Auth claims, not profile claims-looking fields. Admin finalization bypasses client rules as intended.

Only `functions:v2SavedHomeLocation`, `functions:finalizeNYCOnboarding`, and `firestore:rules` need separately authorized deployment; do not deploy recovered neighboring functions. The release guard pins the newly tested rules digest and explicitly allows only the two added callable exports. The recovered production baseline remains unchanged. No new secrets/configuration/indexes are needed. No deployment or production data mutation was performed.

Manual E2E: create account and resume address step; select suggested numbered NYC address with unit; verify harmless abbreviation passes, wrong/material address offers explicit correction, cancel retains input, acceptance verifies again. Failed A -> edited B must clear old error and verify B. Submit or skip identity and verify completion. Relaunch: existing users retain access. Post using My address; verify owner summary/unit and publication; edit home for a future job and confirm the old job and a pending retry keep the original reference. Somewhere else must use the unchanged manual flow. An existing user without home sees manual entry, never a fabricated verified home.
