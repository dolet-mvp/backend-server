const Notification = require("../../models/notificationModel/notificationModel");
const Task = require("../../models/taskModel/taskModel");
const {
  registerDeviceToken,
  unregisterDeviceToken,
  getUserDeviceTokens,
} = require("../../services/pushNotificationService");
const { markAsRead, markAllAsRead } = require("../../services/notificationService");

// Get all notifications for user
const getNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const userType = req.user.userType;
    const { isRead, type, limit = 50 } = req.query;

    let whereClause = { userType };
    
    // Add polymorphic user ID based on user type
    if (userType === 'helper') {
      whereClause.helperId = userId;
    } else if (userType === 'helpseeker') {
      whereClause.helpseekerId = userId;
    }

    if (isRead !== undefined) {
      whereClause.isRead = isRead === "true";
    }

    if (type) {
      whereClause.type = type;
    }

    const notifications = await Notification.findAll({
      where: whereClause,
      include: [
        {
          model: Task,
          as: "task",
          attributes: ["id", "title", "status"],
          required: false,
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit),
    });

    // Count unread notifications
    const unreadCountWhere = { userType, isRead: false };
    if (userType === 'helper') {
      unreadCountWhere.helperId = userId;
    } else if (userType === 'helpseeker') {
      unreadCountWhere.helpseekerId = userId;
    }
    
    const unreadCount = await Notification.count({
      where: unreadCountWhere,
    });

    res.status(200).json({
      success: true,
      data: {
        notifications,
        unreadCount,
      },
    });
  } catch (error) {
    console.error("Get notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
      error: error.message,
    });
  }
};





// Delete notification
const deleteNotification = async (req, res) => {
  try {
    const userId = req.user.id;
    const userType = req.user.userType;
    const { notificationId } = req.params;

    const whereClause = { id: notificationId, userType };
    if (userType === 'helper') {
      whereClause.helperId = userId;
    } else if (userType === 'helpseeker') {
      whereClause.helpseekerId = userId;
    }

    const notification = await Notification.findOne({
      where: whereClause,
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    await notification.destroy();

    res.status(200).json({
      success: true,
      message: "Notification deleted successfully",
    });
  } catch (error) {
    console.error("Delete notification error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete notification",
      error: error.message,
    });
  }
};

// Mark notification as read
const markNotificationAsRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const userType = req.user.userType;
    const { notificationId } = req.params;

    const result = await markAsRead(notificationId, userId, userType);

    if (!result.success) {
      return res.status(404).json({
        success: false,
        message: result.message || "Failed to mark notification as read",
      });
    }

    res.status(200).json({
      success: true,
      message: "Notification marked as read",
    });
  } catch (error) {
    console.error("Mark notification as read error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark notification as read",
      error: error.message,
    });
  }
};

// Mark all notifications as read
const markAllNotificationsAsRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const userType = req.user.userType;

    await markAllAsRead(userId, userType);

    res.status(200).json({
      success: true,
      message: "All notifications marked as read",
    });
  } catch (error) {
    console.error("Mark all notifications as read error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark all notifications as read",
      error: error.message,
    });
  }
};

// Register device token for push notifications
const registerDevice = async (req, res) => {
  try {
    const userId = req.user.id;
    const userType = req.user.userType;
    const { token, platform, deviceInfo } = req.body;

    if (!token || !platform) {
      return res.status(400).json({
        success: false,
        message: "Token and platform are required",
      });
    }

    if (!["android", "ios", "web"].includes(platform)) {
      return res.status(400).json({
        success: false,
        message: "Invalid platform. Must be android, ios, or web",
      });
    }

    const result = await registerDeviceToken(
      userId,
      userType,
      token,
      platform,
      deviceInfo
    );

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.error || "Failed to register device",
      });
    }

    res.status(200).json({
      success: true,
      message: result.message,
      isNew: result.isNew,
    });
  } catch (error) {
    console.error("Register device error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to register device",
      error: error.message,
    });
  }
};

// Unregister device token
const unregisterDevice = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Token is required",
      });
    }

    const result = await unregisterDeviceToken(token);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.error || "Failed to unregister device",
      });
    }

    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    console.error("Unregister device error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to unregister device",
      error: error.message,
    });
  }
};

// Get user's registered devices
const getMyDevices = async (req, res) => {
  try {
    const userId = req.user.id;
    const userType = req.user.userType;

    const result = await getUserDeviceTokens(userId, userType);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.error || "Failed to get devices",
      });
    }

    res.status(200).json({
      success: true,
      data: result.tokens,
    });
  } catch (error) {
    console.error("Get devices error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get devices",
      error: error.message,
    });
  }
};

// Delete all notifications for user
const deleteAllNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const userType = req.user.userType;

    const whereClause = { userType };
    if (userType === 'helper') {
      whereClause.helperId = userId;
    } else if (userType === 'helpseeker') {
      whereClause.helpseekerId = userId;
    }

    const deletedCount = await Notification.destroy({
      where: whereClause,
    });

    res.status(200).json({
      success: true,
      message: `${deletedCount} notification(s) deleted successfully`,
      deletedCount,
    });
  } catch (error) {
    console.error("Delete all notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete notifications",
      error: error.message,
    });
  }
};




module.exports = {
  getNotifications,
  deleteNotification,
  deleteAllNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  registerDevice,
  unregisterDevice,
  getMyDevices,
};
