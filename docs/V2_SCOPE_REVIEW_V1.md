# General Cleaning scope-review provenance

New explicit confirmations use the existing callable with two additional envelope fields:
`confirmation_contract_version: 2` and `scope_review: {version: 1, scope_digest: "<lowercase SHA-256>"}`.
Both are required together. Missing version selects the historical contract, not implicit review.
The generic callable retains its existing `task_schema_version: 2` field. Task/fact schema,
policy, safety requirements, cleaning-text-5, and successful receipts do not change.

The acknowledgment means the authenticated poster explicitly accepted the exact ordinary
structured scope as the work requested. It is an intent assertion, not proof of truth,
safety, eligibility, or policy compliance. Backend authentication binds the actor; a digest
is not authentication. New iOS commands create it only through explicit confirmation.

## Canonical representation v1

Use UTF-8 canonical JSON with lexically sorted object keys, no insignificant whitespace,
standard JSON string escaping, and no escaped forward slashes. Hash with SHA-256 using
the existing backend `commandPayloadDigest` convention. All scope strings in this version
are printable ASCII U+0020 through U+007E, matching the supported bounded vocabulary.
Unsupported representations fail without normalization into different work.

Shape: `{ "version": 1, "scope": { "areas_items": [...], "cleaning_level": "...",
"approximate_scale": "...", "room_count": null, "supplies_responsibility": null } }`.

- Areas: trim surrounding ASCII spaces, lowercase ASCII, then sort lexically. Retain
  duplicate entries; policy still rejects duplicate logical areas. No aliases or inference.
- Level and approximate scale: exact supplied strings; no semantic alias conversion.
- Room count: safe integer when supplied; omitted or null maps to null.
- Supplies: exact supplied string when present (including UNKNOWN); omitted maps to null.
- Exclude condition_hazards and the five risk facts: safety remains separately evidenced
  by the unchanged explicit safety contract and independently validated policy.
- Exclude title, description, schedule, owner, references, and timestamps. The existing
  whole-command digest still binds these submitted fields and the acknowledgment for retry.

Normative non-sensitive vector: `functions/test/fixtures/scope-review-v1.json`.
An identical copy lives in iOS `Tests/V2CleaningConfirmation/scope-review-v1.json`.
The fixtures contain input, exact canonical bytes, and expected SHA-256 for Android/Web reuse.

## Persistence and retries

Reviewed records use draft record schema 4, persisting the contract version and acknowledgment
alongside the existing owner and confirmed timestamp. The server recomputes the scope digest
both before writing and when reading/replaying the record. The request digest includes the
review fields. Original text and content digest remain untouched.

Historical records (schemas 2/3) retain their prior interpretation and request digests;
historical commands carry no review evidence. A new reviewed command cannot replace an
uncertain historical command at the same expected version. Explicit reconfirmation uses
the acknowledged current draft version and a newly accepted scope. Existing receipt shape
is unchanged. No old command or record is migrated automatically.

Future cleaning-text-6 must explicitly require verified reviewed-contract provenance before
using refinement semantics; legacy commands must retain historical reconciliation. This
change does not implement text-6 or alter current publication eligibility.
