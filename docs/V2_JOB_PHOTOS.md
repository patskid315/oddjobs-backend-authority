# V2 job photos — implementation and activation boundary

This bounded feature covers up to three poster-selected JPEG job photos. It is not a general media platform. No deployment or production configuration is performed by this implementation. Gate 6 remains NOT PROVEN DEPLOYED.

## Authority and lifecycle

The existing private `job_post_drafts/{uid}/{flow}/photo_{index}.jpg` upload namespace is reused. The app retains the existing 0.82 JPEG compression. Finalization accepts a confirmed draft reference/version, flow ID, and ordered source generations (zero through two); it never accepts a client URL, bucket, arbitrary path, owner, or destination. Callable authentication supplies the owner. Existing owner-only Storage rules plus an actual generation-pinned metadata/byte read establish the source. The server checks JPEG metadata/signature and the existing draft-download limit of 6 MiB per image; this is bounded format checking, not content moderation or a full JPEG decoder.

`finalizeV2JobPhotos` validates the owner's current confirmed draft, freezes the exact generation into `v2PublishedJobMedia/{opaque SHA256 media_ref}.jpg`, and creates private `v2JobMedia/{media_ref}` provenance. The identity includes owner, draft, upload flow, index, and source generation. Destination creation uses `ifGenerationMatch: 0`; metadata/download tokens are not copied. Later source overwrite/deletion cannot alter the frozen object. Clients have no matching allow rule for the new namespace, so direct reads/writes/deletes are denied. Existing namespaces/rules remain unchanged.

The private record is schema 1 and contains media_ref, owner_ref, draft_ref, flow_id, source_generation, object_path/generation, bounded size, JPEG type, state, job_ref, finalized_at, and (on publication) published_at. A crash after object creation but before recording it can safely retry the same deterministic destination. The record transitions FINALIZED → PUBLISHED in the same Firestore transaction as publication. Publication verifies owner, draft binding, state, and immutable object identity. Published jobs carry only `media: {schema_version: 1, refs: [...]}`. Missing media remains the historical no-photo contract; its command payload/receipt behavior is unchanged.

## Retry, editing, and cleanup

Before network finalization, iOS atomically persists an owner/draft/selection-scoped request with source generations. After success it persists opaque refs. No raw bytes, UIImage, or signed URL enters that recovery state. A saved posting draft retains its photo selection ID so restoration can reuse preparation; an explicit photo edit gets a new selection ID. Preparation retries reuse generations, and completed preparations reuse refs. Upload failure before a generation is saved may repeat that unfinished upload; finalization/publication retries do not re-upload completed media.

The existing publication intent store persists the exact media references before submission. Pending publication recovery bypasses photo preparation entirely. Editing is disabled for a retained publication attempt; it must first resolve its authoritative outcome. An edit before that point creates a new selection/preparation identity, leaving old finalized media unreferenced. Removing every photo explicitly produces no media. A process exit before a draft or publication intent is saved does not add new recovery guarantees for the unsaved form.

No automatic cleanup is added. Private uploads, orphan objects after an interrupted finalization, and FINALIZED-but-never-published records may remain. A future retention job must first atomically claim an unreferenced FINALIZED record into a non-publishable cleanup state, then delete its exact object generation. It must coordinate with in-flight finalization and publication and never delete PUBLISHED media. Existing draft cleanup cannot delete the separate finalized namespace. Retention duration is not chosen here.

## Marketplace access

Existing marketplace account/eligibility checks run before rendering URLs are generated. Browse/detail/posted expose only schema version, opaque media_ref, a five-minute generation-pinned GCS V4 read URL, and expiry. The URL is a bearer capability valid until expiration; it is not a canonical identity and must not be logged/persisted. It contains no poster UID or source draft path. Source metadata and provenance remain private. No broad Storage reads are opened. Reloading lists/details refreshes URLs, including poster detail. Response submission does not depend on URL signing. Existing AsyncImage/JobThumb rendering is reused; no custom cache is added.

## Activation prerequisites (not performed)

Selective function targets: `finalizeV2JobPhotos`, `publishV2GeneralCleaning`, `v2Marketplace`. Confirm the existing default bucket and runtime service account, including that no public bucket IAM/default object ACL bypasses the private namespace. This is an activation preflight, not a change to bucket configuration. The finalizer needs existing Admin read/create access to these namespaces; marketplace's runtime signer needs `iam.serviceAccounts.signBlob` on its signing identity and object-read authority. This uses application default credentials, never a checked-in private key. Verify permissions before activation; do not work around signing failure by making objects public. No new environment variable, Storage rule, Firestore rule, or index is introduced.

Five-minute bearer URLs do not support immediate per-viewer revocation after issuance. If immediate revocation is required later, it needs a separately approved authenticated media-delivery boundary; do not silently lengthen access or open Storage rules.

## Focused verification / manual retest

Unit/contract: `node --test functions/test/v2-marketplace.test.js functions/test/v2-publication-callable.test.js`.
Local demo-project rules test: `functions/test-emulator/v2-job-media-rules.test.js` with Firestore 8080 and Storage 9199; never point this test at production.
Client: `Scripts/test-v2-job-photos.sh`, existing marketplace/publication/recovery/coordinator checks, simulator Debug build.

After an independently authorized deployment: select 1–3 photos, confirm cleaning and address, publish once, verify the same photos across Explore/category/My Jobs/detail; reload after URL expiry. Test a no-photo historical job. Interrupt finalization and publication separately, relaunch a saved draft/pending intent, and verify stable media refs/no duplicate job. Edit/remove photos before publication and verify abandoned selections never appear. Use separate eligible accounts to verify marketplace access; never log URLs or private provenance.

The displayed `General Cleaning` title remains synthesized by `projectJob` in `functions/src/v2/marketplace.js`, not taken from original poster prose. Taxonomy/title behavior is unchanged.
