# V2 confirmed-job boundary

Source implementation only; not deployed. Gate 6 remains NOT PROVEN DEPLOYED.

`confirmV2JobDraft` accepts `{ intent_key, expected_version, task_schema_version, submission }` through authenticated Firebase callable transport. The caller UID supplies ownership. Currently only canonical `general_cleaning`, taxonomy version `2`, task schema version `2` is registered for new confirmations. Unsupported IDs/versions fail closed. Task validators are server registrations, never supplied by clients.

The submission retains the existing fields: `task_type_id`, `taxonomy_version`, `title`, `description`, `additional_info`, `duration_minutes`, `schedule_window`, `scope`, `risk_facts`, `conflicting_facts`, `additional_task_type_ids`, `prohibited_scope_codes`. Confirmation is an explicit poster command; text is never mined to fill structured facts. Existing schedule, size, and input bounds remain enforced.

## Cleaning schema 2

Required scope keys: `areas_items`, `cleaning_level`, `approximate_scale`. Empty or unresolved values cannot clear. Supported levels are `STANDARD` and `DEEP`. `room_count` is optional/nullable; supply responsibility is optional and can remain `UNKNOWN`. Neither two rooms nor poster-provided supplies is required.

The existing five risk confirmations remain explicit: `medical_or_intimate_care`, `hazardous_materials`, `pest_control`, `chemical_risk`, `unknown_conditions`. Each must be `ABSENT_CONFIRMED` for the ordinary safe path; absent shape, unknown, or present risks cannot clear. A supplied `condition_hazards` must be `NONE_CONFIRMED`. This increment does not invent a rule that infers safe conditions from omitted answers. Common deterministic policy rejects conflicting/multiple-task scope and withholds explicit excluded scope.

Text reconciliation uses a bounded deterministic grammar, not an unrestricted natural-language classifier or a keyword safety filter. Examples of newly clearable combinations:

- `[bedroom]`, `DEEP`, `one room`; title `Clean bedroom`; description `Deep cleaning of bedroom.`
- `[living room, hallway]`, `STANDARD`, `small apartment`, `WORKER_PROVIDES`; title `Standard cleaning of living room and hallway`; description `Standard cleaning of living room and hallway. Worker provides supplies.`

The implemented area vocabulary and bounded scale grammar are in `generalCleaningValidator.js`. Unknown labels/scales, unmatched prose, nonempty additional information, injected scope text, or contradictions remain `UNRESOLVED`; they cannot publish. This is intentionally limited parser coverage, not a new taxonomy or a claim that arbitrary posting descriptions are understood. No resource recommendations or inferred resource obligations are produced.

## Authority, versions, compatibility

The shared service validates the envelope, dispatches to the registered task schema, applies common deterministic policy, reconciles text, and stores an owner-bound versioned draft. The receipt remains exactly `draft_ref`, `confirmed_posting_facts_ref`, `draft_version`, `policy_outcome`, `policy_version`, `text_reconciliation_state`. A saved unresolved draft is not publication clearance.

New records use draft schema `3`, confirmed-fact schema `2`, validator `general-cleaning-2`, and text rule `cleaning-text-2`. The frozen policy identifier remains `OJNY-V2-GOV-1.0.0/task-scope-1`; the new implementation/schema versions distinguish variable-scope validation from the fixture. Both content and schema-bound request digests are verified. Backend reads rerun validation/policy/text reconciliation before returning facts to publication.

`confirmV2GeneralCleaningDraft` retains its existing request and receipt, delegates to the shared service with cleaning schema 2, and cannot dispatch other tasks. The existing iOS repository remains wire-compatible. The `CLEARED_EXACT_TEMPLATE_V1` string is retained as the existing T01/iOS wire token; persisted text-rule provenance identifies which exact grammar was checked. T01 publication code is unchanged.

Schema-2 records with fact schema 1 retain their original fixture-only reader and replay semantics. They are not migrated or newly cleared during reads. An explicit revision writes the current schema. Same owner/intent/version/content retries return the original receipt; conflicting retries fail; revisions require the current expected version. Cross-owner references fail.

No payment, Stripe, provider call, location change, or client-controlled policy authority is introduced. No new task is activated by being present in the taxonomy.
