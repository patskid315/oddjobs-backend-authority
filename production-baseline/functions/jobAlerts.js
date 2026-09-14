const functions = require("firebase-functions");
const nodemailer = require("nodemailer");

// 🚫 GLOBAL KILL SWITCH
const EMAILS_ENABLED = false;

// Email (via Gmail or Mailgun)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: functions.config().notify.email,
    pass: functions.config().notify.password
  }
});

exports.observeJobPosts = functions.firestore
  .document("jobPost/{jobId}")
  .onCreate(async (snap, context) => {

    // 🚫 STOP ALL EMAILS IMMEDIATELY
    if (!EMAILS_ENABLED) {
      console.log("🚫 Email sending is disabled");
      return null;
    }

    const job = snap.data();
    const jobId = context.params.jobId;

    if (!job || !job.title || !job.userId) {
      console.warn("❌ Incomplete job data, skipping notification.");
      return null;
    }

    const postedAt = job.timestamp?.toDate?.()
      ? job.timestamp.toDate().toLocaleString()
      : new Date().toLocaleString();

    const message = `
📢 New Job Posted on OddJobs

🆔 Job ID: ${jobId}
📝 Title: ${job.title}
📍 Category: ${job.category || "N/A"}
🏠 Address: ${job.streetAddress || ""} ${job.apartment ? 'Apt ' + job.apartment : ""}
📮 Borough: ${job.borough || "N/A"}, Neighborhood: ${job.neighborhood || "N/A"}
📬 Postal Code: ${job.postalCode || "N/A"}

💵 Set Price: $${job.setPrice || 0}
🧾 Subtotal: $${job.subTotal || 0}
💸 Fees: $${job.fees || 0}
💰 Total Cost: $${job.totalCost || 0}

🕒 Estimated Duration: ${job.totalDuration || "N/A"}
📅 Posted: ${postedAt}
👤 Posted by User ID: ${job.userId}

🔧 Requirements: ${Array.isArray(job.requirements) ? job.requirements.filter(Boolean).length + " selected" : "N/A"}
🗂 Progress Status: ${job.progressStatus || "N/A"}
🧪 Synthetic Job: ${job.isSynthetic ? "Yes" : "No"}

📝 Description:
${job.jobDescription || "No description provided."}
`;

    // Send Email
    try {
      await transporter.sendMail({
        from: '"OddJobs NYC" <support@theoddjobsapp.com>',
        to: "zach@theoddjobsapp.com",
        subject: `🆕 New Job: ${job.title}`,
        text: message
      });
      console.log(`📧 Email sent for job ${jobId}`);
    } catch (emailError) {
      console.error("❌ Failed to send email notification:", emailError);
    }

    return null;
  });