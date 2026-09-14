// referrals.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { google } = require("googleapis");

// IMPORTANT: do NOT call admin.initializeApp() here
// You already do it in ./admin and it’s required by index.js

const db = admin.firestore();

// -----------------------------
// Helper: send email via Gmail API
// -----------------------------
async function sendEmailViaGmail({ toEmail, subjectLine, bodyText }) {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Missing GOOGLE_SERVICE_ACCOUNT_JSON secret."
    );
  }

  const creds = JSON.parse(raw);
  const SENDER = "referrals@theoddjobsapp.com";

  const jwtClient = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/gmail.send"],
    subject: SENDER,
  });

  const gmail = google.gmail({ version: "v1", auth: jwtClient });

  const message = [
    `From: OddJobs Referrals <${SENDER}>`,
    `To: ${toEmail}`,
    `Subject: ${subjectLine}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    bodyText,
  ].join("\r\n");

  const encodedMessage = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encodedMessage },
  });

  return { ok: true };
}

// -----------------------------
// Schema constants (OddJobs NYC)
// -----------------------------
const JOBS_COLLECTION = "jobPost";
const USERS_COLLECTION = "users";
const REFERRALS_COLLECTION = "referrals";
const CONNECTIONS_COLLECTION = "jobConnections";
const NOTIFICATIONS_COLLECTION = "notifications";

// Job fields (kept for convenience / messaging)
const JOB_POSTER_FIELD = "userId";

// -----------------------------
// Deep link builder
// -----------------------------
function buildJobUniversalLink(jobId) {
  const id = String(jobId || "").trim();
  if (!id) return "https://www.theoddjobsapp.com";
  return `https://www.theoddjobsapp.com/j/${id}/`;
}

// -----------------------------
// Formatting helpers
// -----------------------------
function formatCurrency(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return `$${value.toFixed(2)}`;
}

function extractNeighborhood(job) {
  if (!job) return null;

  if (job.address && typeof job.address === "object") {
    const n = job.address.neighborhood;
    if (typeof n === "string" && n.trim().length > 0) return n.trim();
  }

  if (typeof job.neighborhood === "string" && job.neighborhood.trim().length > 0) {
    return job.neighborhood.trim();
  }

  return null;
}

function extractJobTitle(job) {
  if (!job) return "a job on OddJobs";

  const title = typeof job.title === "string" ? job.title.trim() : "";
  if (title) return title;

  const category = typeof job.category === "string" ? job.category.trim() : "";
  if (category) return category;

  return "a job on OddJobs";
}

function extractPayText(job) {
  if (!job) return "Pay shown in app";

  const candidates = [job.totalCost, job.setPrice, job.subTotal, job.hourlyRate];

  for (const v of candidates) {
    const asNumber = typeof v === "number" ? v : null;
    const formatted = formatCurrency(asNumber);
    if (formatted) return formatted;
  }

  return "Pay shown in app";
}

// -----------------------------
// Anti-spam helpers (dedupe)
// -----------------------------
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function safeKey(str) {
  return encodeURIComponent(String(str || "").trim().toLowerCase());
}

function inviteDedupDocId({ jobId, senderId, email }) {
  return `invite_${safeKey(senderId)}_${safeKey(jobId)}_${safeKey(email)}`;
}

function existingDedupDocId({ jobId, posterId, workerId }) {
  return `existing_${safeKey(posterId)}_${safeKey(jobId)}_${safeKey(workerId)}`;
}

// ✅ YOUR DB USES DETERMINISTIC DOC IDS:
function connectionDocId(posterId, workerId) {
  return `connection_${posterId}_${workerId}`;
}

// -----------------------------
// ROLE CHECKS (Poster vs Worker)
// -----------------------------
async function assertIsJobPoster(uid) {
  const uDoc = await db.collection(USERS_COLLECTION).doc(uid).get();
  if (!uDoc.exists) {
    throw new functions.https.HttpsError("not-found", "User profile not found.");
  }

  const u = uDoc.data() || {};
  const lookingFor = String(u.lookingFor || "").trim().toLowerCase();

  const isPoster =
    lookingFor === "post jobs" ||
    lookingFor === "post job" ||
    lookingFor === "job poster" ||
    lookingFor === "poster";

  if (!isPoster) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Only job posters can use past-worker referrals."
    );
  }

  return {
    fullName: String(u.fullName || u.name || "OddJobs User").trim(),
    profileImageURL: u.profileImageURL || u.profileImageUrl || null,
  };
}

// -----------------------------
// Callable: fetchEligibleWorkers
// ✅ index-free (no orderBy)
// ✅ sorts by updatedAt in-memory
// -----------------------------
exports.fetchEligibleWorkers = functions.https.onCall(async (data, context) => {
  try {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
    }

    const authUid = context.auth.uid;

    // Caller must be a Job Poster
    await assertIsJobPoster(authUid);

    // posterId optional; if provided must match auth.uid
    const { posterId } = data || {};
    const resolvedPosterId =
      posterId && String(posterId).trim() ? String(posterId).trim() : authUid;

    if (resolvedPosterId !== authUid) {
      throw new functions.https.HttpsError("permission-denied", "Not allowed.");
    }

    console.log("📣 fetchEligibleWorkers resolvedPosterId =", resolvedPosterId);

    // ✅ NO orderBy -> avoids composite index problems
    const snap = await db
      .collection(CONNECTIONS_COLLECTION)
      .where("posterId", "==", resolvedPosterId)
      .limit(100)
      .get();

    console.log("📣 connections found =", snap.size);

    // Sort in memory by updatedAt desc
    const connections = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const aMs = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : 0;
        const bMs = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : 0;
        return bMs - aMs;
      });

    const workerIds = connections
      .map((c) => c.workerId)
      .filter((id) => typeof id === "string" && id.trim().length > 0);

    console.log("📣 workerIds =", workerIds);

    if (workerIds.length === 0) return { workers: [] };

    const userDocs = await db.getAll(
      ...workerIds.slice(0, 50).map((id) => db.collection(USERS_COLLECTION).doc(id))
    );

    const workers = userDocs
      .map((d) => {
        if (!d.exists) {
          console.log("⚠️ missing user doc for workerId =", d.id);
          return null;
        }

        const u = d.data() || {};

        const fullName =
          String(u.fullName || "").trim() ||
          String(u.name || "").trim() ||
          "OddJobs User";

        const skills = Array.isArray(u.skills)
          ? u.skills
          : Array.isArray(u.interests)
            ? u.interests
            : [];

        const avatarURL =
          u.profileImageURL ||
          u.profileImageUrl ||
          null;

        return {
          id: d.id,
          fullName,
          skills,
          avatarURL,
        };
      })
      .filter(Boolean)
      .filter((w) => w.fullName && String(w.fullName).trim().length > 0);

    console.log("📣 workers returned =", workers.length);

    return { workers };
  } catch (err) {
    console.log("❌ fetchEligibleWorkers fatal:", err);

    if (err instanceof functions.https.HttpsError) throw err;

    throw new functions.https.HttpsError(
      "internal",
      err?.message ? String(err.message) : "fetchEligibleWorkers failed."
    );
  }
});

// -----------------------------
// Callable: sendReferral
//
// ✅ RULE:
// existingWorker does NOT require owning the job.
// Any JOB POSTER can refer ANY job to workers they have a connection with.
// -----------------------------
exports.sendReferral = functions
  .runWith({ secrets: ["GOOGLE_SERVICE_ACCOUNT_JSON"] })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
    }

    const authUid = context.auth.uid;

    const {
      type, // "existingWorker" | "invite"
      jobId,

      // existingWorker
      posterId,
      workerId,

      // invite
      senderId,
      name,
      contact,
      contactType, // "email"

      note,
    } = data || {};

    if (!type || !jobId) {
      throw new functions.https.HttpsError("invalid-argument", "Missing type/jobId.");
    }

    const jobDoc = await db.collection(JOBS_COLLECTION).doc(jobId).get();
    if (!jobDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Job not found.");
    }
    const job = jobDoc.data() || {};

    // -------------------------
    // existingWorker
    // -------------------------
    if (type === "existingWorker") {
      const posterProfile = await assertIsJobPoster(authUid);

      const resolvedPosterId =
        posterId && String(posterId).trim() ? String(posterId).trim() : authUid;

      if (resolvedPosterId !== authUid) {
        throw new functions.https.HttpsError("permission-denied", "Not allowed.");
      }

      if (!workerId || !String(workerId).trim()) {
        throw new functions.https.HttpsError("invalid-argument", "Missing workerId.");
      }

      const resolvedWorkerId = String(workerId).trim();

      // ✅ deterministic connection doc check (matches your DB)
      const connId = connectionDocId(resolvedPosterId, resolvedWorkerId);
      const connDoc = await db.collection(CONNECTIONS_COLLECTION).doc(connId).get();

      if (!connDoc.exists) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "You can only refer workers you’ve completed jobs with before."
        );
      }

      // Dedupe
      const dedupId = existingDedupDocId({
        jobId,
        posterId: resolvedPosterId,
        workerId: resolvedWorkerId,
      });

      const referralRef = db.collection(REFERRALS_COLLECTION).doc(dedupId);

      await db.runTransaction(async (tx) => {
        const existing = await tx.get(referralRef);
        if (existing.exists) {
          throw new functions.https.HttpsError(
            "already-exists",
            "You already referred this worker for this job."
          );
        }

        tx.set(referralRef, {
          jobId,
          type,
          posterId: resolvedPosterId,
          workerId: resolvedWorkerId,
          note: note || null,
          status: "created",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      await db.collection(NOTIFICATIONS_COLLECTION).add({
        senderID: resolvedPosterId,
        senderName: posterProfile.fullName,
        receiverID: resolvedWorkerId,

        jobID: jobId,
        jobPosterId: job[JOB_POSTER_FIELD] || null,

        message: "You were referred to a job.",
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        read: false,

        type: "referral",
      });

      return { ok: true };
    }

    // -------------------------
    // invite (email share)
    // -------------------------
    if (type === "invite") {
      if (!name || !contact || !contactType) {
        throw new functions.https.HttpsError("invalid-argument", "Missing name/contact/contactType.");
      }

      if (contactType !== "email") {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Invite supports email only right now."
        );
      }

      const resolvedSenderId =
        senderId && String(senderId).trim() ? String(senderId).trim() : authUid;

      if (authUid !== resolvedSenderId) {
        throw new functions.https.HttpsError("permission-denied", "Not allowed.");
      }

      const normalizedEmail = normalizeEmail(contact);

      const dedupId = inviteDedupDocId({
        jobId,
        senderId: resolvedSenderId,
        email: normalizedEmail,
      });

      const referralRef = db.collection(REFERRALS_COLLECTION).doc(dedupId);

      await db.runTransaction(async (tx) => {
        const existing = await tx.get(referralRef);
        if (existing.exists) {
          throw new functions.https.HttpsError(
            "already-exists",
            "You already sent this person a referral for this job."
          );
        }

        tx.set(referralRef, {
          jobId,
          type,
          senderId: resolvedSenderId,
          invite: {
            name,
            contact: normalizedEmail,
            contactType: "email",
          },
          note: note || null,
          status: "created",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      const jobTitle = extractJobTitle(job);
      const neighborhood = extractNeighborhood(job) || "New York City";
      const payText = extractPayText(job);
      const jobLink = buildJobUniversalLink(jobId);

      const subjectLine = `OddJobs referral: ${jobTitle}`;

      const noteBlock =
        note && String(note).trim().length > 0
          ? `\nMessage:\n${String(note).trim()}\n`
          : "";

      const bodyText =
`Hi ${name},

Someone shared an OddJobs listing with you:

${jobTitle}
Neighborhood: ${neighborhood}
Pay: ${payText}
${noteBlock}
View the job:
${jobLink}

If you have the OddJobs app installed, this link should open the job directly.
`;

      await sendEmailViaGmail({
        toEmail: normalizedEmail,
        subjectLine,
        bodyText,
      });

      return { ok: true };
    }

    throw new functions.https.HttpsError("invalid-argument", "Invalid referral type.");
  });

// -----------------------------
// Callable: sendReferralEmail (direct use / testing)
// -----------------------------
exports.sendReferralEmail = functions
  .runWith({ secrets: ["GOOGLE_SERVICE_ACCOUNT_JSON"] })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
    }

    const { toEmail, subjectLine, bodyText } = data || {};
    if (!toEmail || !subjectLine || !bodyText) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing toEmail/subjectLine/bodyText."
      );
    }

    await sendEmailViaGmail({ toEmail, subjectLine, bodyText });
    return { ok: true };
  });