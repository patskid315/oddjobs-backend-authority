// index.js

require("./admin");

// Re-export all functions from payments and notifications
module.exports = {
  ...require("./payments"),
  ...require("./notifications"),
  ...require("./userRegistration"),
  ...require("./jobAlerts"),
  ...require("./referrals"),
  ...require("./connections"),
  ...require("./adminActivity"),
  ...require("./adminDiscordNotifications"),
  ...require("./adminData")
};