const Task = require("../../models/taskModel/taskModel");
const TaskQueue = require("../../models/queueModel/queueModel");
const Notification = require("../../models/notificationModel/notificationModel");
const Helper = require("../../models/authModel/helperModel");
const Helpseeker = require("../../models/authModel/helpseekerModel");
const Address = require("../../models/addressModel/addressModel");
const redis = require("../../config/redis/redis");
const axios = require("axios");
const { findAndAssociateNearestHelper } = require("../helperController/helperController");
const { getGoogleMapsDistances } = require("./helpseekerTaskController");

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

    // Check if helper is available/online from Redis - NO DATABASE FALLBACK
    if (helperId) {
      const cachedHelper = await redis.get(`helper:online:${helperId}`);
      
      if (!cachedHelper) {
        // If not in Redis, reject the request - helper must be online
        return res.status(403).json({
          success: false,
          message: "You must be online to view available tasks. Please toggle your availability status to 'online' first.",
          data: [],
          meta: {
            isHelperAvailable: false,
            helperStatus: "offline",
            requiresAction: "Go online using the availability toggle",
          },
        });
      }
    }

    let helperLat, helperLng;
    let helperAddress = null;

    // Get helper data from Redis only - NO DATABASE FALLBACK
    if (helperId) {
      const cachedHelper = await redis.get(`helper:online:${helperId}`);
      
      if (!cachedHelper) {
        return res.status(403).json({
          success: false,
          message: "You must be online to view available tasks.",
        });
      }

      // Handle both string and object responses from Upstash Redis
      const helperData = typeof cachedHelper === 'string' ? JSON.parse(cachedHelper) : cachedHelper;
      
      // Get address from cached helper data
      if (helperData.addresses && helperData.addresses.length > 0) {
        // Find default address or use first address
        helperAddress = helperData.addresses.find(addr => addr.isDefault) || helperData.addresses[0];
        
        if (helperAddress && helperAddress.latitude && helperAddress.longitude) {
          helperLat = parseFloat(helperAddress.latitude);
          helperLng = parseFloat(helperAddress.longitude);
        } else {
          return res.status(400).json({
            success: false,
            message: "Please add your address with location coordinates in your profile to see available tasks.",
          });
        }
      } else {
        return res.status(400).json({
          success: false,
          message: "Please add your address with location coordinates in your profile to see available tasks.",
        });
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

    // Get tasks from Redis ONLY - NO DATABASE FALLBACK
    console.log("📡 Fetching tasks from Redis only...");
    const redisKeys = await redis.keys('job:*');
    let tasksFromRedis = [];
    
    if (!redisKeys || redisKeys.length === 0) {
      console.log("ℹ️  No tasks found in Redis");
      return res.status(200).json({
        success: true,
        message: "No tasks available at the moment",
        data: [],
        meta: {
          isHelperAvailable: true,
          helperStatus: "online",
          helperLocation: { 
            lat: helperLat, 
            lng: helperLng,
          },
          searchRadius: searchRadius,
          totalTasks: 0,
          nearbyTasks: 0,
          source: "redis_only",
        },
      });
    }
    
    const redisPromises = redisKeys.map(key => redis.get(key));
    const redisResults = await Promise.all(redisPromises);
    tasksFromRedis = redisResults
      .filter(result => result)
      .map(result => {
        // Handle both string and object responses from Upstash Redis
        if (typeof result === 'string') {
          return JSON.parse(result);
        }
        return result;
      })
      .filter(task => task.status === 'in_queue');

    console.log(`✅ Found ${tasksFromRedis.length} tasks in Redis with status 'in_queue'`);

    // Validate tasks against database and clean up stale ones
    const validTasks = [];
    for (const redisTask of tasksFromRedis) {
      const taskId = redisTask.taskId || redisTask.id;
      
      // Check database status
      const dbTask = await Task.findByPk(taskId, {
        attributes: ['id', 'status', 'assignedHelperId'],
      });
      
      // If task doesn't exist in DB or has invalid status, remove from Redis
      if (!dbTask || !['in_queue', 'published'].includes(dbTask.status) || dbTask.assignedHelperId) {
        console.log(`🧹 Cleaning up stale task ${taskId} from Redis (DB status: ${dbTask?.status || 'not found'})`);
        await redis.del(`job:${taskId}`);
        await redis.zrem('jobs:published', `job:${taskId}`);
        continue;
      }
      
      validTasks.push(redisTask);
    }
    
    console.log(`✅ ${validTasks.length} valid tasks after database validation`);

    // Filter tasks to only show those associated with this helper
    const helperTasksKey = `helper:${helperId}:associated_tasks`;
    const associatedTasksData = await redis.get(helperTasksKey);
    
    // Handle both string and object responses from Upstash Redis
    let associatedTaskIds = [];
    if (associatedTasksData) {
      if (typeof associatedTasksData === 'string') {
        try {
          associatedTaskIds = JSON.parse(associatedTasksData);
        } catch (parseError) {
          console.error(`❌ Failed to parse associated tasks data:`, parseError.message);
          console.error(`   Raw data:`, associatedTasksData);
          associatedTaskIds = [];
        }
      } else {
        associatedTaskIds = associatedTasksData;
      }
    }
    
    console.log(`📋 Helper ${helperId} has ${associatedTaskIds.length} associated tasks`);
    
    const tasksToProcess = validTasks.filter(task => {
      const taskId = task.taskId || task.id;
      return associatedTaskIds.includes(taskId);
    });
    
    console.log(`✅ ${tasksToProcess.length} tasks match helper's associations`);

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
      if (!task.locationRequired || (!task.location && (!task.steps || !task.steps[0]?.location))) {
        return { task, distance: 0, duration: null, distanceText: 'N/A', durationText: 'N/A' };
      }

      // Get task location from either task.location or steps[0].location
      const taskLocation = task.location || (task.steps && task.steps[0] ? task.steps[0].location : null);
      
      // If task has location, check if it's within radius
      if (taskLocation && taskLocation.lat && taskLocation.lng) {
        // Try Google Distance Matrix API using batch function
        const googleDistances = await getGoogleMapsDistances(
          { lat: helperLat, lng: helperLng },
          [{ lat: parseFloat(taskLocation.lat), lng: parseFloat(taskLocation.lng) }]
        );

        if (googleDistances && googleDistances[0] && googleDistances[0].status === 'OK') {
          const distance = googleDistances[0].distance;
          const duration = googleDistances[0].duration;
          
          if (distance <= searchRadius) {
            const distanceText = distance < 1 ? `${Math.round(distance * 1000)} m` : `${distance.toFixed(1)} km`;
            const durationText = duration < 60 ? `${Math.round(duration)} mins` : `${Math.floor(duration / 60)} hr ${Math.round(duration % 60)} mins`;
            
            return {
              task,
              distance: parseFloat(distance.toFixed(2)),
              duration: duration * 60, // Convert to seconds
              distanceText: distanceText,
              durationText: durationText,
              source: 'google_maps',
            };
          }
        } else {
          // Fallback to Haversine formula
          const distance = calculateDistance(
            helperLat,
            helperLng,
            parseFloat(taskLocation.lat),
            parseFloat(taskLocation.lng)
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
          source: 'redis_only'
        },
        searchRadius: searchRadius,
        totalTasksInRedis: tasksFromRedis.length,
        nearbyTasks: nearbyTasks.length,
        filteredByHelperActions: tasksToProcess.length - availableTasksForHelper.length,
        dataSource: "redis_only",
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

    // Check if task exists in Redis first (source of truth for available tasks)
    const redisTaskKey = `job:${taskId}`;
    const cachedTask = await redis.get(redisTaskKey);
    
    if (!cachedTask) {
      return res.status(404).json({
        success: false,
        message: "Task not found or no longer available",
        hint: "This task may have been cancelled, completed, or removed from the queue",
      });
    }

    // Get task from database for full details
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
      // Task exists in Redis but not in database - clean up Redis
      await redis.del(redisTaskKey);
      await redis.zrem('jobs:published', redisTaskKey);
      
      return res.status(404).json({
        success: false,
        message: "Task not found in database",
      });
    }

    // Accept tasks with status "published" or "in_queue"
    if (task.status !== "in_queue" && task.status !== "published") {
      // Task status changed - remove from Redis cache
      await redis.del(redisTaskKey);
      await redis.zrem('jobs:published', redisTaskKey);
      
      return res.status(400).json({
        success: false,
        message: "Task is not available for acceptance",
        currentStatus: task.status,
        allowedStatuses: ["in_queue", "published"],
        hint: "Task status has changed and has been removed from available tasks",
      });
    }

    // Check if task is already assigned
    if (task.assignedHelperId) {
      // Task already assigned - remove from Redis cache
      await redis.del(redisTaskKey);
      await redis.zrem('jobs:published', redisTaskKey);
      
      return res.status(400).json({
        success: false,
        message: "This task has already been accepted by another helper",
      });
    }

    // Get helper details with addresses
    const helper = await Helper.findByPk(helperId, {
      attributes: ["id", "fullName", "email", "phone", "profilePhoto"],
      include: [
        {
          model: Address,
          as: "addresses",
          attributes: ["id", "latitude", "longitude", "city", "state", "isDefault"],
        },
      ],
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

    // Remove task from Redis cache when accepted by helper - use correct key
    try {
      const redisTaskKey = `job:${task.id}`;
      await redis.del(redisTaskKey);
      await redis.zrem('jobs:published', redisTaskKey);
      console.log(`✅ Task ${task.id} removed from Redis after acceptance`);
    } catch (redisError) {
      console.warn(`⚠️ Failed to remove task from Redis:`, redisError.message);
      // Continue execution even if Redis update fails
    }

    // Remove helper from available helpers list in Redis since they accepted a task
    try {
      await redis.del(`helper:online:${helperId}`);
      await redis.zrem('helpers:available', helperId);
      console.log(`✅ Helper ${helperId} removed from available helpers in Redis after accepting task`);
    } catch (redisError) {
      console.warn(`⚠️ Failed to remove helper from Redis availability:`, redisError.message);
      // Continue execution even if Redis update fails
    }

    // Update helper availability status in database
    await Helper.update(
      { isAvailable: false },
      { where: { id: helperId } }
    );

    // Store helper and helpseeker locations in Redis for real-time tracking
    try {
      console.log('📍 [ACCEPT TASK] Starting location storage in Redis...');
      
      // Get helper's default address from the included addresses
      const helperAddress = helper.addresses?.find(addr => addr.isDefault === true) || helper.addresses?.[0];
      
      console.log('📍 [ACCEPT TASK] Helper has addresses:', helper.addresses?.length || 0);
      console.log('📍 [ACCEPT TASK] Helper address found:', helperAddress ? 'YES' : 'NO');
      if (helperAddress) {
        console.log('📍 [ACCEPT TASK] Helper coordinates:', {
          lat: helperAddress.latitude,
          lng: helperAddress.longitude
        });
      }

      // Get helpseeker location from task or their default address
      let helpseekerLat = null;
      let helpseekerLng = null;

      console.log('📍 [ACCEPT TASK] Task location:', task.location);
      console.log('📍 [ACCEPT TASK] Task steps:', task.steps);

      if (task.location && task.location.lat && task.location.lng) {
        // Use task location (where service is needed)
        helpseekerLat = task.location.lat;
        helpseekerLng = task.location.lng;
        console.log('📍 [ACCEPT TASK] Using task.location:', { helpseekerLat, helpseekerLng });
      } else if (task.steps && task.steps.length > 0 && task.steps[0].location) {
        // Use first step location
        helpseekerLat = task.steps[0].location.lat;
        helpseekerLng = task.steps[0].location.lng;
        console.log('📍 [ACCEPT TASK] Using task.steps[0].location:', { helpseekerLat, helpseekerLng });
      } else {
        // Fallback to helpseeker's default address
        const helpseekerAddress = await Address.findOne({
          where: { 
            helpseekerId: task.helpseekerId,
            isDefault: true 
          }
        });
        if (helpseekerAddress && helpseekerAddress.latitude && helpseekerAddress.longitude) {
          helpseekerLat = parseFloat(helpseekerAddress.latitude);
          helpseekerLng = parseFloat(helpseekerAddress.longitude);
          console.log('📍 [ACCEPT TASK] Using helpseeker default address:', { helpseekerLat, helpseekerLng });
        } else {
          console.warn('⚠️ [ACCEPT TASK] No helpseeker address found');
        }
      }

      console.log('📍 [ACCEPT TASK] Final coordinates - Helper:', helperAddress ? 'FOUND' : 'NOT FOUND', 'Seeker:', { helpseekerLat, helpseekerLng });

      // Store helper location in Redis (will be updated in real-time)
      if (helperAddress && helperAddress.latitude && helperAddress.longitude) {
        const helperLocationData = {
          taskId: task.id,
          helperId: helperId,
          latitude: parseFloat(helperAddress.latitude),
          longitude: parseFloat(helperAddress.longitude),
          timestamp: new Date().toISOString(),
        };
        
        const helperRedisKey = `tracking:task:${task.id}:helper:${helperId}`;
        await redis.setex(helperRedisKey, 3600, JSON.stringify(helperLocationData)); // 1 hour TTL
        console.log(`✅ [TRACKING] Helper location stored in Redis:`, helperRedisKey);
        console.log(`✅ [TRACKING] Helper data:`, helperLocationData);
      } else {
        console.warn('⚠️ [TRACKING] Helper location NOT stored (no address found)');
      }

      // Store helpseeker location in Redis (static - service location)
      if (helpseekerLat && helpseekerLng) {
        const helpseekerLocationData = {
          taskId: task.id,
          helpseekerId: task.helpseekerId,
          latitude: helpseekerLat,
          longitude: helpseekerLng,
          timestamp: new Date().toISOString(),
        };
        
        const helpseekerRedisKey = `tracking:task:${task.id}:helpseeker:${task.helpseekerId}`;
        await redis.setex(helpseekerRedisKey, 3600, JSON.stringify(helpseekerLocationData)); // 1 hour TTL
        console.log(`✅ [TRACKING] Helpseeker location stored in Redis:`, helpseekerRedisKey);
        console.log(`✅ [TRACKING] Helpseeker data:`, helpseekerLocationData);
      } else {
        console.warn('⚠️ [TRACKING] Helpseeker location NOT stored (no coordinates found)');
      }
    } catch (locationError) {
      console.error("❌ [TRACKING] Failed to store locations in Redis:", locationError);
      console.error("❌ [TRACKING] Error stack:", locationError.stack);
      // Continue execution even if location storage fails
    }

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

    // Reason is optional - can be submitted later
    const rejectionReason = reason && reason.trim().length > 0 ? reason.trim() : 'No reason provided';

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

    if (task.status !== "in_queue" && task.status !== "published") {
      return res.status(400).json({
        success: false,
        message: "This task is no longer available",
      });
    }

    // Get helper details
    const helper = await Helper.findByPk(helperId, {
      attributes: ["id", "fullName"],
    });

    // Store rejection in Redis immediately (even without reason)
    const actions = await storeHelperAction(taskId, helperId, 'rejected', rejectionReason);
    
    // Remove this helper from task associations
    try {
      const helperTasksKey = `helper:${helperId}:associated_tasks`;
      const associatedTasksData = await redis.get(helperTasksKey);
      
      if (associatedTasksData) {
        const tasksList = JSON.parse(associatedTasksData);
        const updatedList = tasksList.filter(id => id !== taskId);
        
        if (updatedList.length > 0) {
          await redis.setex(helperTasksKey, 43200, JSON.stringify(updatedList));
        } else {
          await redis.del(helperTasksKey);
        }
      }
      
      const taskHelpersKey = `task:${taskId}:associated_helpers`;
      const taskHelpersData = await redis.get(taskHelpersKey);
      
      if (taskHelpersData) {
        const helpersList = JSON.parse(taskHelpersData);
        const updatedHelpers = helpersList.filter(id => id !== helperId);
        
        if (updatedHelpers.length > 0) {
          await redis.setex(taskHelpersKey, 2592000, JSON.stringify(updatedHelpers));
        } else {
          await redis.del(taskHelpersKey);
        }
      }
      
      console.log(`✅ Helper ${helperId} removed from task ${taskId} associations after rejection`);
      
      // Find and associate the nearest available helper
      if (task.location || (task.steps && task.steps[0] && task.steps[0].location)) {
        const taskLocation = task.location || task.steps[0].location;
        
        // Use the utility function to find and associate nearest helper, excluding this helper
        const replacementHelperId = await findAndAssociateNearestHelper(taskId, taskLocation, helperId);
        
        if (replacementHelperId) {
          // Update task association with new helper
          await redis.setex(`task:${taskId}:associated_helpers`, 2592000, JSON.stringify([replacementHelperId]));
          
          // Add task to new helper's list
          const newHelperTasksKey = `helper:${replacementHelperId}:associated_tasks`;
          const newHelperTasksData = await redis.get(newHelperTasksKey);
          let newHelperTasks = [];
          
          if (newHelperTasksData) {
            newHelperTasks = typeof newHelperTasksData === 'string' ? JSON.parse(newHelperTasksData) : newHelperTasksData;
          }
          
          if (!newHelperTasks.includes(taskId)) {
            newHelperTasks.push(taskId);
            await redis.setex(newHelperTasksKey, 43200, JSON.stringify(newHelperTasks));
          }
          
          console.log(`✅ Task ${taskId} reassigned to replacement helper ${replacementHelperId}`);
        } else {
          console.log(`⚠️ No replacement helper found for task ${taskId}`);
        }
      }
    } catch (reassignError) {
      console.warn(`⚠️ Failed to reassign task:`, reassignError.message);
    }
    
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
        reason: rejectionReason,
        rejectionCount,
        totalActions,
        allHelpersActed,
        message: allHelpersActed ? "All available helpers have been shown this task. Consider increasing the reward or canceling." : "Task rejected and reassigned to nearest available helper.",
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

// Update rejection reason later
const updateRejectionReason = async (req, res) => {
  try {
    const helperId = req.user.id;
    const { taskId } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide a reason for rejection",
      });
    }

    // Check if helper has rejected this task
    const actionsKey = `task:${taskId}:actions`;
    const actionsData = await redis.get(actionsKey);
    
    if (!actionsData) {
      return res.status(404).json({
        success: false,
        message: "No rejection record found for this task",
      });
    }

    const actions = JSON.parse(actionsData);
    const helperAction = actions.find(a => a.helperId === helperId && a.action === 'rejected');
    
    if (!helperAction) {
      return res.status(404).json({
        success: false,
        message: "You have not rejected this task",
      });
    }

    // Update the reason
    helperAction.reason = reason.trim();
    helperAction.reasonUpdatedAt = new Date().toISOString();
    
    await redis.set(actionsKey, JSON.stringify(actions));
    await redis.expire(actionsKey, 86400); // 24 hours

    // Get task details for notification
    const task = await Task.findByPk(taskId, {
      attributes: ['id', 'title', 'helpseekerId'],
    });

    if (task) {
      // Update notification to helpseeker with the reason
      const helper = await Helper.findByPk(helperId, {
        attributes: ["id", "fullName"],
      });

      await Notification.create({
        helpseekerId: task.helpseekerId,
        userType: 'helpseeker',
        taskId: task.id,
        title: "Task Rejection Reason Updated",
        message: `${helper.fullName} has provided a reason for declining "${task.title}": ${reason}`,
        type: "general",
        priority: "medium",
      });
    }

    res.status(200).json({
      success: true,
      message: "Rejection reason updated successfully",
      data: {
        taskId,
        reason: reason.trim(),
        updatedAt: helperAction.reasonUpdatedAt,
      },
    });
  } catch (error) {
    console.error("Update rejection reason error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update rejection reason",
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
    const actions = await storeHelperAction(taskId, helperId, 'passed', 'Helper passed on this task');
    
    // Remove this helper from task associations and reassign to another helper
    try {
      const helperTasksKey = `helper:${helperId}:associated_tasks`;
      const associatedTasksData = await redis.get(helperTasksKey);
      
      if (associatedTasksData) {
        const tasksList = typeof associatedTasksData === 'string' 
          ? JSON.parse(associatedTasksData) 
          : associatedTasksData;
        const updatedList = tasksList.filter(id => id !== taskId);
        
        if (updatedList.length > 0) {
          await redis.setex(helperTasksKey, 43200, JSON.stringify(updatedList));
        } else {
          await redis.del(helperTasksKey);
        }
      }
      
      const taskHelpersKey = `task:${taskId}:associated_helpers`;
      const taskHelpersData = await redis.get(taskHelpersKey);
      
      if (taskHelpersData) {
        const helpersList = typeof taskHelpersData === 'string' 
          ? JSON.parse(taskHelpersData) 
          : taskHelpersData;
        const updatedHelpers = helpersList.filter(id => id !== helperId);
        
        if (updatedHelpers.length > 0) {
          await redis.setex(taskHelpersKey, 2592000, JSON.stringify(updatedHelpers));
        } else {
          await redis.del(taskHelpersKey);
        }
      }
      
      console.log(`✅ Helper ${helperId} removed from task ${taskId} associations after passing`);
      
      // Find and associate the nearest available helper
      if (task.location || (task.steps && task.steps[0] && task.steps[0].location)) {
        const taskLocation = task.location || task.steps[0].location;
        
        // Use the utility function to find and associate nearest helper, excluding this helper
        const replacementHelperId = await findAndAssociateNearestHelper(taskId, taskLocation, helperId);
        
        if (replacementHelperId) {
          // Update task association with new helper
          await redis.setex(`task:${taskId}:associated_helpers`, 2592000, JSON.stringify([replacementHelperId]));
          
          // Add task to new helper's list
          const newHelperTasksKey = `helper:${replacementHelperId}:associated_tasks`;
          const newHelperTasksData = await redis.get(newHelperTasksKey);
          let newHelperTasks = [];
          
          if (newHelperTasksData) {
            newHelperTasks = typeof newHelperTasksData === 'string' ? JSON.parse(newHelperTasksData) : newHelperTasksData;
          }
          
          if (!newHelperTasks.includes(taskId)) {
            newHelperTasks.push(taskId);
            await redis.setex(newHelperTasksKey, 43200, JSON.stringify(newHelperTasks));
          }
          
          console.log(`✅ Task ${taskId} reassigned to replacement helper ${replacementHelperId}`);
        } else {
          console.log(`⚠️ No replacement helper found for task ${taskId}`);
        }
      }
    } catch (reassignError) {
      console.warn(`⚠️ Failed to reassign task:`, reassignError.message);
    }
    
    res.status(200).json({
      success: true,
      message: "Task marked as passed. It has been reassigned to another nearby helper.",
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
  updateRejectionReason,
  passTask,
  verifyOTPAndStartTask,
  getMyAcceptedTasks,
  getMyTaskDetails,
};
