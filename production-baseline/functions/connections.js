const functions = require("firebase-functions");
const admin = require("firebase-admin");

const db = admin.firestore();

const JOBS_COLLECTION = "jobPost";
const CONNECTIONS_COLLECTION = "jobConnections";

const JOB_POSTER_FIELD = "userId";              // poster uid on job
const JOB_WORKER_FIELD_A = "workerId";          // if your job uses workerId
const JOB_WORKER_FIELD_B = "assignedWorkerID";  // your older field in iOS code
const JOB_STATUS_FIELD = "progressStatus";
const COMPLETED_STATUS_VALUE = "completed";

function connectionDocId(posterId, workerId) {
  return `connection_${posterId}_${workerId}`;
}

// ✅ Transaction-safe upsert that DOES NOT overwrite createdAt
async function upsertConnection({ jobId, posterId, workerId, completedAt }) {
  const ref = db.collection(CONNECTIONS_COLLECTION).doc(connectionDocId(posterId, workerId));

  const now = admin.firestore.FieldValue.serverTimestamp();
  const lastCompletedAt = completedAt || now;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);

    // We store jobIds as a map (dedupe by key)
    const jobIdPath = `jobIds.${jobId}`;

    if (!snap.exists) {
      tx.set(ref, {
        posterId,
        workerId,

        createdAt: now,
        updatedAt: now,

        lastJobId: jobId,
        lastCompletedAt: lastCompletedAt,

        jobIds: {
          [jobId]: true,
        },
      });
      return;
    }

    // Exists -> update without touching createdAt
    tx.update(ref, {
      updatedAt: now,
      lastJobId: jobId,
      lastCompletedAt: lastCompletedAt,
      [jobIdPath]: true,
    });
  });
}

// ✅ Trigger: only on updates (status transition into completed)
exports.onJobCompleted_createConnection = functions.firestore
  .document(`${JOBS_COLLECTION}/{jobId}`)
  .onUpdate(async (change, context) => {
    const after = change.after.data();
    const before = change.before.data();

    const afterStatus = after?.[JOB_STATUS_FIELD];
    const beforeStatus = before?.[JOB_STATUS_FIELD];

    // Only run on transition into "completed"
    if (afterStatus !== COMPLETED_STATUS_VALUE) return;
    if (beforeStatus === COMPLETED_STATUS_VALUE) return;

    const posterId = after?.[JOB_POSTER_FIELD];
    const workerId = after?.[JOB_WORKER_FIELD_A] || after?.[JOB_WORKER_FIELD_B];

    if (!posterId || !workerId) {
      console.log("⚠️ onJobCompleted missing posterId/workerId", { posterId, workerId });
      return;
    }

    const completedAt = after.completionDate || after.finalizedAt || null;

    console.log("✅ Creating/updating connection", {
      jobId: context.params.jobId,
      posterId,
      workerId,
    });

    await upsertConnection({
      jobId: context.params.jobId,
      posterId,
      workerId,
      completedAt,
    });
  });