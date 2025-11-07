const express = require("express");
const router = express.Router();
const {
  getNotifications,
  deleteNotification,
} = require("../../controllers/notificationController/notificationController");
const { checkForAuthenticationCookie, checkUserType } = require("../../middleware/authMiddleware");

// Get all notifications (newest first)
router.get(
  "/",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  getNotifications
);

// Delete notification
router.delete(
  "/:notificationId",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  deleteNotification
);

module.exports = router;
