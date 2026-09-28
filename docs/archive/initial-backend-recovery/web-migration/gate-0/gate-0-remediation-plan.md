# Gate 0 remediation plan

Each step is independently reviewable. “Production required” means a deliberate cloud/security operation is necessary; it never authorizes that operation from this report.

| Step | Change / files | Risk | Validation | Rollback | Production required? |
|---:|---|---|---|---|---|
| 1 | Approve the existing Git remote and protected `main` as authority; create a Gate 0 branch. Record owners in `backend/docs/environment.md`. | Low | Clean branch, CODEOWNERS/review policy, project owner sign-off | Delete branch; no runtime effect | No |
| 2 | Re-run read-only inventory; retain exact Functions/rules/index manifests and release IDs as review artifacts. | Low | Two independent reviewers reproduce counts/hashes; no cloud audit writes | Discard temporary captures | No |
| 3 | Add exact recovered `backend/firestore.rules`, `firestore.indexes.json`, `storage.rules`; reference them in `firebase.json`. No semantic edits. | Medium | Byte-normalized hashes equal recovered baseline; a deployment preview shows no semantic change | Revert commit; production remains authority | No deployment during commit; later parity deployment yes |
| 4 | Add emulator-only project config, rules-unit-testing dependency, deterministic fixture helpers, and CI isolation. | Low | Emulator refuses production project IDs; clean install; no production access | Revert test/tooling commit | No |
| 5 | Implement the allow/deny baseline in `backend/tests/rules/` and minimal callable boundary tests. | Medium | All current-policy expectations pass; unsafe allows are labeled, not silently fixed | Revert tests; no runtime effect | No |
| 6 | Reconcile Function source: review/import 20 deployed admin exports; verify 25 tracked exports; quarantine 3 SMS exports outside the production entry point. Update `index.js`, package files, and an inventory manifest without behavior change. | High | 45 expected production exports exactly; zero unexpected creates/deletes; source package hashes and emulator smoke tests | Revert commit; preserve current production deployment | No until a separately approved parity deploy |
| 7 | Rotate exposed APNs, Stripe, notification-mail, Django/SMTP, and any affected webhook credentials. Remove tracked `.p8`/runtime config/logs; add ignore and secret scanning. Migrate legacy Functions config to managed secrets in behavior-neutral steps. | Critical | Old credentials revoked, new credentials scoped, smoke tests pass, no values in logs/Git, incident review complete | Time-bounded dual credential or provider-specific rollback key; documented per provider | **Yes — credential operations and Function secret rebinding** |
| 8 | Create protected deployment workflow and `backend/docs/deployment.md`: clean-commit enforcement, project confirmation, emulator gates, inventory diff, approval, evidence retention, deploy selector. | High | Staging rehearsal; production command preview; CI workload identity least privilege | Disable workflow and revert; local deploy remains prohibited | No for workflow; staging rehearsal yes |
| 9 | Create `backend/docs/rollback.md`: previous commit/artifact, policy ruleset IDs, index rollback limits, Function rollback/redeploy, secret rollback, operator/communications checklist. | Medium | Tabletop exercise in staging; recovery-time objective recorded | Revert document; no runtime effect | Staging only |
| 10 | Perform one approved no-behavior-change parity release from the canonical commit, explicitly limited to the 45 expected functions and recovered policy. Capture deployment manifest. | Critical | Pre/post live inventories identical in names/triggers; rules/index hashes match; smoke tests and logs clean | Redeploy recorded previous artifact/rulesets; invoke incident plan on partial failure | **Yes** |
| 11 | Gate review: approve canonical schemas and server-owned boundaries for identity/role, jobs/requests/slots, payment/withdrawal, verification, and admin. | Medium | Product/backend/iOS/web/security/finance sign-off; unresolved items assigned | Amend decision records; no runtime effect | No |
| 12 | Begin security refactors as separate vertical changes only after Steps 1–11 pass. | Critical | Contract, emulator, idempotency, iOS parity, staging, rollback tests per change | Per-feature rollback | **Yes, later** |

## Required ordering

Policy recovery precedes emulator tests; behavior-freeze tests precede Function reconciliation; credential rotation and source reconciliation precede the first canonical deployment. Security refactors must not be mixed into the parity deployment, because a rollback must be able to restore the currently observed behavior independently of later improvements.

## Gate 0 exit criteria

- One reviewed Git commit owns all 45 deployed Function sources and explicitly excludes/quarantines the three SMS exports.
- The current Firestore rules, Storage rules, and eight indexes are tracked, fingerprinted, and covered by deterministic emulator tests.
- Production deployments record Git/source provenance and run through protected approval.
- Secret-bearing tracked/local artifacts are rotated and removed according to incident policy.
- Rollback has been rehearsed in staging.
- Known client-trusted write boundaries have approved server-command remediation plans.

Until every criterion is met, transactional consumer-web implementation is **NO-GO**.
