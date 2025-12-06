const express = require("express");
const router = express.Router();
const {
  getNotifications,
  deleteNotification,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  registerDevice,
  unregisterDevice,
  getMyDevices,
} = require("../../controllers/notificationController/notificationController");
const { checkForAuthenticationCookie, checkUserType } = require("../../middleware/authMiddleware");

// Get all notifications (newest first)
router.get(
  "/",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  getNotifications
);

// Mark notification as read
router.patch(
  "/:notificationId/read",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  markNotificationAsRead
);

// Mark all notifications as read
router.patch(
  "/read-all",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  markAllNotificationsAsRead
);

// Delete notification
router.delete(
  "/:notificationId",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  deleteNotification
);

// Register device for push notifications
router.post(
  "/device/register",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  registerDevice
);

// Unregister device from push notifications
router.post(
  "/device/unregister",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  unregisterDevice
);

// Get user's registered devices
router.get(
  "/device/my-devices",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  getMyDevices
);

module.exports = router;
