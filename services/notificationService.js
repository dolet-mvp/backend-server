const Notification = require("../models/notificationModel/notificationModel");
const { emitToUser, isUserConnected } = require("./socketService");
const { sendToUser } = require("./pushNotificationService");

/**
 * Centralized notification service that handles:
 * 1. Saving notification to database
 * 2. Sending real-time notification via Socket.IO
 * 3. Sending push notification via FCM
 * 
 * @param {Object} notificationData - Notification data
 * @param {string} notificationData.userId - User ID to send notification to
 * @param {string} notificationData.userType - User type (helper/helpseeker)
 * @param {string} notificationData.taskId - Task ID (optional)
 * @param {string} notificationData.title - Notification title
 * @param {string} notificationData.message - Notification message
 * @param {string} notificationData.type - Notification type
 * @param {string} notificationData.priority - Priority (low/medium/high)
 * @param {string} notificationData.actionUrl - Action URL (optional)
 * @param {Date} notificationData.expiresAt - Expiration date (optional)
 */
const createNotification = async (notificationData) => {
  try {
    const {
      userId,
      userType,
      taskId,
      title,
      message,
      type,
      priority = "medium",
      actionUrl,
      expiresAt,
    } = notificationData;

    // Validate required fields
    if (!userId || !userType || !title || !message || !type) {
      throw new Error("Missing required notification fields");
    }

    // Validate userType
    if (!["helper", "helpseeker"].includes(userType)) {
      throw new Error("Invalid userType. Must be 'helper' or 'helpseeker'");
    }

    // Prepare notification data for database
    const dbNotification = {
      userType,
      taskId: taskId || null,
      title,
      message,
      type,
      priority,
      actionUrl: actionUrl || null,
      expiresAt: expiresAt || null,
      isRead: false,
    };

    // Set the appropriate user ID field based on userType
    if (userType === "helper") {
      dbNotification.helperId = userId;
    } else if (userType === "helpseeker") {
      dbNotification.helpseekerId = userId;
    }

    // 1. Save notification to database
    console.log(`🔵 [NOTIFICATION SERVICE] Creating notification for user ${userId} (${userType})`);
    console.log(`🔵 [NOTIFICATION SERVICE] Notification data:`, JSON.stringify(dbNotification, null, 2));
    
    const savedNotification = await Notification.create(dbNotification);
    console.log(`✅ [NOTIFICATION SERVICE] Notification saved to DB: ${savedNotification.id}`);

    // Prepare notification payload for real-time and push
    const notificationPayload = {
      id: savedNotification.id,
      title: savedNotification.title,
      message: savedNotification.message,
      type: savedNotification.type,
      priority: savedNotification.priority,
      taskId: savedNotification.taskId,
      actionUrl: savedNotification.actionUrl,
      isRead: savedNotification.isRead,
      createdAt: savedNotification.createdAt,
    };
    console.log(`📦 [NOTIFICATION SERVICE] Notification payload:`, JSON.stringify(notificationPayload, null, 2));

    // 2. Send real-time notification via Socket.IO if user is connected
    try {
      console.log(`🔌 [NOTIFICATION SERVICE] Checking if user ${userId} is connected...`);
      const connected = isUserConnected(userId);
      console.log(`🔌 [NOTIFICATION SERVICE] User ${userId} connection status: ${connected ? 'CONNECTED' : 'NOT CONNECTED'}`);
      
      if (connected) {
        console.log(`📡 [NOTIFICATION SERVICE] Emitting notification to user ${userId} (${userType})...`);
        emitToUser(userId, userType, "notification", notificationPayload);
        console.log(`✅ [NOTIFICATION SERVICE] Real-time notification emitted to ${userId}`);
      } else {
        console.log(`⚠️  [NOTIFICATION SERVICE] User ${userId} not connected via socket - will rely on FCM`);
      }
    } catch (socketError) {
      console.error("❌ [NOTIFICATION SERVICE] Error sending socket notification:", socketError);
      // Continue even if socket fails
    }

    // 3. Send push notification via FCM
    try {
      console.log(`📱 [NOTIFICATION SERVICE] Attempting to send FCM push notification to user ${userId}...`);
      
      const pushResult = await sendToUser(
        userId,
        userType,
        {
          title: savedNotification.title,
          message: savedNotification.message,
        },
        {
          notificationId: savedNotification.id,
          type: savedNotification.type,
          priority: savedNotification.priority,
          taskId: savedNotification.taskId || "",
          actionUrl: savedNotification.actionUrl || "",
        }
      );

      console.log(`📊 [NOTIFICATION SERVICE] FCM push result:`, JSON.stringify(pushResult, null, 2));
      
      if (pushResult.success) {
        console.log(`✅ [NOTIFICATION SERVICE] FCM push notification sent to user ${userId}`);
      } else {
        console.warn(`⚠️  [NOTIFICATION SERVICE] FCM push failed:`, pushResult.error || 'Unknown error');
      }
    } catch (pushError) {
      console.error("❌ [NOTIFICATION SERVICE] Error sending push notification:", pushError);
      console.error("📋 [NOTIFICATION SERVICE] Push error stack:", pushError.stack);
      // Continue even if push fails
    }

    return {
      success: true,
      notification: savedNotification,
      message: "Notification sent successfully",
    };
  } catch (error) {
    console.error("❌ Error creating notification:", error);
    throw error;
  }
};

/**
 * Create multiple notifications at once
 * @param {Array} notificationsData - Array of notification data objects
 */
const createBulkNotifications = async (notificationsData) => {
  try {
    const results = await Promise.allSettled(
      notificationsData.map((data) => createNotification(data))
    );

    const successCount = results.filter(
      (r) => r.status === "fulfilled"
    ).length;
    const failCount = results.length - successCount;

    console.log(
      `📊 Bulk notifications: ${successCount} success, ${failCount} failed`
    );

    return {
      success: true,
      totalSent: notificationsData.length,
      successCount,
      failCount,
      results,
    };
  } catch (error) {
    console.error("Error creating bulk notifications:", error);
    throw error;
  }
};

/**
 * Get unread notification count for a user
 * @param {string} userId - User ID
 * @param {string} userType - User type (helper/helpseeker)
 */
const getUnreadCount = async (userId, userType) => {
  try {
    const whereClause = { isRead: false, userType };
    if (userType === "helper") {
      whereClause.helperId = userId;
    } else if (userType === "helpseeker") {
      whereClause.helpseekerId = userId;
    }

    const count = await Notification.count({ where: whereClause });
    return { success: true, count };
  } catch (error) {
    console.error("Error getting unread count:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Mark notification as read
 * @param {string} notificationId - Notification ID
 * @param {string} userId - User ID
 * @param {string} userType - User type (helper/helpseeker)
 */
const markAsRead = async (notificationId, userId, userType) => {
  try {
    const whereClause = { id: notificationId, userType };
    if (userType === "helper") {
      whereClause.helperId = userId;
    } else if (userType === "helpseeker") {
      whereClause.helpseekerId = userId;
    }

    const result = await Notification.update(
      { isRead: true },
      { where: whereClause }
    );

    if (result[0] === 0) {
      return { success: false, message: "Notification not found" };
    }

    // Emit update via socket
    try {
      emitToUser(userId, userType, "notificationRead", { notificationId });
    } catch (error) {
      console.error("Error emitting read status:", error);
    }

    return { success: true, message: "Notification marked as read" };
  } catch (error) {
    console.error("Error marking notification as read:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Mark all notifications as read for a user
 * @param {string} userId - User ID
 * @param {string} userType - User type (helper/helpseeker)
 */
const markAllAsRead = async (userId, userType) => {
  try {
    const whereClause = { isRead: false, userType };
    if (userType === "helper") {
      whereClause.helperId = userId;
    } else if (userType === "helpseeker") {
      whereClause.helpseekerId = userId;
    }

    await Notification.update({ isRead: true }, { where: whereClause });

    // Emit update via socket
    try {
      emitToUser(userId, userType, "allNotificationsRead", {});
    } catch (error) {
      console.error("Error emitting read status:", error);
    }

    return { success: true, message: "All notifications marked as read" };
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Delete old read notifications (cleanup)
 * @param {number} daysOld - Delete notifications older than this many days
 */
const cleanupOldNotifications = async (daysOld = 30) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await Notification.destroy({
      where: {
        isRead: true,
        createdAt: {
          [require("sequelize").Op.lt]: cutoffDate,
        },
      },
    });

    console.log(`🧹 Cleaned up ${result} old notifications`);
    return { success: true, deletedCount: result };
  } catch (error) {
    console.error("Error cleaning up notifications:", error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  createNotification,
  createBulkNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  cleanupOldNotifications,
};
