const admin = require("firebase-admin");
const DeviceToken = require("../models/deviceTokenModel/deviceToken");
const path = require("path");

let firebaseInitialized = false;

/**
 * Initialize Firebase Admin SDK
 */
const initializeFirebase = () => {
  try {
    if (!firebaseInitialized) {
      // Check if service account key path is provided
      const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
      
      if (!serviceAccountPath) {
        console.warn("⚠️  FIREBASE_SERVICE_ACCOUNT_PATH not set. Push notifications will be disabled.");
        return false;
      }
      
      // Try to load service account from path
      try {
        // Resolve the path relative to the project root
        const resolvedPath = path.resolve(process.cwd(), serviceAccountPath);
        const serviceAccount = require(resolvedPath);
        
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
        
        firebaseInitialized = true;
        console.log("🔥 Firebase Admin SDK initialized successfully");
      } catch (error) {
        console.warn("⚠️  Firebase service account not found. Push notifications will be disabled.");
        console.warn(`   Tried loading from: ${serviceAccountPath}`);
        console.warn(`   Error: ${error.message}`);
        return false;
      }
    }
    return true;
  } catch (error) {
    console.error("❌ Error initializing Firebase:", error.message);
    return false;
  }
};

/**
 * Send push notification to a single device
 * @param {string} token - FCM device token
 * @param {object} notification - Notification data
 * @param {object} data - Additional data payload
 */
const sendToDevice = async (token, notification, data = {}) => {
  if (!firebaseInitialized) {
    if (!initializeFirebase()) {
      return { success: false, error: "Firebase not initialized" };
    }
  }

  try {
    // Support both notification.body and notification.message formats
    const notificationBody = notification.body || notification.message;
    
    if (!notificationBody || !notification.title) {
      console.error('❌ Invalid notification format:', { title: notification.title, body: notificationBody });
      return { success: false, error: "Missing title or body in notification" };
    }
    
    console.log(`📤 [PUSH] Sending to token: ${token.substring(0, 20)}... | Title: ${notification.title}`);
    
    // Convert all data values to strings (Firebase requirement)
    const stringifiedData = {};
    for (const [key, value] of Object.entries(data)) {
      stringifiedData[key] = String(value);
    }
    
    const message = {
      token,
      notification: {
        title: notification.title,
        body: notificationBody,
      },
      data: {
        ...stringifiedData,
        notificationId: stringifiedData.notificationId || "",
        type: stringifiedData.type || "general",
        priority: stringifiedData.priority || "medium",
      },
      android: {
        priority: data.priority === "high" ? "high" : "normal",
        notification: {
          channelId: "default",
          sound: "default",
          priority: data.priority === "high" ? "high" : "default",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: data.badge || 1,
          },
        },
      },
    };

    const response = await admin.messaging().send(message);
    console.log(`✅ Push notification sent successfully: ${response}`);
    
    return { success: true, messageId: response };
  } catch (error) {
    console.error("❌ Error sending push notification:", error);
    
    // Handle invalid token errors
    if (
      error.code === "messaging/invalid-registration-token" ||
      error.code === "messaging/registration-token-not-registered"
    ) {
      // Mark token as inactive
      await DeviceToken.update(
        { isActive: false },
        { where: { token } }
      );
      console.log(`🗑️  Marked invalid token as inactive: ${token.substring(0, 20)}...`);
    }
    
    return { success: false, error: error.message };
  }
};

/**
 * Send push notification to a user (all their devices)
 * @param {string} userId - User ID
 * @param {string} userType - User type (helper/helpseeker)
 * @param {object} notification - Notification data
 * @param {object} data - Additional data payload
 */
const sendToUser = async (userId, userType, notification, data = {}) => {
  if (!firebaseInitialized) {
    if (!initializeFirebase()) {
      return { success: false, error: "Firebase not initialized" };
    }
  }

  try {
    console.log(`🔍 [PUSH] Sending to ${userType} ${userId} | Title: ${notification.title || notification.message}`);
    
    // Get all active device tokens for the user
    const whereClause = { isActive: true, userType };
    if (userType === "helper") {
      whereClause.helperId = userId;
    } else if (userType === "helpseeker") {
      whereClause.helpseekerId = userId;
    }

    console.log(`🔍 [PUSH] Query where:`, JSON.stringify(whereClause));
    
    const deviceTokens = await DeviceToken.findAll({
      where: whereClause,
    });

    console.log(`📱 [PUSH] Found ${deviceTokens.length} device token(s) for ${userType} ${userId}`);
    
    if (deviceTokens.length === 0) {
      console.log(`⚠️ [PUSH] No active device tokens found for user ${userId}`);
      return { success: true, message: "No devices to send to" };
    }

    // FIX DUPLICATE NOTIFICATIONS: Send only to the most recently used device
    // This prevents sending the same notification 3-8 times when user has multiple devices
    const mostRecentDevice = deviceTokens.reduce((latest, current) => {
      const latestTime = latest.lastUsed ? new Date(latest.lastUsed).getTime() : 0;
      const currentTime = current.lastUsed ? new Date(current.lastUsed).getTime() : 0;
      return currentTime > latestTime ? current : latest;
    }, deviceTokens[0]);

    console.log(`📱 [PUSH] Sending to most recent device only (of ${deviceTokens.length} available)`);

    // Send to only the most recent device
    const result = await sendToDevice(mostRecentDevice.token, notification, data);

    if (result.success) {
      console.log(`✅ Sent push notification to user ${userId}: 1 success, 0 failed`);
      
      // Update last used timestamp
      await DeviceToken.update(
        { lastUsed: new Date() },
        { where: { token: mostRecentDevice.token } }
      );

      return {
        success: true,
        totalSent: 1,
        successCount: 1,
        failCount: 0,
      };
    } else {
      console.log(`❌ Failed to send push notification to user ${userId}`);
      return {
        success: false,
        totalSent: 1,
        successCount: 0,
        failCount: 1,
      };
    }
  } catch (error) {
    console.error("Error sending push notification to user:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Send push notification to multiple users
 * @param {Array} users - Array of {userId, userType} objects
 * @param {object} notification - Notification data
 * @param {object} data - Additional data payload
 */
const sendToMultipleUsers = async (users, notification, data = {}) => {
  if (!firebaseInitialized) {
    if (!initializeFirebase()) {
      return { success: false, error: "Firebase not initialized" };
    }
  }

  try {
    const results = await Promise.allSettled(
      users.map((user) =>
        sendToUser(user.userId, user.userType, notification, data)
      )
    );

    const successCount = results.filter(
      (r) => r.status === "fulfilled" && r.value.success
    ).length;

    console.log(
      `📊 Sent push notifications to ${successCount}/${users.length} users`
    );

    return { success: true, totalUsers: users.length, successCount };
  } catch (error) {
    console.error("Error sending push notifications to multiple users:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Register or update device token
 * @param {string} userId - User ID
 * @param {string} userType - User type (helper/helpseeker)
 * @param {string} token - FCM device token
 * @param {string} platform - Platform (android/ios)
 * @param {object} deviceInfo - Additional device information
 */
const registerDeviceToken = async (
  userId,
  userType,
  token,
  platform,
  deviceInfo = {}
) => {
  try {
    const userIdField = userType === "helper" ? "helperId" : "helpseekerId";

    // Check if token already exists
    const existingToken = await DeviceToken.findOne({
      where: { token },
    });

    if (existingToken) {
      // Update existing token
      await existingToken.update({
        [userIdField]: userId,
        userType,
        platform,
        isActive: true,
        lastUsed: new Date(),
        deviceInfo,
      });

      console.log(`✅ Updated device token for user ${userId}`);
      return { success: true, message: "Device token updated", isNew: false };
    } else {
      // Create new token
      await DeviceToken.create({
        [userIdField]: userId,
        userType,
        token,
        platform,
        isActive: true,
        lastUsed: new Date(),
        deviceInfo,
      });

      console.log(`✅ Registered new device token for user ${userId}`);
      return {
        success: true,
        message: "Device token registered",
        isNew: true,
      };
    }
  } catch (error) {
    console.error("Error registering device token:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Unregister device token
 * @param {string} token - FCM device token
 */
const unregisterDeviceToken = async (token) => {
  try {
    await DeviceToken.update(
      { isActive: false },
      { where: { token } }
    );

    console.log(`✅ Unregistered device token`);
    return { success: true, message: "Device token unregistered" };
  } catch (error) {
    console.error("Error unregistering device token:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Get all device tokens for a user
 * @param {string} userId - User ID
 * @param {string} userType - User type (helper/helpseeker)
 */
const getUserDeviceTokens = async (userId, userType) => {
  try {
    const whereClause = { userType };
    if (userType === "helper") {
      whereClause.helperId = userId;
    } else if (userType === "helpseeker") {
      whereClause.helpseekerId = userId;
    }

    const tokens = await DeviceToken.findAll({
      where: whereClause,
      order: [["lastUsed", "DESC"]],
    });

    return { success: true, tokens };
  } catch (error) {
    console.error("Error getting user device tokens:", error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  initializeFirebase,
  sendToDevice,
  sendToUser,
  sendToMultipleUsers,
  registerDeviceToken,
  unregisterDeviceToken,
  getUserDeviceTokens,
};
