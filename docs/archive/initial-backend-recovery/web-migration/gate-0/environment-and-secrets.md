# Environment and secrets

No credential value is reproduced here. Presence, key name, storage mechanism, and remediation status only are recorded.

## Inventory

| System | Names / references | Location or mechanism | Status |
|---|---|---|---|
| Firebase project | default project alias | `backend/.firebaserc` | Tracked, production-specific; needs explicit staging/production aliases |
| Firebase client | project/app/API/messaging/storage identifiers | tracked `GoogleService-Info.plist` | Expected client configuration, but production coupling needs environment contract |
| Firebase runtime | `FIREBASE_CONFIG`, `GCLOUD_PROJECT`, `EVENTARC_CLOUD_EVENT_SOURCE` | platform-injected environment | Expected; not secrets |
| Firebase Admin for referrals | `GOOGLE_SERVICE_ACCOUNT_JSON` | deployed Secret Manager binding on `sendReferral` and `sendReferralEmail`; source `referrals.js:15,299,510` | Managed secret, but JSON service-account scope/rotation must be reviewed |
| Stripe server | `stripe.mode`, `stripe.test.secret`, `stripe.live.secret` | deployed legacy Functions runtime config; `payments.js:11-20` | Secret-bearing; migrate from deprecated runtime config to Secret Manager |
| Stripe local snapshots | legacy `stripe.secret`; newer `stripe.mode` and `stripe.test.secret` | tracked and untracked `.runtimeconfig.json` files | **Credential exposure. Rotate, remove from Git/history/local deployment copies** |
| Stripe iOS | test/live publishable keys | tracked `OddJobs New York/AppDelegate.swift:39-41` | Publishable, not secret; hard-coded environment selection is fragile |
| Notification email | `notify.email`, `notify.password` | deployed legacy runtime config; `jobAlerts.js:11-12` | Password-bearing; migrate and rotate |
| Referral email | `GOOGLE_SERVICE_ACCOUNT_JSON` | Secret Manager, Gmail API | Separate mail credential path; document owner/scope |
| Discord | `discord.admin_alerts_url`, `discord.job_activity_url`, `discord.payment_alerts_url`, `discord.system_logs_url`, `discord.user_activity_url` | deployed legacy runtime config; `adminDiscordNotifications.js:6` | Webhook secrets; migrate to Secret Manager and rotate if exposure is suspected |
| Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_MESSAGING_SERVICE_SID`; legacy `twilio.*` fallbacks | source-only `smsNotifications.js:14-20` | No deployed Twilio config keys found; functions absent from production; keep disabled |
| Admin web Firebase client | `NEXT_PUBLIC_FIREBASE_*` | ignored `apps/Web/oddjobs-admin/.env.local` | Local-only client config; define managed deployment environment |
| Admin web Firebase Admin | `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | ignored `.env.local`; `src/lib/firebaseAdmin.ts` | Server secret; verify host secret store and rotation |
| Django | `SECRET_KEY`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD` | plaintext `apps/Web/oddjob-web/oddjobsproj/settings.py` | **Credential exposure in unversioned deployment/reference copy; rotate and externalize** |
| APNs | Apple `.p8` signing key | tracked `AuthKey_9SKS66HQ9J.p8`, introduced in commit `260e4f8` | **Critical credential exposure; revoke/rotate and remove from current Git/history** |
| Mapbox | access token | tracked `OddJobs-New-York-Info.plist` | Determine public/restricted token class; apply bundle/domain restrictions |
| Local Firebase deploy log | runtime configuration and deployment API payloads | unversioned parent `functions/firebase-debug 2.log` | **Contains secret material. Secure/delete after evidence retention and rotate affected credentials** |

## Deployed runtime configuration names

Read-only inventory found these legacy runtime-config keys: five Discord webhook keys, `notify.email`, `notify.password`, `stripe.mode`, `stripe.test.secret`, and `stripe.live.secret`. Only `GOOGLE_SERVICE_ACCOUNT_JSON` appears as a deployed Secret Manager binding. No deployed Twilio keys were found.

## Configuration drift

- The tracked runtime snapshot uses the old `stripe.secret` shape, while current source chooses `stripe.test.secret` or `stripe.live.secret` based on `stripe.mode`.
- The unversioned parent snapshot has test-mode keys but is not a complete production configuration record.
- No checked-in environment schema states which values are required per local, emulator, staging, and production environment.
- Admin authorization uses more than one data convention (`active` in Functions versus a separately audited `status` convention in the admin app). This is a policy-contract issue, not merely configuration.

## Required remediation

1. Immediately revoke/rotate the tracked APNs key and every credential present in tracked runtime config or the Firebase debug log. Rotate Django/SMTP credentials in the legacy copy.
2. Add ignore rules for `.runtimeconfig.json`, Firebase debug logs, `.p8`, `.env*`, and local emulator state; remove tracked copies through reviewed commits. Decide separately whether a Git history rewrite is required.
3. Run an approved full-history secret scan without printing values into build logs.
4. Define a names-only environment schema and validate required keys at startup.
5. Migrate Stripe, notification mail, and Discord credentials from `functions.config()` to managed secrets before refactoring behavior. Keep Twilio absent/disabled until consent and product approval.
6. Use distinct local/emulator, staging, and production projects/aliases; require explicit environment and project confirmation before deployment.

Rotation and removal are production-impacting security operations and need an owner, maintenance plan, rollback credential, and post-rotation verification. They were not performed in this audit.
