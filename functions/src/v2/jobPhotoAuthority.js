"use strict";

const { commandPayloadDigest } = require("./foundation");
const { exactKeys } = require("./confirmedFactValidation");
const { readCurrentConfirmedCleaningDraft } = require("./confirmedPostingDraft");
const COLLECTION = "v2JobMedia";
const MAX_BYTES = 6 * 1024 * 1024;
const id = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const mediaId = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const generationId = (v) => typeof v === "string" && /^[1-9][0-9]*$/.test(v) && Number.isSafeInteger(Number(v));
const invalid = () => { throw new Error("MEDIA_INVALID"); };
function validateRefs(value) {
  if (!exactKeys(value, ["schema_version", "refs"]) || value.schema_version !== 1 ||
      !Array.isArray(value.refs) || value.refs.length > 3 || !value.refs.every(mediaId) ||
      new Set(value.refs).size !== value.refs.length) invalid();
  return value.refs;
}

// A generation-pinned read and create-only write freeze bytes independently of
// mutable draft uploads. No client metadata/download tokens are copied.
function storageAdapter(bucket) {
  return {
    async freeze(sourcePath, generation, destinationPath) {
      const destination = bucket.file(destinationPath);
      const [exists] = await destination.exists();
      if (!exists) {
        const source = bucket.file(sourcePath, { generation });
        const [metadata] = await source.getMetadata();
        const size = Number(metadata.size);
        if (String(metadata.generation) !== generation || metadata.contentType !== "image/jpeg" ||
            !Number.isSafeInteger(size) || size < 4 || size > MAX_BYTES) invalid();
        const [bytes] = await source.download();
        if (bytes.length !== size || bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
            bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) invalid();
        try {
          await destination.save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 },
            metadata: { contentType: "image/jpeg", cacheControl: "private, max-age=300" } });
        } catch (error) { if (Number(error.code) !== 412) throw error; }
      }
      const [metadata] = await destination.getMetadata();
      if (metadata.contentType !== "image/jpeg" || !generationId(String(metadata.generation)) ||
          !Number.isSafeInteger(Number(metadata.size)) || Number(metadata.size) < 4 || Number(metadata.size) > MAX_BYTES) invalid();
      return { generation: String(metadata.generation), size_bytes: Number(metadata.size) };
    },
    async presentation(record, now) {
      const expires = new Date(now.getTime() + 5 * 60_000);
      const [url] = await bucket.file(record.object_path, { generation: record.object_generation })
        .getSignedUrl({ version: "v4", action: "read", expires, responseType: "image/jpeg" });
      return { media_ref: record.media_ref, url, expires_at: expires.toISOString() };
    }
  };
}

async function finalizePhotos({ db, storage, owner, request, now = new Date() }) {
  if (!id(owner)) invalid();
  if (!exactKeys(request, ["schema_version", "draft_ref", "draft_version", "flow_id", "photos"]) ||
      request.schema_version !== 1 || !id(request.draft_ref) || !id(request.flow_id) ||
      !Number.isSafeInteger(request.draft_version) || request.draft_version < 1 ||
      !Array.isArray(request.photos) || !request.photos.length || request.photos.length > 3 ||
      !request.photos.every((p, index) => exactKeys(p, ["index", "generation"]) && p.index === index &&
        generationId(p.generation))) invalid();
  request = JSON.parse(JSON.stringify(request));
  await db.runTransaction((tx) => readCurrentConfirmedCleaningDraft(tx, db, request.draft_ref, owner, request.draft_version));
  const refs = [];
  for (const photo of request.photos) {
    const identity = { owner, draft_ref: request.draft_ref, flow_id: request.flow_id, ...photo };
    const ref = commandPayloadDigest(["v2-job-photo-1", identity]);
    const doc = db.collection(COLLECTION).doc(ref);
    const previous = await doc.get();
    if (!previous.exists) {
      // Path is server constructed. Existing owner-only draft rules establish upload ownership;
      // checking its pinned object proves existence, rather than trusting the path text alone.
      const sourcePath = `job_post_drafts/${owner}/${request.flow_id}/photo_${photo.index}.jpg`;
      const objectPath = `v2PublishedJobMedia/${ref}.jpg`;
      const frozen = await storage.freeze(sourcePath, photo.generation, objectPath);
      await db.runTransaction(async (tx) => {
        const existing = await tx.get(doc);
        if (!existing.exists) tx.create(doc, { schema_version: 1, media_ref: ref, owner_ref: owner,
          draft_ref: request.draft_ref, flow_id: request.flow_id, source_generation: photo.generation,
          object_path: objectPath, object_generation: frozen.generation, size_bytes: frozen.size_bytes,
          media_type: "image/jpeg", state: "FINALIZED", job_ref: null, finalized_at: now.toISOString() });
      });
    }
    refs.push(ref);
  }
  return { schema_version: 1, refs };
}

async function readPublicationPhotos(tx, db, media, owner, draftRef) {
  if (media === undefined) return [];
  const refs = validateRefs(media); const records = [];
  for (const ref of refs) {
    const doc = db.collection(COLLECTION).doc(ref); const snap = await tx.get(doc);
    const r = snap.exists ? snap.data() : null;
    if (!r || r.schema_version !== 1 || r.media_ref !== ref || r.owner_ref !== owner ||
        r.draft_ref !== draftRef || r.state !== "FINALIZED" || r.job_ref !== null ||
        r.media_type !== "image/jpeg" || r.object_path !== `v2PublishedJobMedia/${ref}.jpg` ||
        !generationId(r.object_generation)) invalid();
    records.push({ doc, record: r });
  }
  return records;
}
async function readMarketplacePhotos(tx, db, job, storage, now) {
  if (job.media === undefined) return undefined;
  const refs = validateRefs(job.media); const photos = [];
  for (const ref of refs) {
    const snap = await tx.get(db.collection(COLLECTION).doc(ref)); const r = snap.exists ? snap.data() : null;
    if (!r || r.media_ref !== ref || r.schema_version !== 1 || r.state !== "PUBLISHED" ||
        r.job_ref !== job.job_ref || r.owner_ref !== job.owner_ref ||
        r.object_path !== `v2PublishedJobMedia/${ref}.jpg` || r.media_type !== "image/jpeg" ||
        !generationId(r.object_generation)) invalid();
    photos.push(await storage.presentation(r, now));
  }
  return { schema_version: 1, photos };
}
function createFinalizePhotosCallable({ db, auth, storage, HttpsError }) {
  return async (data, context) => {
    const owner = context?.auth?.uid;
    if (!id(owner)) throw new HttpsError("unauthenticated", "Sign in to prepare job photos.");
    try {
      const user = await auth.getUser(owner);
      if (user.uid !== owner || user.disabled !== false) invalid();
      return await finalizePhotos({ db, storage, owner, request: data });
    } catch (_) { throw new HttpsError("failed-precondition", "Job photos could not be prepared. Your draft is retained."); }
  };
}
module.exports = { COLLECTION, MAX_BYTES, validateRefs, storageAdapter, finalizePhotos,
  readPublicationPhotos, readMarketplacePhotos, createFinalizePhotosCallable };
