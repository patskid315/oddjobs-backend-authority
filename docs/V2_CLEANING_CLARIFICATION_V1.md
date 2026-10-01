# General Cleaning clarification v1

Only new UNRESOLVED text-6 confirmation receipts add:
`clarification: {version: 1, issues: [{code, field, action}]}`.
The normative allowlist and recovery ordering are in
`functions/test/fixtures/cleaning-clarification-v1.json` (also copied to iOS repository tests).
Success remains the existing six-field receipt. No English, prose excerpts, digests,
locations, provider information, or arbitrary internal strings appear in clarification.

## Mapping and recovery

| Internal evidence | Public code | Field | Action |
|---|---|---|---|
| Required safety fact not ABSENT_CONFIRMED, or supplied condition not NONE_CONFIRMED | safety_confirmation_required | safety | answer_safety_question |
| Explicit level disagrees | cleaning_level_conflict | cleaning_level | review_cleaning_level |
| Expressed room missing | area_conflict | areas | review_areas |
| Comparable quantity conflicts or explicit quantity cannot be reconciled | scale_conflict | scale | review_scale |
| Only-scope expanded | exclusive_scope_conflict | scope | review_scope |
| Whole-dwelling coverage unresolved | whole_scope_unresolved | scope | review_scope |
| Unclassified field contains a fully recognized cleaning request before an explicit 'and' addition | additional_scope_unresolved | scope | review_job_description |
| Otherwise unclassified/internal unknown or unresolved structured scope | unclassified_scope | scope | review_job_description |
| Empty area list | missing_area | areas | select_areas |
| Blank level | missing_cleaning_level | cleaning_level | select_cleaning_level |
| Blank scale | missing_scale | scale | select_scale |

Issues are deduplicated and emitted in table order, not object/Set iteration order.
Diagnostics do not change the authoritative outcome. Multiple missing requirements
and issues from both text fields can be returned. This is bounded diagnostic coverage,
not an exhaustive English explanation of every simultaneous defect.

No safety_sensitive_scope code is emitted: current text reconciliation cannot reliably
classify mold versus other unknown prose. It remains unclassified_scope. An answer to a
safety question cannot override concerning prose or grant clearance.
No scope_review_required clarification is emitted: missing/mismatched review provenance
in contract v2 remains an invalid command. Authentication/infrastructure errors also remain errors.

## History and privacy

Clarification is persisted with the new unresolved result, validated on read, and returned
unchanged on exact retry. Absence is preserved on historical records, including old text-6
records; there is no retroactive synthesis. Public version 1 mappings must remain stable;
future versions need explicit read dispatch. Neither receipt issues nor their absence can
change policy_outcome or text_reconciliation_state.

The iOS repository permits this optional field only on UNRESOLVED receipts, validates exact
keys, version, bounded size, and allowed code/field/action tuples, and preserves backend order.
Unsupported versions/shapes/fields/actions produce invalidResponse. An unknown future issue
code with a well-formed known field/action becomes a generic unclassifiedScope domain issue,
with containsUnknownIssue=true; its original string is not retained. It never becomes success.
No ViewModel presentation, navigation, or View policy is introduced.
