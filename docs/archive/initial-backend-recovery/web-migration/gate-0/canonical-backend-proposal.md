# Canonical backend proposal

## Decision

Make `backend/` on the existing OddJobs Git remote's protected `main` line the immediate authoritative deployment source. Recover into that tracked location through review; do not deploy from the unversioned parent directory. Reconsider a dedicated platform repository only after Gate 0, when history-preserving migration can be evaluated without mixing authority recovery with architecture change.

This choice minimizes maintenance now: the project already tracks `backend/`, has remote history and review workflow, and every iOS worktree resolves to the same backend snapshot. Creating a second repository during recovery would add another candidate authority.

## Proposed structure

```text
backend/
├── .firebaserc                     # named local/staging/production aliases; no secrets
├── firebase.json                   # Functions, Firestore, Storage, emulators
├── firestore.rules                 # exact recovered baseline, then reviewed changes
├── firestore.indexes.json          # exact eight-index baseline
├── storage.rules                   # exact recovered baseline
├── functions/
│   ├── index.js                    # preserve current CommonJS entry during recovery
│   ├── *.js                        # reconciled current modules; no behavior refactor in Gate 0
│   ├── package.json
│   └── package-lock.json
├── tests/
│   ├── rules/
│   ├── functions/
│   └── fixtures/
├── scripts/
│   ├── verify-project.sh
│   ├── inventory-production.sh     # GET/list only
│   ├── verify-deploy-parity.sh
│   └── verify-no-secrets.sh
└── docs/
    ├── deployment.md
    ├── rollback.md
    └── environment.md
```

Do not move the CommonJS files into a new `src/` hierarchy during recovery. First establish identical behavior and provenance; refactoring belongs to later, independently reviewable work.

## Ownership classification

| Material | Future status | Required handling |
|---|---|---|
| Tracked `backend/` on protected main | **Canonical destination** | Add recovered policy, indexes, verified admin source, tests, and deploy controls |
| Unversioned parent `/backend` | **Reference-only pending reconciliation** | Preserve read-only; selectively reconstruct reviewed source; never deploy wholesale |
| 25 existing tracked exports | **Canonical candidates** | Prove deployed content/config parity; retain behavior |
| 20 untracked/deployed admin exports | **Must recover** | Review and commit before any replacement deployment |
| 3 untracked/not-deployed SMS exports | **Quarantined** | Keep out of production entry point until consent/product/operations approval |
| Current deployed rules/indexes | **Production authority until approved baseline commit** | Preserve hashes/release IDs; copy exactly through review, then test |
| Vendored `functions/package/`, duplicate lockfile, `.DS_Store` | **Generated/accidental** | Remove in an isolated repository-hygiene commit after verifying package lock |
| Tracked `.runtimeconfig.json`, `.p8`, secret-bearing logs | **Security incident material** | Rotate first, retain only per incident policy, remove from source/history through approved process |
| `oddjobs-admin` | **Separate privileged application** | Do not import its server/admin code into consumer packages; reconcile admin schema/API contracts |
| Django `oddjob-web` | **Legacy/reference-only pending product decision** | Externalize/rotate credentials; preserve until hosting/content/contact ownership is decided |

## Deployment contract

Only a clean protected commit may deploy. The deploy job must verify the exact project/environment, compare live and desired function/policy inventories, refuse unexpected creates/deletes, run emulator tests, create immutable evidence, require environment approval, and record a rollback target. SMS must remain explicitly excluded until approved; absence must be tested so a future broad `--only functions` command cannot create it accidentally.

## What must not be deleted yet

Do not delete either backend copy, deployed functions, historical rulesets, deployed indexes, legacy Django, the admin application, or SMS source. First establish provenance, rotate exposed credentials, preserve incident evidence under the approved retention policy, and obtain owners for each archival decision.
