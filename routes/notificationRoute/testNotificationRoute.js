const express = require("express");
const router = express.Router();
const { createNotification } = require("../../services/notificationService");
const { checkForAuthenticationCookie, checkUserType } = require("../../middleware/authMiddleware");

// TEST ENDPOINT - Send a test notification
router.post(
  "/test",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const userType = req.user.userType;

      console.log("🧪 [TEST] Sending test notification to:", userId, userType);

      // Send test notification
      const result = await createNotification({
        userId: userId,
        userType: userType,
        title: "Test Notification 🔔",
        message: `This is a test notification sent at ${new Date().toLocaleTimeString()}. If you see this, your notification system is working! 🎉`,
        type: "general",
        priority: "high",
      });

      console.log("✅ [TEST] Test notification sent successfully");

      res.status(200).json({
        success: true,
        message: "Test notification sent successfully!",
        data: result.notification,
      });
    } catch (error) {
      console.error("❌ [TEST] Error sending test notification:", error);
      res.status(500).json({
        success: false,
        message: "Failed to send test notification",
        error: error.message,
      });
    }
  }
);

// TEST ENDPOINT - Broadcast test to all connected users (admin only)
router.post(
  "/test-broadcast",
  checkForAuthenticationCookie(),
  async (req, res) => {
    try {
      const { broadcastToUserType, title, message } = req.body;

      console.log("🧪 [TEST] Broadcasting test notification");

      const { broadcastToUserType: broadcast } = require("../../services/socketService");

      broadcast(
        broadcastToUserType || "helper",
        "notification",
        {
          title: title || "Broadcast Test 📢",
          message: message || "This is a broadcast test notification",
          type: "general",
          priority: "medium",
        }
      );

      res.status(200).json({
        success: true,
        message: "Broadcast test sent!",
      });
    } catch (error) {
      console.error("❌ [TEST] Error broadcasting:", error);
      res.status(500).json({
        success: false,
        message: "Failed to broadcast",
        error: error.message,
      });
    }
  }
);

module.exports = router;
