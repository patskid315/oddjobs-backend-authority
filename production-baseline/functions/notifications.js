const functions = require("firebase-functions");
const admin = require("./admin");
const { getFirestore, FieldValue } = require("firebase-admin/firestore"); // ✅ add FieldValue

exports.observeJobComments = functions.firestore
  .document("jobPost/{jobId}/comments/{commentId}")
  .onCreate(async (snap, context) => {
    const { jobId, commentId } = context.params;
    const comment = snap.data();

    if (!comment) return;

    const authorId = comment.authorId;
    const authorName = comment.authorName || "Someone";
    const authorAvatarURL = comment.authorAvatarURL || "";

    // mentionedUserIds is what your Swift writes
    const mentionedUserIds = Array.isArray(comment.mentionedUserIds)
      ? comment.mentionedUserIds.filter(Boolean)
      : [];

    // Fetch job to get posterId
    const jobSnap = await getFirestore().collection("jobPost").doc(jobId).get();
    const job = jobSnap.data();
    const posterId = job?.userId;

    if (!posterId) return;

    // ✅ Build recipient set (never notify the author)
    const recipients = new Set();

    // Poster should be notified unless author is the poster
    if (posterId !== authorId) recipients.add(posterId);

    // Mentioned users should be notified unless they are the author
    for (const uid of mentionedUserIds) {
      if (uid !== authorId) recipients.add(uid);
    }

    if (recipients.size === 0) return;

    // ✅ Dedupe rule:
    // If the poster is mentioned, they should receive ONLY ONE notification.
    // We'll prioritize "mention" over "comment".
    const posterWasMentioned = mentionedUserIds.includes(posterId);

    const batch = getFirestore().batch();

    for (const receiverID of recipients) {
      // Decide type per receiver
      let type = "comment";

      if (receiverID === posterId) {
        type = posterWasMentioned ? "mention" : "comment";
      } else {
        // everyone else in recipients is a mention recipient
        type = "mention";
      }

      const notifRef = getFirestore().collection("notifications").doc();

      batch.set(notifRef, {
        receiverID,
        senderID: authorId,
        senderName: authorName,
        profileImageURL: authorAvatarURL,

        jobID: jobId,
        commentId,               // ✅ useful for deep linking later
        message: comment.body || "",
        type,

        read: false,
        timestamp: FieldValue.serverTimestamp()
      });
    }

    await batch.commit();
    return null;
  });

// Gen 1 Firestore Trigger
exports.observeFirestoreNotifications = functions.firestore
  .document("notifications/{notificationId}")
  .onCreate(async (snap, context) => {
    const notification = snap.data();

    if (!notification?.receiverID) {
      console.warn("❌ Missing receiverID in notification data");
      return;
    }

    const userSnap = await getFirestore().collection("users").doc(notification.receiverID).get();
    const user = userSnap.data();

    if (!user?.fcmToken) {
      console.warn(`❌ No user or FCM token found for receiverID: ${notification.receiverID}`);
      return;
    }

    const senderName = notification.senderName || "Someone";

    const messages = {
      request: ["Job Request", `${senderName} requested to complete your job.`],
      assigned: ["You’ve Been Assigned", `${senderName} assigned you to a job.`],
      inProgress: ["Job Started", `${senderName} has started working on your job.`],
      completed: ["Job Completed", `${senderName} has completed the job.`],
      pay: ["Payment Sent", `${senderName} paid you for a job.`],
      review: ["New Review", `${senderName} left you a review.`],
      rejected: ["Request Rejected", `${senderName} rejected your job request.`],
      comment: ["New Comment", `${senderName} commented on your job.`],
      mention: ["You Were Mentioned", `${senderName} mentioned you in a comment.`]
    };

    const [title, body] = messages[notification.type] || [
      "OddJobs Notification",
      notification.message || "You have a new update."
    ];

    const payload = {
      token: user.fcmToken,
      notification: { title, body },
      apns: {
        payload: {
          aps: {
            alert: { title, body },
            sound: "default",
            badge: 1
          }
        }
      }
    };

    console.log(`📬 Sending "${title}" to user ${notification.receiverID}`);
    return admin.messaging().send(payload);
  });