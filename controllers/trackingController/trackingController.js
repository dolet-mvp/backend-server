const Task = require("../../models/taskModel/taskModel");
const Notification = require("../../models/notificationModel/notificationModel");
const Helper = require("../../models/authModel/helperModel");
const Helpseeker = require("../../models/authModel/helpseekerModel");
const { createNotification } = require("../../services/notificationService");
const socketService = require("../../services/socketService");
const redis = require("../../config/redis/redis");
const { Op } = require("sequelize");

// Update helper status - On the way
const updateOnTheWay = async (req, res) => {
  try {
    const helperId = req.user.id;
    const { taskId } = req.params;


    if (req.user.userType !== "helper") {
      return res.status(403).json({
        success: false,
        message: "Only helpers can update tracking",
      });
    }

    const task = await Task.findOne({
      where: { id: taskId, assignedHelperId: helperId },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found or not assigned to you",
      });
    }

    if (task.status !== "assigned") {
      return res.status(400).json({
        success: false,
        message: "Task must be in assigned status",
      });
    }

    // Update task status to on_the_way
    task.status = "on_the_way";
    await task.save();

    // Notify helpseeker
    await createNotification({
      userId: task.helpseekerId,
      userType: 'helpseeker',
      taskId: task.id,
      title: "Helper is on the way",
      message: `Your helper is on the way to "${task.title}"`,
      type: "task_started",
      priority: "high",
    });

    res.status(200).json({
      success: true,
      message: "Status updated to on the way",
      data: {
        taskId: task.id,
        status: task.status,
        title: task.title,
      },
    });
  } catch (error) {
    console.error("Update on the way error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update status",
      error: error.message,
    });
  }
};

// Mark as arrived
const markArrived = async (req, res) => {
  try {
    const helperId = req.user.id;
    const { taskId } = req.params;

    const task = await Task.findOne({
      where: { id: taskId, assignedHelperId: helperId },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found or not assigned to you",
      });
    }

    // Update task status to arrived
    task.status = "arrived";
    await task.save();

    // Notify helpseeker
    await createNotification({
      userId: task.helpseekerId,
      userType: 'helpseeker',
      taskId: task.id,
      title: "Helper Arrived",
      message: `Your helper has arrived for "${task.title}"`,
      type: "task_started",
      priority: "high",
    });

    res.status(200).json({
      success: true,
      message: "Marked as arrived",
      data: {
        taskId: task.id,
        status: task.status,
        title: task.title,
      },
    });
  } catch (error) {
    console.error("Mark arrived error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark as arrived",
      error: error.message,
    });
  }
};


const completeWork = async (req, res) => {
  try {
    const helperId = req.user.id;
    const { taskId } = req.params;


    const task = await Task.findOne({
      where: { id: taskId, assignedHelperId: helperId },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found or not assigned to you",
      });
    }

    if (task.status !== "in_progress") {
      return res.status(400).json({
        success: false,
        message: "Task must be in progress to complete",
      });
    }

    // Calculate work duration from when task started (OTP verified)
    const workEndTime = new Date();
    const workDuration = task.startedAt
      ? Math.floor((workEndTime - new Date(task.startedAt)) / 60000)
      : 0;

    // Mark task as completed
    task.status = "completed";
    task.completedAt = new Date();
    await task.save();

    // Remove tracking keys from Redis
    try {
      const helperTrackingKey = `tracking:task:${taskId}:helper:${helperId}`;
      const helpseekerTrackingKey = `tracking:task:${taskId}:helpseeker:${task.helpseekerId}`;
      
      await redis.del(helperTrackingKey);
      await redis.del(helpseekerTrackingKey);
      
      console.log(`✅ Tracking keys removed from Redis for task ${taskId}`);
    } catch (redisError) {
      console.warn(`⚠️ Failed to remove tracking keys from Redis:`, redisError.message);
      // Continue execution even if Redis cleanup fails
    }

    // Automatically set helper back to available/online
    try {
   
    const helper = await Helper.findByPk(helperId, {
      include: [
        {
          model: Address,
          as: "addresses",
          attributes: ["id", "street", "city", "state", "latitude", "longitude", "isDefault"],
        },
      ],
    });

    if (!helper) {
      return res.status(404).json({
        success: false,
        message: "Helper not found",
      });
    }

    // Toggle availability
    helper.isAvailable = !helper.isAvailable;
    await helper.save();

    // If helper goes online, store in Redis
    if (helper.isAvailable) {
      const helperData = {
        id: helper.id,
        fullName: helper.fullName,
        email: helper.email,
        phone: helper.phone,
        profilePhoto: helper.profilePhoto,
        isAvailable: helper.isAvailable,
        averageRating: helper.averageRating,
        completedTasks: helper.completedTasks,
        addresses: helper.addresses,
        onlineAt: new Date().toISOString(),
      };

      // Upstash Redis automatically handles JSON serialization
      await redis.set(`helper:online:${helper.id}`, helperData);
      // Optional: Set expiration (e.g., 12 hours = 43200 seconds)
      await redis.expire(`helper:online:${helper.id}`, 43200);
      
      // Add to sorted set for counting available helpers
      // Using timestamp as score for ordering
      await redis.zadd('helpers:available', {
        score: Date.now(),
        member: helper.id,
      });
      
      console.log(`✅ Helper ${helper.id} marked as available in Redis`);
      
      // Broadcast helper online status
      const socketService = require("../../services/socketService");
      socketService.broadcastHelperStatusChange(helper.id, 'online', {
        helper: {
          id: helper.id,
          fullName: helper.fullName,
          profilePhoto: helper.profilePhoto,
          averageRating: helper.averageRating,
          completedTasks: helper.completedTasks,
        },
      });
    } else {
      // If helper goes offline, remove from Redis
      await redis.del(`helper:online:${helper.id}`);
      
      // Remove from available helpers sorted set
      await redis.zrem('helpers:available', helper.id);
      
      console.log(`✅ Helper ${helper.id} marked as offline in Redis`);
      
      // Broadcast helper offline status
      const socketService = require("../../services/socketService");
      socketService.broadcastHelperStatusChange(helper.id, 'offline', {
        helper: {
          id: helper.id,
        },
      });
    }

    res.status(200).json({
      success: true,
      message: `You are now ${helper.isAvailable ? "online" : "offline"}`,
      data: {
        isAvailable: helper.isAvailable,
        helper: helper,
      },
    });
  } catch (error) {
    console.error("Toggle availability error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to toggle availability",
      error: error.message,
    });
  }

    // Notify helpseeker
    await createNotification({
      userId: task.helpseekerId,
      userType: 'helpseeker',
      taskId: task.id,
      title: "Task Completed",
      message: `Helper has completed "${task.title}". Please review and make payment.`,
      type: "task_completed",
      priority: "high",
    });

    res.status(200).json({
      success: true,
      message: "Task completed successfully. You are now available for new tasks.",
      data: { 
        task: {
          id: task.id,
          title: task.title,
          status: task.status,
          completedAt: task.completedAt,
          workDuration: workDuration,
        },
        helperStatus: {
          isAvailable: true,
          message: "You have been automatically set to available",
        }
      },
    });
  } catch (error) {
    console.error("Complete work error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to complete work",
      error: error.message,
    });
  }
};

// Get task tracking history
const getTaskTracking = async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.user.id;

    const task = await Task.findByPk(taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    // Verify user is either task creator or assigned helper
    if (task.helpseekerId !== userId && task.assignedHelperId !== userId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to view tracking",
      });
    }

    // Return task status and helper info
    const helper = task.assignedHelperId ? await Helper.findByPk(task.assignedHelperId, {
      attributes: ["id", "fullName", "profilePhoto", "phone"],
    }) : null;

    res.status(200).json({
      success: true,
      data: {
        taskId: task.id,
        title: task.title,
        status: task.status,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        helper: helper,
      },
    });
  } catch (error) {
    console.error("Get tracking error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch tracking",
      error: error.message,
    });
  }
};

// Update current location (for real-time tracking)
const updateLocation = async (req, res) => {
  try {
    const helperId = req.user.id;
    const { taskId } = req.params;
    const { latitude, longitude } = req.body;

    // Validate coordinates
    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude are required",
      });
    }

    const task = await Task.findOne({
      where: { id: taskId, assignedHelperId: helperId },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found or not assigned to you",
      });
    }

    // Only allow location updates for active tracking statuses
    if (!['on_the_way', 'arrived'].includes(task.status)) {
      return res.status(400).json({
        success: false,
        message: "Location tracking not active for this task status",
      });
    }

    const timestamp = new Date();

    // Store location in Redis (fast, temporary storage for real-time tracking)
    const redisKey = `tracking:task:${taskId}:helper:${helperId}`;
    const locationData = {
      taskId: taskId,
      helperId: helperId,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      timestamp: timestamp.toISOString(),
    };

    // Store in Redis with 1 hour expiry (Upstash auto-serializes)
    await redis.setex(redisKey, 3600, locationData);
    console.log(`📍 [TRACKING] Stored location in Redis: ${redisKey}`);

    // Broadcast real-time location update to helpseeker via socket
    socketService.io.to(`task:${taskId}:tracking`).emit('helperLocationUpdate', locationData);
    console.log(`📍 [TRACKING] Broadcasted helper location for task ${taskId}`);

    res.status(200).json({
      success: true,
      message: "Location updated successfully",
      data: {
        taskId: taskId,
        currentLocation: {
          latitude: locationData.latitude,
          longitude: locationData.longitude,
          timestamp: locationData.timestamp,
        },
      },
    });
  } catch (error) {
    console.error("Update location error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update location",
      error: error.message,
    });
  }
};

// Get current helper location from Redis for a task
const getHelperLocation = async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.user.id;

    // Verify user has access to this task (either helper or helpseeker)
    const task = await Task.findOne({
      where: { 
        id: taskId,
        [Op.or]: [
          { assignedHelperId: userId },
          { helpseekerId: userId }
        ]
      },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found or access denied",
      });
    }

    // Get helper location from Redis
    const helperRedisKey = `tracking:task:${taskId}:helper:${task.assignedHelperId}`;
    const helperLocation = await redis.get(helperRedisKey);

    // Get helpseeker location from Redis
    const helpseekerRedisKey = `tracking:task:${taskId}:helpseeker:${task.helpseekerId}`;
    const helpseekerLocation = await redis.get(helpseekerRedisKey);

    console.log('📍 [GET LOCATION] Helper location from Redis:', helperLocation);
    console.log('📍 [GET LOCATION] Helpseeker location from Redis:', helpseekerLocation);

    // If no location data available at all
    if (!helperLocation && !helpseekerLocation) {
      return res.status(404).json({
        success: false,
        message: "No location data available",
        data: {
          helperLocation: null,
          helpseekerLocation: null,
        },
      });
    }

    res.status(200).json({
      success: true,
      message: "Location retrieved successfully",
      data: {
        helperLocation: helperLocation,
        helpseekerLocation: helpseekerLocation,
        taskId: taskId,
      },
    });
  } catch (error) {
    console.error("Get location error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get location",
      error: error.message,
    });
  }
};

module.exports = {
  updateOnTheWay,
  markArrived,
  completeWork,
  getTaskTracking,
  updateLocation,
  getHelperLocation,
};
