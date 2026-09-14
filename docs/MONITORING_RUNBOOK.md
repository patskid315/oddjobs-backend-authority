# Emergency monitoring runbook

Status: production Logs Explorer access and base filter syntax validated read-only on 2026-09-14; alert resources were not created.

All queries target Cloud Logging resource type `cloud_function` and function name `releasePaymentOnCompletion` in project `theoddjobsappnewyork`.

| Signal | Query/message | Threshold |
|---|---|---|
| Completion received / pending outcome | `jsonPayload.message="settlement_requested"` | Expected after each first completion; absence within 5 minutes of a known completion alerts |
| Duplicate suppressed | `jsonPayload.message="settlement_requested" AND jsonPayload.created=false` | Informational; burst above 5 in 5 minutes alerts |
| Missing/ambiguous payment | `jsonPayload.message="settlement_pending_missing_payment"` | Any occurrence pages manual review immediately |
| Transfer attempt | `jsonPayload.message="stripe_transfer_attempt"` | **Must remain zero; any occurrence is critical and triggers rollback** |
| Function error | `severity>=ERROR` | Any occurrence during canary triggers investigation; two in 5 minutes triggers rollback |
| Firestore permission error | text contains `PERMISSION_DENIED` | Any candidate-function occurrence triggers investigation |
| Legacy transfer path | function log contains `Transfer successful` or `Transfer failed` from the recovered handler | **Must remain zero; any occurrence is critical and triggers rollback** |

Operators must also compare Firestore `settlements` counts by status and age: pending older than 15 minutes is a warning; any claimed/processing record is critical during Option A because execution is disabled; any succeeded record created by the candidate is critical. Cloud Error Reporting must have a zero-error baseline immediately before deployment.

Monitoring query access is validated. Saved metrics and alert policies are deferred because creating them would modify production; the Gate 6 operator must run the prepared filters directly during the canary window.

Read-only validation used the authenticated `theoddjobsappnewyork` Logs Explorer with `resource.type="cloud_function" AND resource.labels.function_name="releasePaymentOnCompletion"`. The console accepted the project and filter and returned a valid zero-result view for the selected one-hour window. Each table filter is a strict extension of that accepted base filter. Operators can change the time range and use result counts without exposing payloads. Creating saved queries, log metrics, or alert policies remains a production mutation and was intentionally deferred.
