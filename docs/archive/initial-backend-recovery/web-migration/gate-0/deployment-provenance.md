# Deployment provenance

## Recovered production facts

Read-only inventory on 2026-08-09 established:

| Property | Result | Confidence |
|---|---|---|
| Firebase project | `theoddjobsappnewyork` | Confirmed by `.firebaserc` and live APIs |
| Function count | 45 active | Confirmed live |
| Region | `us-central1` for all 45 | Confirmed live |
| Runtime | `nodejs20` for all 45 | Confirmed live |
| Platform | Cloud Functions first generation (`gcfv1`) | Confirmed live |
| Codebase | `default` | Confirmed live/local config |
| Current deployment interval | 2026-08-04T03:06:29.319681178Z–03:06:31.561072638Z | Confirmed live; all 45 updated within 2.25 seconds |
| Deployment label | `deployment-tool=cli-firebase` | Confirmed live |
| Deployment hashes | 43 endpoints: `72c06ad4…94ac`; two referral endpoints: `47cb97e6…51d1` | Confirmed live |
| Source repository/branch/commit | **UNKNOWN** | No source revision label or manifest |
| Actor/host/exact command | **UNKNOWN** | No current deployment audit artifact in Git |
| CI/CD | **UNKNOWN; no repository workflow found** | Absence of workflow is not proof of manual deployment |

The separate referral hash corresponds to `sendReferral` and `sendReferralEmail`, the only deployed functions declaring `GOOGLE_SERVICE_ACCOUNT_JSON` through Secret Manager. A shared Firebase function hash is not a Git commit or deployable-source archive digest.

## Available repository evidence

- `.firebaserc:1-4` provides the default project alias.
- `firebase.json:2-14` points only to `functions/`, codebase `default`.
- `functions/package.json:5-14` selects `index.js`, offers a Functions-only deploy script, and declares Node 20.
- No CI workflow, deployment shell script, release manifest, source-commit stamp, or production runbook was found.
- A local `functions/firebase-debug 2.log` records six attempted Firebase CLI deployments on 2025-05-12. Those attempts include build/runtime failures and isolated successful updates, predate the current deployment by more than a year, and do not identify the current source. The log also contains secret material and must be treated as a credential incident, not checked-in provenance.

## Parity evidence and limit

The deployed name set equals the unversioned 48-export source set minus three SMS exports. It also equals all 25 tracked exports plus 20 untracked admin exports. That is strong name-level evidence that the parent source is related to production, but it does not prove byte parity. In particular, deploying the current 48-export `index.js` without a selector should attempt to create the absent SMS functions.

## Read-only commands used

```sh
firebase functions:list --project theoddjobsappnewyork --json
firebase firestore:indexes --project theoddjobsappnewyork
```

Function update timestamps and rule bindings were read through the authenticated Firebase CLI's Google API clients using GET requests only and saved under `/tmp`. No source archive was downloaded and no cloud resource was changed.

## Required provenance record

Every future deployment must record project, environment, Git remote, full commit, dirty-state refusal, package-lock digest, packaged-source digest, function selection, Firebase CLI version, Node version, actor/workload identity, start/end time, result, and rollback target. Production deployment should run from a protected workflow with reviewed environment approval; local deploy credentials should not be the normal path.
