# V2 open discovery and worker responses

Implementation only; not deployed or production-proven. Gate 6 remains NOT PROVEN DEPLOYED.

`v2Marketplace` is an authenticated callable with five operations. Every request has
exact keys. Every result has `schema_version: 1`. No worker/poster UID is accepted
in the request body. Account state is checked with Firebase Admin Auth.

| Operation | Additional request fields | Result |
|---|---|---|
| `browse` | `cursor` (null or last scanned document ID) | `jobs`, `next_cursor` |
| `posted` | `cursor` | owner's `jobs`, `next_cursor` |
| `detail` | `job_ref` | `job`, caller's `response` or null |
| `respond` | `job_ref`, `job_version`, `intent_key`, `message` | `response` |
| `responses` | `job_ref`, `cursor` | owner's job `responses`, `next_cursor` |

Pages scan at most 20 documents in document-ID order; a filtered page may be empty
with a non-null cursor. Clients must allow loading subsequent pages. No personalized
ranking or neighborhood targeting is implied. This query uses single-field document
ID ordering and introduces no composite index.

## Authority and privacy

T01 remains unchanged. Reads consume `v2PublishedJobs`, its owner-bound private draft
reference, and the existing versioned confirmed-draft reader. Missing, changed or
invalid confirmed evidence fails closed. Only supported `PUBLISHED_OPEN`,
`MARKETPLACE_OPEN`, non-expired General Cleaning jobs are offered for new responses.

Worker request decisions consume fresh enabled Auth account state and the existing
audited, unexpired operator safety clearance, recording a request-specific decision
with input versions. Current poster safety is also rechecked before offering the
interaction or creating a new response; exact receipt replay creates no new decision.
Missing safety is not clearance. No capability, identity
verification, Ready-to-Work, saved service area, Connect, or payment gate is added.

The worker projection uses a generic General Cleaning title, allowlisted structured
areas/level/scale, absolute schedule, duration, canonical borough, and poster's
entered offer (not a promised net payout). Raw poster title/description are deliberately
omitted: they can contain private information. Exact location, unit, coordinates,
private references, and safety provenance are never projected.

Responses live under `v2PublishedJobs/{job}/responses/{response}`. The existing
Firestore default deny protects these paths; clients have no direct write/read
permission. Response IDs are backend-derived from job and authenticated worker.
Only the owning poster can list responses. Only the submitting worker can receive
their own response through detail/replay. Public response projection contains an
opaque response ID, job/version, `SUBMITTED`, worker-written message (up to 1000
characters), backend timestamp, retry key and generic `Worker` label; no worker
profile, email, phone, UID, or trust claim is disclosed. The message is intentionally
shared with the poster, not public browse users.

## Retry and lifecycle

One immutable response per worker/job. Same key and command return the original
receipt; same key with different content conflicts; another key returns
`already_responded`. Transactions atomically read/create the stable response document,
so concurrent creates retry against the existing record. Exact receipt replay does
not create a new response after job closure. Current account/safety access remains
required. Detail retrieves an existing response after client navigation; no new
durable client response store is required. There is no edit/withdraw/select/accept
transition in this increment.

Errors carry only `{domain: "v2_marketplace", version: 1, reason}`. Bounded reasons:
`invalid_request`, `authentication_required`, `account_unavailable`,
`eligibility_unavailable`, `not_permitted`, `job_unavailable`, `job_changed`,
`already_responded`, `request_conflict`, `temporarily_unavailable`, `unknown`.
No underlying Auth/Firestore/moderation details are returned.

## Manual verification after separately authorized deployment

Deploy only `functions:v2Marketplace` to an explicitly chosen project when authorized.
No new secret or environment variable is introduced. Do not deploy other functions.
Use two authenticated enabled accounts; the worker needs current audited safety
clearance through the existing operator path. Poster A publishes through T01.
Worker B opens the existing Explore feed (or House chores category), opens the
corresponding job card, and submits interest. Reopen the detail to confirm the
existing response. Poster A opens My Jobs, then the corresponding active job card
to view its responses. Verify one response, safe projection, and absence of selection or
payment actions. No production seed writes are part of implementation/testing.

Out of scope: selection, funding, assignment, work, completion, settlement, payout,
reviews, notifications, proactive matching, profiles, Android and Web.

## Existing app integration

V2 projections reuse the existing job card alongside legacy jobs in Explore and
My Jobs; there is no cleaning-specific top-level destination. General Cleaning
uses House chores. The client filters its loaded V2 pages by search and borough;
legacy job fetching and filtering remain unchanged. Neighborhood authority is not
activated: borough-only V2 jobs retain the legacy search behavior for a missing
neighborhood, so their presence is not evidence of a selected neighborhood match.
Favorites retain the existing card's local toggle behavior. No persistent favorites
capability is introduced. Additional pages remain explicitly loadable.

The focused marketplace test now invokes the actual T01 draft, protected-location,
and publication producers before discovery, worker response, and owner response
read. It verifies the emitted job/version, schedule, coarse geography, offer,
confirmed scope, timestamps and pre-payment state rather than substituting a
second publication fixture schema. This is local contract evidence, not deployment
or production E2E evidence.
