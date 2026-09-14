const functions = require("firebase-functions");
const admin = require("firebase-admin");

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

function sanitizeMetadata(data = {}) {
    const blockedKeys = [
        "message",
        "body",
        "text",
        "content",
        "card",
        "cardNumber",
        "paymentMethod",
        "clientSecret",
        "stripeSecret",
        "ssn",
        "idImage",
        "verificationImage",
        "bankAccount",
        "routingNumber",
        "accountNumber",
        "token",
        "secret",
        "password"
    ];

    const sanitized = {};

    Object.keys(data).forEach((key) => {
        if (!blockedKeys.includes(key)) {
            sanitized[key] = data[key];
        }
    });

    return sanitized;
}

function getPaymentStatus(data = {}) {
    return data.status || data.paymentStatus || "unknown";
}

function getGenericStatus(data = {}) {
    return data.status || data.progressStatus || data.paymentStatus || "unknown";
}

async function createAdminActivity({
    eventType,
    title,
    message,
    sourceCollection,
    sourceId,
    severity = "info",
    metadata = {}
}) {
    return db.collection("adminActivity").add({
        eventType,
        title,
        message,
        sourceCollection,
        sourceId,
        severity,
        metadata: sanitizeMetadata(metadata),
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
}

async function createAdminAlert({
    alertType,
    title,
    message,
    sourceCollection,
    sourceId,
    severity = "standard",
    status = "open",
    metadata = {}
}) {
    return db.collection("adminAlerts").add({
        alertType,
        title,
        message,
        sourceCollection,
        sourceId,
        severity,
        status,
        metadata: sanitizeMetadata(metadata),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        resolvedAt: null
    });
}

exports.onUserCreatedAdminActivity =
functions.firestore
.document("users/{userId}")
.onCreate(async (snap, context) => {
    const user = snap.data();
    const userId = context.params.userId;

    await createAdminActivity({
        eventType: "user_created",
        title: "New user signup",
        message: `${user.name || user.email || "New user"} joined OddJobs`,
        sourceCollection: "users",
        sourceId: userId,
        metadata: {
            userId,
            email: user.email || null,
            name: user.name || null,
            role: user.accountType || user.role || null
        }
    });

    return createAdminAlert({
        alertType: "new_signup",
        title: "New OddJobs signup",
        message: `${user.name || user.email || "New user"} created an account.`,
        sourceCollection: "users",
        sourceId: userId,
        severity: "standard",
        metadata: {
            userId,
            email: user.email || null,
            name: user.name || null,
            role: user.accountType || user.role || null
        }
    });
});

exports.onJobPostedAdminActivity =
functions.firestore
.document("jobPost/{jobId}")
.onCreate(async (snap, context) => {
    const job = snap.data();
    const jobId = context.params.jobId;

    await createAdminActivity({
        eventType: "job_posted",
        title: "Job posted",
        message: `${job.title || "Job"} created`,
        sourceCollection: "jobPost",
        sourceId: jobId,
        metadata: {
            jobId,
            title: job.title || null,
            userId: job.userId || null,
            category: job.category || null,
            borough: job.borough || null,
            neighborhood: job.neighborhood || null,
            totalCost: job.totalCost || job.setPrice || null,
            status: getGenericStatus(job)
        }
    });

    return createAdminAlert({
        alertType: "job_posted",
        title: "New job posted",
        message: `${job.title || "A job"} was posted.`,
        sourceCollection: "jobPost",
        sourceId: jobId,
        severity: "standard",
        metadata: {
            jobId,
            title: job.title || null,
            userId: job.userId || null,
            category: job.category || null,
            borough: job.borough || null,
            neighborhood: job.neighborhood || null,
            totalCost: job.totalCost || job.setPrice || null,
            status: getGenericStatus(job)
        }
    });
});

exports.onJobRequestAdminActivity =
functions.firestore
.document("jobRequests/{requestId}")
.onCreate(async (snap, context) => {
    const request = snap.data();
    const requestId = context.params.requestId;

    await createAdminActivity({
        eventType: "job_request",
        title: "Job request submitted",
        message: "Worker submitted request",
        sourceCollection: "jobRequests",
        sourceId: requestId,
        metadata: {
            requestId,
            workerId: request.workerId || request.userId || null,
            jobId: request.jobId || null,
            posterId: request.posterId || null,
            status: request.status || null
        }
    });

    return createAdminAlert({
        alertType: "job_request",
        title: "New job request",
        message: "A worker requested a job.",
        sourceCollection: "jobRequests",
        sourceId: requestId,
        severity: "standard",
        metadata: {
            requestId,
            workerId: request.workerId || request.userId || null,
            jobId: request.jobId || null,
            posterId: request.posterId || null,
            status: request.status || null
        }
    });
});

exports.onPaymentCreatedAdminActivity =
functions.firestore
.document("payments/{paymentId}")
.onCreate(async (snap, context) => {
    const payment = snap.data();
    const paymentId = context.params.paymentId;
    const paymentStatus = getPaymentStatus(payment);

    await createAdminActivity({
        eventType: "payment_created",
        title: "Payment created",
        message: "A payment record was created.",
        sourceCollection: "payments",
        sourceId: paymentId,
        metadata: {
            paymentId,
            jobId: payment.jobId || null,
            payerId: payment.payerId || payment.userId || null,
            workerId: payment.workerId || null,
            status: paymentStatus,
            amount: payment.amount || payment.totalCost || payment.subTotal || null
        }
    });

    const alertStatuses = [
        "failed",
        "requires_action",
        "requires_payment_method",
        "disputed",
        "refunded",
        "canceled"
    ];

    if (alertStatuses.includes(String(paymentStatus).toLowerCase())) {
        return createAdminAlert({
            alertType: "payment_issue",
            title: "Payment issue",
            message: `Payment status: ${paymentStatus}`,
            sourceCollection: "payments",
            sourceId: paymentId,
            severity: "high",
            metadata: {
                paymentId,
                jobId: payment.jobId || null,
                payerId: payment.payerId || payment.userId || null,
                workerId: payment.workerId || null,
                status: paymentStatus,
                amount: payment.amount || payment.totalCost || payment.subTotal || null
            }
        });
    }

    if (String(paymentStatus).toLowerCase() === "succeeded") {
        return createAdminAlert({
            alertType: "payment_completed",
            title: "Payment completed",
            message: "Payment completed successfully.",
            sourceCollection: "payments",
            sourceId: paymentId,
            severity: "standard",
            metadata: {
                paymentId,
                jobId: payment.jobId || null,
                payerId: payment.payerId || payment.userId || null,
                workerId: payment.workerId || null,
                amount: payment.amount || payment.totalCost || payment.subTotal || null
            }
        });
    }

    return null;
});

exports.onWithdrawalCreatedAdminActivity =
functions.firestore
.document("withdraws/{withdrawId}")
.onCreate(async (snap, context) => {
    const withdrawal = snap.data();
    const withdrawId = context.params.withdrawId;
    const withdrawalStatus = getGenericStatus(withdrawal);

    await createAdminActivity({
        eventType: "withdrawal_requested",
        title: "Withdrawal requested",
        message: "A worker requested a withdrawal.",
        sourceCollection: "withdraws",
        sourceId: withdrawId,
        metadata: {
            withdrawId,
            userId: withdrawal.userId || withdrawal.workerId || null,
            status: withdrawalStatus,
            amount: withdrawal.amount || null
        }
    });

    return createAdminAlert({
        alertType: "withdrawal_requested",
        title: "Withdrawal requested",
        message: "A worker requested a withdrawal.",
        sourceCollection: "withdraws",
        sourceId: withdrawId,
        severity: "standard",
        metadata: {
            withdrawId,
            userId: withdrawal.userId || withdrawal.workerId || null,
            status: withdrawalStatus,
            amount: withdrawal.amount || null
        }
    });
});

exports.onAddressUpdateRequestAdminActivity =
functions.firestore
.document("updateAddress_requests/{requestId}")
.onCreate(async (snap, context) => {
    const request = snap.data();
    const requestId = context.params.requestId;

    await createAdminActivity({
        eventType: "address_update_requested",
        title: "Address update requested",
        message: "A user submitted an address update request.",
        sourceCollection: "updateAddress_requests",
        sourceId: requestId,
        metadata: {
            requestId,
            userId: request.userId || request.uid || null,
            status: getGenericStatus(request)
        }
    });

    return createAdminAlert({
        alertType: "address_update_requested",
        title: "Address update requested",
        message: "A user submitted an address update request.",
        sourceCollection: "updateAddress_requests",
        sourceId: requestId,
        severity: "standard",
        metadata: {
            requestId,
            userId: request.userId || request.uid || null,
            status: getGenericStatus(request)
        }
    });
});

exports.onVerificationIdRequestAdminActivity =
functions.firestore
.document("updateVerificationID_requests/{requestId}")
.onCreate(async (snap, context) => {
    const request = snap.data();
    const requestId = context.params.requestId;

    await createAdminActivity({
        eventType: "verification_id_requested",
        title: "Verification ID submitted",
        message: "A user submitted verification information.",
        sourceCollection: "updateVerificationID_requests",
        sourceId: requestId,
        metadata: {
            requestId,
            userId: request.userId || request.uid || null,
            status: getGenericStatus(request)
        }
    });

    return createAdminAlert({
        alertType: "verification_id_requested",
        title: "Verification ID submitted",
        message: "A user submitted verification information.",
        sourceCollection: "updateVerificationID_requests",
        sourceId: requestId,
        severity: "standard",
        metadata: {
            requestId,
            userId: request.userId || request.uid || null,
            status: getGenericStatus(request)
        }
    });
});

exports.onPaymentUpdatedAdminActivity =
functions.firestore
.document("payments/{paymentId}")
.onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const paymentId = context.params.paymentId;

    const previousStatus = getPaymentStatus(before);
    const newStatus = getPaymentStatus(after);

    if (previousStatus === newStatus) {
        return null;
    }

    await createAdminActivity({
        eventType: "payment_status_updated",
        title: "Payment status updated",
        message: `Payment changed from ${previousStatus} to ${newStatus}.`,
        sourceCollection: "payments",
        sourceId: paymentId,
        metadata: {
            paymentId,
            jobId: after.jobId || null,
            payerId: after.payerId || after.userId || null,
            workerId: after.workerId || null,
            previousStatus,
            newStatus,
            amount: after.amount || after.totalCost || after.subTotal || null
        }
    });

    const alertStatuses = [
        "failed",
        "requires_action",
        "requires_payment_method",
        "disputed",
        "refunded",
        "canceled"
    ];

    if (alertStatuses.includes(String(newStatus).toLowerCase())) {
        return createAdminAlert({
            alertType: "payment_issue",
            title: "Payment needs attention",
            message: `Payment moved to ${newStatus}.`,
            sourceCollection: "payments",
            sourceId: paymentId,
            severity: "high",
            metadata: {
                paymentId,
                jobId: after.jobId || null,
                payerId: after.payerId || after.userId || null,
                workerId: after.workerId || null,
                previousStatus,
                newStatus,
                amount: after.amount || after.totalCost || after.subTotal || null
            }
        });
    }

    if (String(newStatus).toLowerCase() === "succeeded") {
        return createAdminAlert({
            alertType: "payment_completed",
            title: "Payment completed",
            message: "Payment completed successfully.",
            sourceCollection: "payments",
            sourceId: paymentId,
            severity: "standard",
            metadata: {
                paymentId,
                jobId: after.jobId || null,
                payerId: after.payerId || after.userId || null,
                workerId: after.workerId || null,
                amount: after.amount || after.totalCost || after.subTotal || null
            }
        });
    }

    return null;
});

exports.onWithdrawalUpdatedAdminActivity =
functions.firestore
.document("withdraws/{withdrawId}")
.onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const withdrawId = context.params.withdrawId;

    const previousStatus = getGenericStatus(before);
    const newStatus = getGenericStatus(after);

    if (previousStatus === newStatus) {
        return null;
    }

    await createAdminActivity({
        eventType: "withdrawal_status_updated",
        title: "Withdrawal status updated",
        message: `Withdrawal changed from ${previousStatus} to ${newStatus}.`,
        sourceCollection: "withdraws",
        sourceId: withdrawId,
        metadata: {
            withdrawId,
            userId: after.userId || after.workerId || null,
            previousStatus,
            newStatus,
            amount: after.amount || null
        }
    });

    const alertStatuses = [
        "failed",
        "rejected",
        "requires_review",
        "requires_action"
    ];

    if (alertStatuses.includes(String(newStatus).toLowerCase())) {
        return createAdminAlert({
            alertType: "withdrawal_issue",
            title: "Withdrawal needs attention",
            message: `Withdrawal moved to ${newStatus}.`,
            sourceCollection: "withdraws",
            sourceId: withdrawId,
            severity: "high",
            metadata: {
                withdrawId,
                userId: after.userId || after.workerId || null,
                previousStatus,
                newStatus,
                amount: after.amount || null
            }
        });
    }

    return null;
});

exports.onJobPostUpdatedAdminActivity =
functions.firestore
.document("jobPost/{jobId}")
.onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const jobId = context.params.jobId;

    const previousStatus = getGenericStatus(before);
    const newStatus = getGenericStatus(after);

    if (previousStatus === newStatus) {
        return null;
    }

    await createAdminActivity({
        eventType: "job_status_updated",
        title: "Job status updated",
        message: `Job changed from ${previousStatus} to ${newStatus}.`,
        sourceCollection: "jobPost",
        sourceId: jobId,
        metadata: {
            jobId,
            title: after.title || null,
            userId: after.userId || null,
            previousStatus,
            newStatus,
            category: after.category || null,
            borough: after.borough || null,
            neighborhood: after.neighborhood || null,
            totalCost: after.totalCost || after.setPrice || null
        }
    });

    const alertStatuses = [
        "completed",
        "paid",
        "cancelled",
        "canceled",
        "disputed"
    ];

    if (alertStatuses.includes(String(newStatus).toLowerCase())) {
        return createAdminAlert({
            alertType: "job_status_updated",
            title: "Job status changed",
            message: `Job moved to ${newStatus}.`,
            sourceCollection: "jobPost",
            sourceId: jobId,
            severity: String(newStatus).toLowerCase() === "disputed" ? "high" : "standard",
            metadata: {
                jobId,
                title: after.title || null,
                userId: after.userId || null,
                previousStatus,
                newStatus
            }
        });
    }

    return null;
});

exports.onAddressUpdateRequestUpdatedAdminActivity =
functions.firestore
.document("updateAddress_requests/{requestId}")
.onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const requestId = context.params.requestId;

    const previousStatus = getGenericStatus(before);
    const newStatus = getGenericStatus(after);

    if (previousStatus === newStatus) {
        return null;
    }

    return createAdminActivity({
        eventType: "address_update_status_updated",
        title: "Address request status updated",
        message: `Address request changed from ${previousStatus} to ${newStatus}.`,
        sourceCollection: "updateAddress_requests",
        sourceId: requestId,
        metadata: {
            requestId,
            userId: after.userId || after.uid || null,
            previousStatus,
            newStatus
        }
    });
});

exports.onVerificationIdRequestUpdatedAdminActivity =
functions.firestore
.document("updateVerificationID_requests/{requestId}")
.onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const requestId = context.params.requestId;

    const previousStatus = getGenericStatus(before);
    const newStatus = getGenericStatus(after);

    if (previousStatus === newStatus) {
        return null;
    }

    return createAdminActivity({
        eventType: "verification_id_status_updated",
        title: "Verification status updated",
        message: `Verification request changed from ${previousStatus} to ${newStatus}.`,
        sourceCollection: "updateVerificationID_requests",
        sourceId: requestId,
        metadata: {
            requestId,
            userId: after.userId || after.uid || null,
            previousStatus,
            newStatus
        }
    });
});