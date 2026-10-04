# Environment contract (names only)

Observed process environment names: `GCLOUD_PROJECT`, `GOOGLE_SERVICE_ACCOUNT_JSON`.

Observed legacy Runtime Config names: `discord`, `notify.email`, `notify.password`, `stripe.mode`, `stripe.live.secret`, `stripe.test.secret`.

Observed Secret Manager names: `GOOGLE_SERVICE_ACCOUNT_JSON`.

V2 funding declares two future Secret Manager bindings by name only:

- `STRIPE_SECRET_KEY`: the Stripe platform API secret for the explicitly selected environment.
- `STRIPE_WEBHOOK_SECRET`: the signing secret for the dedicated `v2FundingWebhook` endpoint in that same environment.

Both are required server-side and fail closed when missing or malformed. They must
belong to the same Stripe mode/account; test and live values must never be mixed.
No value is configured, read from a local file, or committed by this implementation.
Legacy Runtime Config is not a fallback for V2 funding.

Values are intentionally excluded. Migration must replace legacy Runtime Config with Secret Manager references and least-privilege service identity.


## V2 safety operator configuration

`ODDJOBS_V2_SAFETY_OPERATOR_UIDS_JSON` is a server-only environment variable for
`recordV2SafetyDecision`. Its exact format is a JSON array of distinct Firebase
Auth UID strings, for example `["operator-uid-1","operator-uid-2"]` (synthetic IDs).
The array must be nonempty. Each UID must be 1–128 characters, contain no slash
or control characters, have no leading/trailing whitespace, and not be `.` or
`..`. JSON formatting whitespace is allowed; UID strings are never normalized.
Missing, empty, invalid JSON, non-array values, duplicates, or any invalid entry
reject the entire configuration. There is no wildcard or fallback authority.

Only trusted server configuration administrators may grant/remove these UIDs.
Removing a UID denies future authorization checks after the updated environment
is applied to the serving function instances. Environment changes are not an
instantaneous revocation of already authorized/in-flight requests. The verifier
reads configuration for each invocation and again at the existing authority gate;
no parsed allowlist is cached by this adapter. No configuration is set by this change.

The authenticated callable `recordV2SafetyDecision` accepts exactly
`{ subject_ref, state, reason_code, expected_version, valid_until }`.
`valid_until` is a canonical UTC ISO timestamp with milliseconds
(`YYYY-MM-DDTHH:mm:ss.sssZ`) and must be in the future. States are the existing
`CLEAR`, `BLOCKED`, and `REVOKED`; all decision/audit logic remains in
`standingSafetyAuthority.recordSafetyDecision`. The operator UID comes only from
`context.auth.uid`; request operator/role/claim fields are rejected. Self-decisions
are prohibited. The response is the authority's minimal subject/state/version/
policy-version receipt. Errors omit operator lists, reasons and persisted records.
Version conflicts never overwrite a decision; an uncertain response is not success.
No direct client writes, publication behavior, payment behavior, or production
configuration are changed. Deployment remains a separately authorized operation.
