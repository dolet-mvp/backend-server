const express = require("express");
const router = express.Router();
const {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearReadNotifications,
  getUnreadCount,
} = require("../../controllers/notificationController/notificationController");
const { checkForAuthenticationCookie, checkUserType } = require("../../middleware/authMiddleware");

// Get notifications
router.get(
  "/",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  getNotifications
);

router.get(
  "/unread-count",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  getUnreadCount
);

// Mark as read
router.patch(
  "/:notificationId/read",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  markAsRead
);

router.patch(
  "/mark-all-read",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  markAllAsRead
);

// Delete notifications
router.delete(
  "/:notificationId",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  deleteNotification
);

router.delete(
  "/clear-read",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  clearReadNotifications
);

module.exports = router;
