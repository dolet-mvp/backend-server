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




module.exports = {
  getNotifications,
  deleteNotification,
};
