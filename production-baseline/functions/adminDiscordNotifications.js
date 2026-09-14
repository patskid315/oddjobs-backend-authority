const functions = require("firebase-functions");

function getWebhook(alert) {

    const discord =
        functions.config().discord;

    const source =
        alert.sourceCollection;

    const severity =
        alert.severity || "standard";

    // High priority always goes admin
    if (severity === "high") {
        return discord.admin_alerts_url;
    }

    // Users
    if (
        source === "users" ||
        source === "updateAddress_requests" ||
        source === "updateVerificationID_requests"
    ) {
        return discord.user_activity_url;
    }

    // Jobs
    if (
        source === "jobPost" ||
        source === "jobRequests"
    ) {
        return discord.job_activity_url;
    }

    // Payments / money movement
    if (
        source === "payments" ||
        source === "withdraws"
    ) {
        return discord.payment_alerts_url;
    }

    // Fallback
    return discord.admin_alerts_url;

}

exports.onAdminAlertCreatedDiscord =
functions.firestore
.document("adminAlerts/{alertId}")
.onCreate(async (snap, context) => {

    const alert =
        snap.data();

    const alertId =
        context.params.alertId;

    const webhookUrl =
        getWebhook(alert);

    if (!webhookUrl) {

        console.error(
            "Discord webhook missing."
        );

        return null;

    }

    const colorMap = {

        high: 15158332,
        standard: 3447003,
        info: 3066993

    };

    const payload = {

        username:
            "OddJobs Admin Bot",

        embeds: [

            {

                title:
                    alert.title ||
                    "OddJobs Alert",

                description:
                    alert.message ||
                    "New alert created.",

                color:
                    colorMap[
                        alert.severity
                    ] || 3447003,

                fields: [

                    {

                        name:
                            "Type",

                        value:
                            alert.alertType ||
                            "unknown",

                        inline:
                            true

                    },

                    {

                        name:
                            "Severity",

                        value:
                            alert.severity ||
                            "standard",

                        inline:
                            true

                    },

                    {

                        name:
                            "Source",

                        value:
                            `${alert.sourceCollection || "unknown"} / ${alert.sourceId || alertId}`,

                        inline:
                            false

                    }

                ],

                footer: {

                    text:
                        "OddJobs Admin"

                },

                timestamp:
                    new Date()
                    .toISOString()

            }

        ]

    };

    try {

        const response =
            await fetch(
                webhookUrl,
                {

                    method:
                        "POST",

                    headers: {

                        "Content-Type":
                            "application/json"

                    },

                    body:
                        JSON.stringify(
                            payload
                        )

                }
            );

        if (!response.ok) {

            const error =
                await response.text();

            console.error(
                "Discord webhook failed:",
                response.status,
                error
            );

        }

    } catch (error) {

        console.error(
            "Discord notification error:",
            error
        );

    }

    return null;

});