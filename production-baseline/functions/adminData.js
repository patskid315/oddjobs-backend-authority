const functions = require("firebase-functions");
const admin = require("firebase-admin");

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

async function verifyAdmin(context) {

    if (!context.auth) {

        throw new functions.https.HttpsError(
            "unauthenticated",
            "Authentication required."
        );

    }

    const uid =
        context.auth.uid;

    const adminDoc =
        await db
            .collection("adminUsers")
            .doc(uid)
            .get();

    if (!adminDoc.exists) {

        throw new functions.https.HttpsError(
            "permission-denied",
            "Admin access not found."
        );

    }

    const adminUser =
        adminDoc.data();

    if (!adminUser.active) {

        throw new functions.https.HttpsError(
            "permission-denied",
            "Admin inactive."
        );

    }

    adminDoc.ref.update({

        lastLogin:
            admin.firestore.FieldValue.serverTimestamp()

    }).catch(console.error);

    return {

        uid,

        role:
            adminUser.role,

        email:
            adminUser.email,

        notificationsEnabled:
            adminUser.notificationsEnabled ?? true

    };

}

function formatDocs(snapshot) {

    return snapshot.docs.map(doc => ({

        id:
            doc.id,

        ...doc.data()

    }));

}

exports.getUsers =
functions.https.onCall(
async (data, context) => {

    await verifyAdmin(context);

    const snapshot =
        await db
            .collection("users")
            .limit(100)
            .get();

    return formatDocs(snapshot);

});

exports.getJobs =
functions.https.onCall(
async (data, context) => {

    await verifyAdmin(context);

    const snapshot =
        await db
            .collection("jobPost")
            .orderBy(
                "timestamp",
                "desc"
            )
            .limit(100)
            .get();

    return formatDocs(snapshot);

});

exports.getPayments =
functions.https.onCall(
async (data, context) => {

    await verifyAdmin(context);

    const snapshot =
        await db
            .collection("payments")
            .limit(100)
            .get();

    return formatDocs(snapshot);

});

exports.getWithdrawals =
functions.https.onCall(
async (data, context) => {

    await verifyAdmin(context);

    const snapshot =
        await db
            .collection("withdraws")
            .limit(100)
            .get();

    return formatDocs(snapshot);

});

exports.searchUsers =
functions.https.onCall(
async (data, context) => {

    await verifyAdmin(context);

    const query =
        (data.query || "")
        .toLowerCase()
        .trim();

    if (!query) {

        return [];

    }

    const snapshot =
        await db
            .collection("users")
            .limit(250)
            .get();

    return snapshot.docs
        .map(doc => ({

            id:
                doc.id,

            ...doc.data()

        }))
        .filter(user => {

            const email =
                user.email
                    ?.toLowerCase() || "";

            const name =
                user.name
                    ?.toLowerCase() || "";

            const phone =
                user.number
                    ?.toLowerCase() || "";

            const uid =
                user.uid
                    ?.toLowerCase() || "";

            return (

                email.includes(query)

                ||

                name.includes(query)

                ||

                phone.includes(query)

                ||

                uid.includes(query)

            );

        });

});

exports.getAdminActivity =
functions.https.onCall(
async (data, context) => {

    await verifyAdmin(context);

    const snapshot =
        await db
            .collection("adminActivity")
            .orderBy(
                "createdAt",
                "desc"
            )
            .limit(100)
            .get();

    return formatDocs(snapshot);

});

exports.getAdminAlerts =
functions.https.onCall(
async (data, context) => {

    await verifyAdmin(context);

    const snapshot =
        await db
            .collection("adminAlerts")
            .orderBy(
                "createdAt",
                "desc"
            )
            .limit(100)
            .get();

    return formatDocs(snapshot);

});