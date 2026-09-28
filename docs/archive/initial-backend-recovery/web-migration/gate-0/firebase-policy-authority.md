# Firebase policy and index authority

## Repository finding

No `firestore.rules`, `firestore.indexes.json`, `storage.rules`, or `database.rules.json` exists in the inspected product workspace or iOS Git worktrees. No rules tests exist. `backend/firebase.json` declares only Functions, so no policy file is deployable from the repository.

## Read-only production recovery

The current bindings were retrieved to `/tmp` without overwriting repository files or changing Firebase.

| Artifact | Current production identity | Last update | SHA-256 of retrieved canonical content |
|---|---|---|---|
| Firestore rules | ruleset `a801a0a5-f6af-4041-bbb5-aaf5f5d52c57` | 2026-05-30T03:38:44.600778Z | `326738f1d43732f506bafc174bb266d5adcd8d9f7502e660ee24b940bd30c96b` |
| Storage rules | ruleset `4592e126-2f0f-4d33-bf49-f5fd68a16635` | 2026-01-06T03:18:42.336029Z | `d8441aa6a21330dee819eefc32e4ae6ac6ef2e89360f9b0814ce50d071c6c014` |
| Firestore indexes | eight composite indexes | API does not expose deployment time through this CLI command | `2297b4daed003e02cbc47b448060e755d9bca44bd3e3291ceea7fe55d26f56ce` |

Temporary files are comparison evidence only. They are not approved canonical source and must not be deployed directly.

## Deployed composite indexes

| Collection | Fields |
|---|---|
| `jobPost` | `category ASC`, `progressStatus ASC`, `timestamp DESC` |
| `jobPost` | `progressStatus ASC`, `timestamp DESC` |
| `jobPost` | `userId ASC`, `timestamp DESC` |
| `notifications` | `receiverID ASC`, `timestamp DESC` |
| `payments` | `recipientId ASC`, `createdAt DESC` |
| `payments` | `senderId ASC`, `createdAt DESC` |
| `slots` | `status ASC`, `slotIndex ASC` |
| `withdraws` | `userId ASC`, `timestamp DESC` |

There are no field overrides. Absence of a composite index for another collection is not by itself a defect because single-field indexes may suffice; query contract tests must determine coverage.

## Safe repeatable inspection

Indexes and functions have first-class read-only CLI commands:

```sh
firebase firestore:indexes --project theoddjobsappnewyork > /tmp/oddjobs-firestore-indexes.json
firebase functions:list --project theoddjobsappnewyork --json > /tmp/oddjobs-functions.json
```

Firebase CLI 13.33.0 exposes no read-only Firestore/Storage rules download command. Use a read-only IAM principal with the Google Firebase Rules REST API:

```sh
curl --fail --silent --show-error \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  "https://firebaserules.googleapis.com/v1/projects/theoddjobsappnewyork/releases" \
  > /tmp/oddjobs-rules-releases.json

curl --fail --silent --show-error \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  "https://firebaserules.googleapis.com/v1/projects/theoddjobsappnewyork/rulesets/RULESET_ID" \
  > /tmp/oddjobs-ruleset.json
```

Never echo or commit the access token. Obtain it through the approved credential workflow, restrict IAM to ruleset/release read, use the ruleset IDs from the release response, verify content hashes, then delete temporary credentials and captures after review.

## Authority gap

The deployed policies are now observable but still not reviewable source. Gate 0 must copy the exact retrieved content into a reviewed branch, add `firestore`, `storage`, and emulator sections to `firebase.json`, add the eight indexes, prove byte/fingerprint parity, and explicitly approve the first source-controlled policy deployment. Until then, production remains the only policy authority and rollback depends on console/API history rather than Git.
