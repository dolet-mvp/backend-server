const express = require("express");
const router = express.Router();
const { checkForAuthenticationCookie, checkUserType } = require("../../middleware/authMiddleware");
const { isUserConnected } = require("../../services/socketService");
const DeviceToken = require("../../models/deviceTokenModel/deviceToken");

// Diagnostic endpoint to check user's notification status
router.get(
  "/diagnostic",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const userType = req.user.userType;

      console.log(`\ud83d\udd0d [DIAGNOSTIC] Checking notification status for user ${userId} (${userType})`);

      // Check socket connection
      const isSocketConnected = isUserConnected(userId);
      console.log(`\ud83d\udd0c [DIAGNOSTIC] Socket connected: ${isSocketConnected}`);

      // Check device tokens
      const whereClause = { userType };
      if (userType === "helper") {
        whereClause.helperId = userId;
      } else {
        whereClause.helpseekerId = userId;
      }

      const allTokens = await DeviceToken.findAll({ where: whereClause });
      const activeTokens = await DeviceToken.findAll({
        where: { ...whereClause, isActive: true },
      });

      console.log(`\ud83d\udcf1 [DIAGNOSTIC] Total device tokens: ${allTokens.length}`);
      console.log(`\u2705 [DIAGNOSTIC] Active device tokens: ${activeTokens.length}`);

      // Check Firebase initialization
      const admin = require("firebase-admin");
      let firebaseInitialized = false;
      try {
        admin.app();
        firebaseInitialized = true;
      } catch (error) {
        firebaseInitialized = false;
      }

      const diagnostic = {
        userId,
        userType,
        socket: {
          connected: isSocketConnected,
          status: isSocketConnected ? "✅ Connected" : "❌ Not Connected",
        },
        deviceTokens: {
          total: allTokens.length,
          active: activeTokens.length,
          tokens: activeTokens.map(t => ({
            id: t.id,
            platform: t.platform,
            deviceInfo: t.deviceInfo,
            lastUsed: t.lastUsed,
            createdAt: t.createdAt,
            tokenPreview: `${t.token.substring(0, 20)}...`,
          })),
          status: activeTokens.length > 0 ? "✅ Tokens registered" : "❌ No tokens registered",
        },
        firebase: {
          initialized: firebaseInitialized,
          status: firebaseInitialized ? "✅ Firebase initialized" : "❌ Firebase not initialized",
        },
        recommendations: [],
      };

      // Add recommendations
      if (!isSocketConnected) {
        diagnostic.recommendations.push("❌ Socket not connected - Check if app is running and connected to internet");
        diagnostic.recommendations.push("   Run: socketService.connect() in your app");
      }

      if (activeTokens.length === 0) {
        diagnostic.recommendations.push("❌ No device tokens registered - Push notifications won't work");
        diagnostic.recommendations.push("   Run: pushNotificationService.initialize() in your app");
      }

      if (!firebaseInitialized) {
        diagnostic.recommendations.push("❌ Firebase not initialized - Push notifications won't work");
        diagnostic.recommendations.push("   Add service-account-key.json to backend");
        diagnostic.recommendations.push("   Set FIREBASE_SERVICE_ACCOUNT_PATH in .env");
      }

      if (isSocketConnected && activeTokens.length > 0 && firebaseInitialized) {
        diagnostic.recommendations.push("✅ All systems operational - Notifications should work!");
      }

      res.status(200).json({
        success: true,
        diagnostic,
      });
    } catch (error) {
      console.error("❌ [DIAGNOSTIC] Error:", error);
      res.status(500).json({
        success: false,
        message: "Diagnostic failed",
        error: error.message,
      });
    }
  }
);

module.exports = router;
