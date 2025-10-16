const TaskMessage = require("../../models/messageModel/taskMessageModel");
const Task = require("../../models/taskModel/taskModel");
const User = require("../../models/authModel/userModel");
const Notification = require("../../models/notificationModel/notificationModel");
const { Op } = require("sequelize");

/**
 * Send a message for a specific task
 * Both helpseeker and helper can send messages
 */
const sendTaskMessage = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { message } = req.body;
    const senderId = req.user.id;

    // Validate message
    if (!message || message.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Message content is required",
      });
    }

    // Find the task
    const task = await Task.findByPk(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    // Verify that the sender is either the task creator or assigned helper
    if (
      task.userId !== senderId &&
      task.assignedHelperId !== senderId
    ) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to send messages for this task",
      });
    }

    // Check if task is completed
    if (task.status === "completed") {
      return res.status(400).json({
        success: false,
        message: "Cannot send messages for completed tasks",
      });
    }

    // Handle file attachments if any
    let attachments = [];
    if (req.fileUrls && req.fileUrls.length > 0) {
      attachments = req.fileUrls;
    }

    // Create the message
    const taskMessage = await TaskMessage.create({
      taskId,
      senderId,
      message: message.trim(),
      attachments,
    });

    // Fetch the message with sender details
    const messageWithDetails = await TaskMessage.findByPk(taskMessage.id, {
      include: [
        {
          model: User,
          as: "sender",
          attributes: ["id", "firstName", "lastName", "email", "profilePicture"],
        },
      ],
    });

    // Send notification to the other user
    const receiverId = senderId === task.userId ? task.assignedHelperId : task.userId;
    if (receiverId) {
      await Notification.create({
        userId: receiverId,
        type: "general",
        title: "New Task Message",
        message: `You have a new message for task: ${task.title}`,
        relatedId: taskId,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Message sent successfully",
      data: messageWithDetails,
    });
  } catch (error) {
    console.error("Send task message error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send message",
      error: error.message,
    });
  }
};

/**
 * Get all messages for a specific task
 * Only task creator and assigned helper can view messages
 */
const getTaskMessages = async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.user.id;
    const { page = 1, limit = 50 } = req.query;

    // Find the task
    const task = await Task.findByPk(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    // Verify access
    if (task.userId !== userId && task.assignedHelperId !== userId) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to view messages for this task",
      });
    }

    // Calculate pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Get messages
    const { count, rows: messages } = await TaskMessage.findAndCountAll({
      where: { taskId },
      include: [
        {
          model: User,
          as: "sender",
          attributes: ["id", "firstName", "lastName", "email", "profilePicture"],
        },
      ],
      order: [["createdAt", "ASC"]],
      limit: parseInt(limit),
      offset: offset,
    });

    return res.status(200).json({
      success: true,
      message: "Messages retrieved successfully",
      data: {
        messages,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count / parseInt(limit)),
        },
        task: {
          id: task.id,
          title: task.title,
          status: task.status,
          creatorId: task.userId,
          helperId: task.assignedHelperId,
        },
      },
    });
  } catch (error) {
    console.error("Get task messages error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve messages",
      error: error.message,
    });
  }
};

/**
 * Delete a message
 * Only the sender can delete their own message
 */
const deleteTaskMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    // Find the message
    const message = await TaskMessage.findByPk(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    // Verify that the user is the sender
    if (message.senderId !== userId) {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own messages",
      });
    }

    // Delete the message
    await message.destroy();

    return res.status(200).json({
      success: true,
      message: "Message deleted successfully",
    });
  } catch (error) {
    console.error("Delete task message error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete message",
      error: error.message,
    });
  }
};

/**
 * Get all tasks with message counts for current user
 * Shows tasks where user is either creator or assigned helper
 */
const getMyTasksWithMessages = async (req, res) => {
  try {
    const userId = req.user.id;

    // Find all tasks where user is involved
    const tasks = await Task.findAll({
      where: {
        [Op.or]: [
          { userId: userId },
          { assignedHelperId: userId }
        ],
        assignedHelperId: { [Op.ne]: null }, // Only tasks with assigned helper
      },
      include: [
        {
          model: User,
          as: "creator",
          attributes: ["id", "firstName", "lastName", "profilePicture"],
        },
        {
          model: User,
          as: "assignedHelper",
          attributes: ["id", "firstName", "lastName", "profilePicture"],
        },
        {
          model: TaskMessage,
          as: "messages",
          attributes: ["id", "message", "createdAt", "senderId"],
          limit: 1,
          order: [["createdAt", "DESC"]],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    // Calculate message count for each task
    const tasksWithMessageCount = await Promise.all(
      tasks.map(async (task) => {
        const messageCount = await TaskMessage.count({
          where: { taskId: task.id },
        });

        return {
          id: task.id,
          title: task.title,
          status: task.status,
          creator: task.creator,
          assignedHelper: task.assignedHelper,
          messageCount,
          lastMessage: task.messages[0] || null,
          createdAt: task.createdAt,
        };
      })
    );

    return res.status(200).json({
      success: true,
      message: "Tasks with messages retrieved successfully",
      data: tasksWithMessageCount,
    });
  } catch (error) {
    console.error("Get my tasks with messages error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve tasks",
      error: error.message,
    });
  }
};

module.exports = {
  sendTaskMessage,
  getTaskMessages,
  deleteTaskMessage,
  getMyTasksWithMessages,
};
