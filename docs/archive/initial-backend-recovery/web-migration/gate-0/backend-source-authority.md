# Backend source authority

## Authority verdict

No current backend copy is both complete and version-controlled. The parent-level source is the most complete, but the Git-tracked snapshot is the only reviewable history. Neither may be declared production authority yet.

## Source-authority matrix

| Source | Git state | Functions | Configuration | Generated/local artifacts | Assessment |
|---|---|---:|---|---|---|
| `/Users/zachwilcox/Desktop/Projects/OddJobsNewYorkProduct/backend` | Parent and directory are not Git repositories | 48 exports | `.firebaserc` selects `theoddjobsappnewyork`; `firebase.json` deploys only codebase `default` from `functions` | 622 MB `node_modules`, vendored `package/`, duplicate lockfile, `.DS_Store`, runtime config, 1.1 MB Firebase debug log | Most complete source; evidence/reference only; unsafe deployment authority |
| `origin/main:backend` at `acd3b137916fdf318de3576591a4be66016e137a` | Tracked | 25 exports | Same project and functions-only config | 133 tracked files under vendored `functions/package`, tracked runtime config, duplicate lockfile, two `.DS_Store` files | Only canonical Git candidate; incomplete against production |
| Recovery worktree `recovery/ios-design-system-work` at `745ec8208ea5ad6ac221308ca78ef720c63b86cd` | Clean except documentation being authored | 25 exports | Byte-identical deployable source/config to other worktree copies | Same tracked artifacts | Safe place for this report; not a distinct backend authority |
| `main`, `design-system/phase-2a-clean`, `fix/xcode-duplicate-outputs`, `recovery/sms-consent-quarantine` worktrees | Mixed branch/worktree status | 25 exports each | Aggregate deployable-source fingerprint identical across all five inspected worktree copies | Same tracked artifacts | Duplicated checkouts of one historical snapshot, not independent sources |
| Original `apps/iOS` worktree, `design-system/phase-2a` at `9ed54ebc…` | Heavily dirty; tracked backend is deleted from its working tree | 0 present / 25 in `HEAD` | Deleted in working tree | Deletions are unapproved | Never use for backend recovery or deployment |
| `apps/Web/oddjobs-admin` | Separate Git repository, `main` at `cc0ad84…`; one unrelated untracked duplicate page | No Function deployment source | Local ignored `.env.local`; Firebase client/Admin SDK adapters | Next build artifacts excluded from inspection | Privileged consumer and schema evidence only |
| `apps/Web/oddjob-web` | Not a Git repository | Django marketing/contact backend, not Firebase Functions | Plaintext Django/SMTP configuration | Vendored static assets | Legacy/reference-only; separate credential incident |

The aggregate SHA-256 over deployable JS/package/Firebase config is `f5f2e581…d33d7` for every inspected Git-worktree copy and `f73ad3ec…ebf` for the 48-export parent source. These hashes prove local copies differ; they do not prove either is deployed.

## Exact source difference

The tracked source contains these modules and 25 exports:

- `payments.js` — 14
- `userRegistration.js` — 4
- `referrals.js` — 3
- `notifications.js` — 2
- `connections.js` — 1
- `jobAlerts.js` — 1

The unversioned parent source adds:

- `adminActivity.js` — 12 deployed triggers
- `adminData.js` — 7 deployed callables
- `adminDiscordNotifications.js` — 1 deployed trigger
- `smsNotifications.js` — 3 exports not found in production
- `README.md` — Twilio configuration notes

The common application modules are byte-identical between the tracked and parent copies. `index.js`, `package.json`, and `package-lock.json` differ because the parent copy exports the additional modules and adds Twilio/Nodemailer dependencies.

## History and deployment fitness

- The last tracked backend source change is commit `9ed54ebc27bad9ad922a419323885257af415b5c` (2026-04-05). Later `origin/main` merges do not change `backend/`.
- No Git history exists for the 20 deployed admin exports or the three SMS exports.
- `backend/firebase.json:2-14` contains Functions only; it cannot deploy rules or indexes.
- `backend/functions/package.json:10` offers only `firebase deploy --only functions` and embeds no commit/build manifest.
- Tracked runtime config and vendored dependencies make a clean source checkout non-hermetic and expose credential risk.

## Decision

Use the tracked `backend/` directory on `origin/main` as the **destination for recovery**, not as proof of current production. Preserve the unversioned parent backend read-only until its 48 exports are classified and the 45 deployed endpoints are reconciled. Do not merge or copy it wholesale: the SMS source is not deployed, generated artifacts must be excluded, and deployed code identity is still unknown.
