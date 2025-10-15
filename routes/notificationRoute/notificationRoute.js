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

// Get notifications
router.get("/", getNotifications);
router.get("/unread-count", getUnreadCount);

// Mark as read
router.patch("/:notificationId/read", markAsRead);
router.patch("/mark-all-read", markAllAsRead);

// Delete notifications
router.delete("/:notificationId", deleteNotification);
router.delete("/clear-read", clearReadNotifications);

module.exports = router;
