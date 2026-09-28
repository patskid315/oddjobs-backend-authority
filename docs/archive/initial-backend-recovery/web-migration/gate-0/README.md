# Gate 0 — backend authority and safety

Audit date: 2026-08-09

Firebase project: `theoddjobsappnewyork`

Method: repository inspection plus read-only Firebase/Google Rules API inventory. No deployment, application-data read or write, policy change, Function change, or package installation occurred.

## Verdict

| Gate | Verdict | Reason |
|---|---|---|
| Backend authority | **NO-GO** | The most complete 48-export source tree is outside Git. The tracked tree has 25 exports, while production has 45 active functions. No deployed Git commit is recorded. |
| Deployment provenance | **PARTIAL / commit UNKNOWN** | Project, runtime, region, deployment tool label, deployment interval, function names, and deployment hashes were recovered. Source repository, branch, commit, actor, and command are not provable. |
| Rules and indexes | **RECOVERED, NOT AUTHORITATIVE IN GIT** | Deployed Firestore rules, Storage rules, and eight composite indexes were retrieved read-only to `/tmp`; no corresponding source is tracked or referenced by `firebase.json`. |
| Emulator readiness | **NO-GO** | There is no canonical policy source, emulator configuration, or rules test harness. |
| Read-only consumer-web development | **CONDITIONAL GO** | Local/emulator-only shell and typed read adapters may proceed after copying policy through an approved review. Public deployment still requires field/privacy review and rules tests. |
| Transactional consumer-web development | **NO-GO** | Several deployed rules authorize client-controlled financial, role-adjacent, assignment, notification, review, and workflow mutations. |

## Evidence summary

- All Git-worktree backend snapshots inspected are byte-identical for deployable source/config and export 25 functions.
- `/Users/zachwilcox/Desktop/Projects/OddJobsNewYorkProduct/backend` exports 48 functions, but neither it nor the parent product directory is a Git repository.
- Production exposes 45 active first-generation functions, all `nodejs20` in `us-central1`. Their update times span 2026-08-04T03:06:29.319681178Z through 2026-08-04T03:06:31.561072638Z.
- The 45 deployed names equal the 48-export source set minus the three SMS exports. Twenty deployed admin functions have no tracked source.
- Firestore rules were last bound to the current ruleset on 2026-05-30; Storage rules on 2026-01-06. Eight Firestore composite indexes are deployed.
- The repository contains tracked secret-bearing artifacts. Secret values are intentionally omitted from every Gate 0 document.

## Documents

- [Backend source authority](backend-source-authority.md)
- [Deployment provenance](deployment-provenance.md)
- [Firebase policy authority](firebase-policy-authority.md)
- [Function parity](function-parity.md)
- [Environment and secrets](environment-and-secrets.md)
- [Security-policy coverage](security-policy-coverage.md)
- [Emulator test plan](emulator-test-plan.md)
- [Canonical backend proposal](canonical-backend-proposal.md)
- [Gate 0 remediation plan](gate-0-remediation-plan.md)

## Hard stop

Do not deploy Functions or policy from either local backend copy. Do not begin transactional web features until the remediation exit criteria are met. Preserve every backend copy as evidence until deployed source and policy are committed, reviewed, tested, and tied to a reproducible deployment.
