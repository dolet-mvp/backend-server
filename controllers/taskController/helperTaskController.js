const Task = require("../../models/taskModel/taskModel");
const TaskQueue = require("../../models/queueModel/queueModel");
const Notification = require("../../models/notificationModel/notificationModel");
const Helper = require("../../models/authModel/helperModel");
const Helpseeker = require("../../models/authModel/helpseekerModel");
const Address = require("../../models/addressModel/addressModel");
const redis = require("../../config/redis/redis");
const axios = require("axios");

// Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Store helper rejection/pass in Redis
const storeHelperAction = async (taskId, helperId, action, reason = null) => {
  const key = `task:${taskId}:actions`;
  const actionData = {
    helperId,
    action, // 'rejected' or 'passed'
    reason,
    timestamp: new Date().toISOString(),
  };
  
  // Add to list of actions for this task
  const existingActions = await redis.get(key);
  const actions = existingActions ? JSON.parse(existingActions) : [];
  actions.push(actionData);
  
  await redis.set(key, JSON.stringify(actions));
  await redis.expire(key, 86400); // 24 hours
  
  return actions;
};

// Check if helper has already rejected or passed a task
const hasHelperActedOnTask = async (taskId, helperId) => {
  const key = `task:${taskId}:actions`;
  const actionsData = await redis.get(key);
  
  if (!actionsData) return false;
  
  const actions = JSON.parse(actionsData);
  return actions.some(action => action.helperId === helperId);
};

// Get all helpers who have acted on a task
const getTaskActions = async (taskId) => {
  const key = `task:${taskId}:actions`;
  const actionsData = await redis.get(key);
  
  return actionsData ? JSON.parse(actionsData) : [];
};

// Calculate distance using Google Distance Matrix API
const calculateDistanceWithGoogle = async (origin, destination) => {
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    
    if (!apiKey) {
      console.warn("Google Maps API key not found, falling back to Haversine formula");
      return null;
    }

    const url = `https://maps.googleapis.com/maps/api/distancematrix/json`;
    const response = await axios.get(url, {
      params: {
        origins: `${origin.lat},${origin.lng}`,
        destinations: `${destination.lat},${destination.lng}`,
        key: apiKey,
        units: 'metric',
      },
    });

    if (response.data.status === 'OK' && 
        response.data.rows[0]?.elements[0]?.status === 'OK') {
      const distanceInMeters = response.data.rows[0].elements[0].distance.value;
      const distanceInKm = distanceInMeters / 1000;
      const durationInSeconds = response.data.rows[0].elements[0].duration.value;
      
      return {
        distance: distanceInKm,
        duration: durationInSeconds,
        distanceText: response.data.rows[0].elements[0].distance.text,
        durationText: response.data.rows[0].elements[0].duration.text,
      };
    }
    
    return null;
  } catch (error) {
    console.error("Google Distance Matrix API error:", error.message);
    return null;
  }
};

// Haversine formula to calculate distance between two points (fallback)
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Radius of Earth in kilometers
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c; // Distance in kilometers
  return distance;
};

// Get available tasks in queue (Helper)
const getAvailableTasks = async (req, res) => {
  try {
    const helperId = req.user?.id; 
    console.log("Helper ID:", helperId);
   
    
    const radius = process.env.TASK_SEARCH_RADIUS || 50;

    // Check if helper is available/online from Redis first
    if (helperId) {
      const cachedHelper = await redis.get(`helper:online:${helperId}`);
      
      if (!cachedHelper) {
        // If not in Redis, check database
        const helper = await Helper.findByPk(helperId);

        if (!helper || !helper.isAvailable || helper.verificationStatus !== 'approved') {
          return res.status(200).json({
            success: true,
            message: "You are currently offline or not approved. Please go online to see available tasks.",
            data: [],
            meta: {
              isHelperAvailable: helper?.isAvailable || false,
              helperStatus: helper?.verificationStatus || "unknown",
            },
          });
        }
      }
    }

    let helperLat, helperLng;
    let helperAddress = null;

    // Check Redis for helper data first
    if (helperId) {
      const cachedHelper = await redis.get(`helper:online:${helperId}`);
      
      if (cachedHelper) {
        const helperData = JSON.parse(cachedHelper);
        
        // Get address from cached helper data
        if (helperData.addresses && helperData.addresses.length > 0) {
          // Find default address or use first address
          helperAddress = helperData.addresses.find(addr => addr.isDefault) || helperData.addresses[0];
          
          if (helperAddress && helperAddress.latitude && helperAddress.longitude) {
            helperLat = parseFloat(helperAddress.latitude);
            helperLng = parseFloat(helperAddress.longitude);
          }
        }
      }
      
      // If not found in Redis, fetch from database
      if (!helperAddress) {
        helperAddress = await Address.findOne({
          where: { helperId: helperId, userType: 'helper' },
          attributes: ['id', 'street', 'city', 'state', 'zipCode', 'country', 'latitude', 'longitude', 'isDefault'],
          order: [['createdAt', 'DESC']], // Get most recent address
        });

        // If address found with coordinates, use them
        if (helperAddress && helperAddress.latitude && helperAddress.longitude) {
          helperLat = parseFloat(helperAddress.latitude);
          helperLng = parseFloat(helperAddress.longitude);
        } else {
          return res.status(400).json({
            success: false,
            message: "Please add your address with location coordinates in your profile to see available tasks",
          });
        }
      }
    } else {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const searchRadius = parseFloat(radius);

    // Validate coordinates
    if (
      isNaN(helperLat) ||
      isNaN(helperLng) ||
      helperLat < -90 ||
      helperLat > 90 ||
      helperLng < -180 ||
      helperLng > 180
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid location coordinates",
      });
    }

    const whereClause = { status: "in_queue" };
    
    // First, try to get tasks from Redis
    const redisKeys = await redis.keys('task:*');
    let tasksFromRedis = [];
    
    if (redisKeys && redisKeys.length > 0) {
      const redisPromises = redisKeys.map(key => redis.get(key));
      const redisResults = await Promise.all(redisPromises);
      tasksFromRedis = redisResults
        .filter(result => result)
        .map(result => JSON.parse(result))
        .filter(task => task.status === 'in_queue');
    }

    // Get all tasks in queue from database as fallback
    const tasks = await Task.findAll({
      where: whereClause,
      include: [
        {
          model: TaskQueue,
          as: "queueStatus",
        },
        {
          model: Helpseeker,
          as: "creator",
          attributes: ["id", "fullName", "profilePhoto","phone"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    // Use Redis tasks if available, otherwise use database tasks
    const tasksToProcess = tasksFromRedis.length > 0 ? tasksFromRedis : tasks;

    // Filter out tasks this helper has already rejected or passed
    const availableTasksForHelper = [];
    for (const task of tasksToProcess) {
      const taskId = task.id;
      const hasActed = await hasHelperActedOnTask(taskId, helperId);
      if (!hasActed) {
        availableTasksForHelper.push(task);
      }
    }

    // Filter tasks by location radius with Google Distance Matrix API
    const nearbyTasksPromises = availableTasksForHelper.map(async (task) => {
      // If task doesn't require location or has no location, include it
      if (!task.locationRequired || !task.location) {
        return { task, distance: 0, duration: null, distanceText: 'N/A', durationText: 'N/A' };
      }

      // If task has location, check if it's within radius
      if (task.location.lat && task.location.lng) {
        // Try Google Distance Matrix API first
        const googleDistance = await calculateDistanceWithGoogle(
          { lat: helperLat, lng: helperLng },
          { lat: parseFloat(task.location.lat), lng: parseFloat(task.location.lng) }
        );

        if (googleDistance) {
          if (googleDistance.distance <= searchRadius) {
            return {
              task,
              distance: parseFloat(googleDistance.distance.toFixed(2)),
              duration: googleDistance.duration,
              distanceText: googleDistance.distanceText,
              durationText: googleDistance.durationText,
              source: 'google_maps',
            };
          }
        } else {
          // Fallback to Haversine formula
          const distance = calculateDistance(
            helperLat,
            helperLng,
            parseFloat(task.location.lat),
            parseFloat(task.location.lng)
          );

          if (distance <= searchRadius) {
            return {
              task,
              distance: parseFloat(distance.toFixed(2)),
              duration: null,
              distanceText: `${distance.toFixed(2)} km`,
              durationText: 'N/A',
              source: 'haversine',
            };
          }
        }
      }

      return null;
    });

    const nearbyTasksResults = await Promise.all(nearbyTasksPromises);
    const nearbyTasks = nearbyTasksResults
      .filter(result => result !== null)
      .sort((a, b) => a.distance - b.distance)
      .map(result => {
        const taskData = result.task.dataValues || result.task;
        return {
          ...taskData,
          distance: result.distance,
          duration: result.duration,
          distanceText: result.distanceText,
          durationText: result.durationText,
          distanceSource: result.source,
        };
      });

    // Get rejection counts for each task
    const tasksWithRejectionInfo = await Promise.all(
      nearbyTasks.map(async (task) => {
        const actions = await getTaskActions(task.id);
        const rejectionCount = actions.filter(a => a.action === 'rejected').length;
        const passedCount = actions.filter(a => a.action === 'passed').length;
        
        return {
          ...task,
          rejectionCount,
          passedCount,
          totalHelperActions: actions.length,
        };
      })
    );

    res.status(200).json({
      success: true,
      message: `Found ${nearbyTasks.length} tasks within ${searchRadius}km`,
      data: tasksWithRejectionInfo,
      meta: {
        isHelperAvailable: true,
        helperStatus: "online",
        helperLocation: { 
          lat: helperLat, 
          lng: helperLng,
          address: helperAddress ? {
            street: helperAddress.street,
            city: helperAddress.city,
            state: helperAddress.state,
            zipCode: helperAddress.zipCode,
            country: helperAddress.country,
            isDefault: helperAddress.isDefault,
          } : null,
          source: 'redis_or_address_model'
        },
        searchRadius: searchRadius,
        totalTasks: tasks.length,
        nearbyTasks: nearbyTasks.length,
        redisTasksCount: tasksFromRedis.length,
        filteredByHelperActions: tasksToProcess.length - availableTasksForHelper.length,
      },
    });
  } catch (error) {
    console.error("Get available tasks error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch available tasks",
      error: error.message,
    });
  }
};

// Accept task directly (Helper) - Generates OTP and assigns task
const acceptTask = async (req, res) => {
  try {
    const helperId = req.user.id;
    const { taskId } = req.params;

    const task = await Task.findByPk(taskId, {
      include: [
        {
          model: Helpseeker,
          as: "creator",
          attributes: ["id", "fullName", "email", "phone"],
        },
      ],
    });
 
    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (task.status !== "in_queue") {
      return res.status(400).json({
        success: false,
        message: "Task is not available for acceptance",
      });
    }

    // Check if task is already assigned
    if (task.assignedHelperId) {
      return res.status(400).json({
        success: false,
        message: "This task has already been accepted by another helper",
      });
    }

    // Get helper details
    const helper = await Helper.findByPk(helperId, {
      attributes: ["id", "fullName", "email", "phone", "profilePhoto"],
    });

    // Generate OTP
    const otp = generateOTP();

    // Update task - assign to helper and generate OTP
    task.assignedHelperId = helperId;
    task.status = "assigned";
    task.acceptedAt = new Date();
    task.verificationOtp = otp;
    task.otpGeneratedAt = new Date();
    task.isOtpVerified = false;
    await task.save();

    // Remove from queue if exists
    await TaskQueue.destroy({
      where: { taskId: task.id },
    });

    // Remove task from Redis cache when accepted by helper
    await redis.del(`task:${task.id}`);

    // Notify helpseeker with OTP and helper details
    await Notification.create({
      helpseekerId: task.helpseekerId,
      userType: 'helpseeker',
      taskId: task.id,
      title: "Task Accepted by Helper",
      message: `${helper.fullName} has accepted your task "${task.title}". OTP: ${otp}. Share this OTP with the helper to start the task.`,
      type: "task_assigned",
      priority: "high",
    });

    // Notify helper
    await Notification.create({
      helperId: helperId,
      userType: 'helper',
      taskId: task.id,
      title: "Task Accepted Successfully",
      message: `You have accepted "${task.title}". The helpseeker will share the OTP with you to start the task. Contact: ${task.creator.fullName} (${task.creator.phone || task.creator.email})`,
      type: "task_assigned",
      priority: "high",
    });

    res.status(200).json({
      success: true,
      message: "Task accepted successfully. OTP has been sent to the helpseeker.",
      data: {
        taskId: task.id,
        taskTitle: task.title,
        status: "assigned",
        acceptedAt: task.acceptedAt,
        helpseeker: {
          id: task.creator.id,
          name: task.creator.fullName,
          email: task.creator.email,
          phone: task.creator.phone,
        },
        message: "Wait for helpseeker to share the OTP with you to start the task",
      },
    });
  } catch (error) {
    console.error("Accept task error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to accept task",
      error: error.message,
    });
  }
};

// Reject task with reason (Helper)
const rejectTask = async (req, res) => {
  try {
    const helperId = req.user.id;
    const { taskId } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide a reason for rejecting this task",
      });
    }

    const task = await Task.findByPk(taskId, {
      include: [
        {
          model: Helpseeker,
          as: "creator",
          attributes: ["id", "fullName"],
        },
      ],
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (task.status !== "in_queue") {
      return res.status(400).json({
        success: false,
        message: "This task is no longer available",
      });
    }

    // Get helper details
    const helper = await Helper.findByPk(helperId, {
      attributes: ["id", "fullName"],
    });

    // Store rejection in Redis
    const actions = await storeHelperAction(taskId, helperId, 'rejected', reason);
    
    // Get all online helpers to check if all have rejected
    const onlineHelperKeys = await redis.keys('helper:online:*');
    const onlineHelperCount = onlineHelperKeys.length;
    const rejectionCount = actions.filter(a => a.action === 'rejected').length;
    const passedCount = actions.filter(a => a.action === 'passed').length;
    const totalActions = rejectionCount + passedCount;
    
    // Check if all available helpers have acted on this task
    const allHelpersActed = totalActions >= onlineHelperCount;
   
    // Notify helpseeker about rejection
    await Notification.create({
      helpseekerId: task.helpseekerId,
      userType: 'helpseeker',
      taskId: task.id,
      title: "Task Declined",
      message: `${helper.fullName} has declined your task "${task.title}". Reason: ${reason}${allHelpersActed ? ' (All available helpers have been shown this task)' : ''}`,
      type: "bid_rejected",
      priority: allHelpersActed ? "high" : "medium",
    });

    res.status(200).json({
      success: true,
      message: "Task rejected successfully",
      data: {
        taskId: task.id,
        reason: reason,
        rejectionCount,
        totalActions,
        allHelpersActed,
        message: allHelpersActed ? "All available helpers have been shown this task. Consider increasing the reward or canceling." : "Task will be shown to other nearby helpers.",
      },
    });
  } catch (error) {
    console.error("Reject task error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reject task",
      error: error.message,
    });
  }
};

// Verify OTP and start task (Helper) - Step 3: Helper verifies OTP to start work
const verifyOTPAndStartTask = async (req, res) => {
  try {
    const helperId = req.user.id;
    const { taskId } = req.params;
    const { otp } = req.body;

    if (!otp) {
      return res.status(400).json({
        success: false,
        message: "OTP is required",
      });
    }

    const task = await Task.findByPk(taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    // Verify helper is assigned to this task
    if (task.assignedHelperId !== helperId) {
      return res.status(403).json({
        success: false,
        message: "You are not assigned to this task",
      });
    }

    // Check if task is in correct status
    if (task.status !== "arrived") {
      return res.status(400).json({
        success: false,
        message: "Task is not in arrived status",
      });
    }

    // Check if OTP is already verified
    if (task.isOtpVerified) {
      return res.status(400).json({
        success: false,
        message: "OTP already verified. Task is in progress.",
      });
    }

    // Verify OTP
    if (task.verificationOtp !== otp.trim()) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP. Please check and try again.",
      });
    }

    // Check OTP expiry (24 hours)
    const otpAge = new Date() - new Date(task.otpGeneratedAt);
    const hoursElapsed = otpAge / (1000 * 60 * 60);
    
    if (hoursElapsed > 24) {
      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please contact the helpseeker for a new OTP.",
      });
    }

    // Update task status to in_progress
    task.status = "in_progress";
    task.isOtpVerified = true;
    task.otpVerifiedAt = new Date();
    task.startedAt = new Date();
    await task.save();

    // Notify helpseeker
    await Notification.create({
      helpseekerId: task.helpseekerId,
      userType: 'helpseeker',
      taskId: task.id,
      title: "Work Started",
      message: `Helper has verified OTP and started working on "${task.title}"`,
      type: "task_started",
      priority: "medium",
    });

    // Notify helper
    await Notification.create({
      helperId: helperId,
      userType: 'helper',
      taskId: task.id,
      title: "Work Started",
      message: `You have successfully verified OTP and started working on "${task.title}"`,
      type: "task_started",
      priority: "medium",
    });

    res.status(200).json({
      success: true,
      message: "OTP verified successfully. Task is now in progress.",
      data: {
        taskId: task.id,
        status: task.status,
        startedAt: task.startedAt,
        otpVerifiedAt: task.otpVerifiedAt,
      },
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify OTP",
      error: error.message,
    });
  }
};

// Get all accepted tasks for helper
const getMyAcceptedTasks = async (req, res) => {
  try {
    const helperId = req.user.id;

    const tasks = await Task.findAll({
      where: {
        assignedHelperId: helperId,
      },
      include: [
        {
          model: Helpseeker,
          as: "creator",
          attributes: ["id", "fullName", "profilePhoto", "phone", "email"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json({
      success: true,
      message: "Accepted tasks retrieved successfully",
      data: tasks,
      meta: {
        total: tasks.length,
      },
    });
  } catch (error) {
    console.error("Get accepted tasks error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get accepted tasks",
      error: error.message,
    });
  }
};

// Get single task details for helper
const getMyTaskDetails = async (req, res) => {
  try {
    const helperId = req.user.id;
    const { taskId } = req.params;

    const task = await Task.findOne({
      where: {
        id: taskId,
        assignedHelperId: helperId,
      },
      include: [
        {
          model: Helpseeker,
          as: "creator",
          attributes: ["id", "fullName", "profilePhoto", "phone", "email"],
          include: [
            {
              model: Address,
              as: "addresses",
              attributes: ["id", "addressLine1", "addressLine2", "city", "state", "latitude", "longitude"],
            },
          ],
        },
      ],
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found or not assigned to you",
      });
    }

    res.status(200).json({
      success: true,
      message: "Task details retrieved successfully",
      data: task,
    });
  } catch (error) {
    console.error("Get task details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get task details",
      error: error.message,
    });
  }
};

// Pass on a task (Helper decides not to take it without explicit rejection)
const passTask = async (req, res) => {
  try {
    const helperId = req.user.id;
    const { taskId } = req.params;

    const task = await Task.findByPk(taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (task.status !== "in_queue") {
      return res.status(400).json({
        success: false,
        message: "This task is no longer available",
      });
    }

    // Store pass action in Redis
    await storeHelperAction(taskId, helperId, 'passed', 'Helper passed on this task');
    
    res.status(200).json({
      success: true,
      message: "Task marked as passed. It will be shown to other helpers.",
      data: {
        taskId: task.id,
      },
    });
  } catch (error) {
    console.error("Pass task error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to pass task",
      error: error.message,
    });
  }
};

module.exports = {
  getAvailableTasks,
  acceptTask,
  rejectTask,
  passTask,
  verifyOTPAndStartTask,
  getMyAcceptedTasks,
  getMyTaskDetails,
};
