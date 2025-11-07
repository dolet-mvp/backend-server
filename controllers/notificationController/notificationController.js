const Notification = require("../../models/notificationModel/notificationModel");
const Task = require("../../models/taskModel/taskModel");

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

// Mark notification as read
const markAsRead = async (req, res) => {
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

    notification.isRead = true;
    await notification.save();

    res.status(200).json({
      success: true,
      message: "Notification marked as read",
      data: notification,
    });
  } catch (error) {
    console.error("Mark as read error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark notification as read",
      error: error.message,
    });
  }
};

// Mark all notifications as read
const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const userType = req.user.userType;

    const whereClause = { userType, isRead: false };
    if (userType === 'helper') {
      whereClause.helperId = userId;
    } else if (userType === 'helpseeker') {
      whereClause.helpseekerId = userId;
    }

    await Notification.update(
      { isRead: true },
      { where: whereClause }
    );

    res.status(200).json({
      success: true,
      message: "All notifications marked as read",
    });
  } catch (error) {
    console.error("Mark all as read error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark all notifications as read",
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

// Clear all read notifications
const clearReadNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const userType = req.user.userType;

    const whereClause = { userType, isRead: true };
    if (userType === 'helper') {
      whereClause.helperId = userId;
    } else if (userType === 'helpseeker') {
      whereClause.helpseekerId = userId;
    }

    await Notification.destroy({
      where: whereClause,
    });

    res.status(200).json({
      success: true,
      message: "Read notifications cleared successfully",
    });
  } catch (error) {
    console.error("Clear read notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to clear read notifications",
      error: error.message,
    });
  }
};

// Get unread count
const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;
    const userType = req.user.userType;

    const whereClause = { userType, isRead: false };
    if (userType === 'helper') {
      whereClause.helperId = userId;
    } else if (userType === 'helpseeker') {
      whereClause.helpseekerId = userId;
    }

    const unreadCount = await Notification.count({
      where: whereClause,
    });

    res.status(200).json({
      success: true,
      data: { unreadCount },
    });
  } catch (error) {
    console.error("Get unread count error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get unread count",
      error: error.message,
    });
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearReadNotifications,
  getUnreadCount,
};
