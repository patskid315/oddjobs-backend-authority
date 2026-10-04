# Hourly funded-scope agreement

`v2Marketplace` owns `propose_scope`, `accept_scope`, and `decline_scope`.
Authenticated posters propose; only the authoritative selected worker may decide.
Policy `hourly-funded-scope-1-minutes-1-720` permits integer maximum billable
minutes from 1 through 720 inclusive. There is no required increment. This cap
is not scheduled duration, guaranteed duration, actual work, payout, or permission
to start work. It is never derived from the schedule.

The private `v2HourlyScopes/{job_ref}` record binds job/version, offer digest,
selection identity/revision, response, poster, selected worker, and hourly rate.
A new proposal supersedes the prior proposal and requires fresh worker consent.
Matching accepted agreements cannot be revised through this interface. Changed
controlling facts invalidate readiness. Fixed-price jobs need no hourly agreement.

`PROPOSED`, `DECLINED`, and `AGREED` describe only this agreement; job lifecycle
remains `SELECTION_PENDING_FUNDING`, financial state remains `FUNDING_REQUIRED`.
`funding_scope_ready` reports the scope prerequisite only. No payment, assignment,
or funding operation is implemented. A future funding authority must revalidate
the controlling facts and bilateral agreement transactionally.

Expected proposal versions prevent stale decisions. Per-owner intent receipts
preserve the original command/result on retries while its proposal remains current;
superseded retries fail closed. Accept/decline requests cannot include minutes.
Prior proposals are retained under `history`; receipt records under `commands`.
Existing Firestore deny-by-default rules forbid client access to all these records.
Public projections exclude actor IDs, binding digests, and internal provenance.

Selected workers discover pending hourly jobs through `selected_jobs` in existing
My Jobs. Poster and worker use existing marketplace detail for proposal/decision.

## Activation

No new environment variables, secrets, indexes, or rules are required.
After separately authorized release review:

```sh
firebase deploy --project theoddjobsappnewyork --only functions:v2Marketplace
```

This implementation does not establish deployment evidence. Manually verify an
hourly selection, proposal, worker acceptance/decline, poster refresh, stale
proposal rejection, and immutable retry. Verify no funding or assignment occurs.
