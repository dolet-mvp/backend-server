const Task = require("../../models/taskModel/taskModel");
const TaskQueue = require("../../models/queueModel/queueModel");
const Notification = require("../../models/notificationModel/notificationModel");
const Helper = require("../../models/authModel/helperModel");
const Helpseeker = require("../../models/authModel/helpseekerModel");
const Address = require("../../models/addressModel/addressModel");
const redis = require("../../config/redis/redis");
const axios = require("axios");
const { Sequelize, Transaction } = require("sequelize");
const { sequelize } = require("../../dbConnection/dbConfig");
const { findAndAssociateNearestHelper } = require("../helperController/helperController");
const { getGoogleMapsDistances } = require("./helpseekerTaskController");
const { getCachedDistance, batchCacheDistances } = require("../../services/distanceCacheService");
const { sendToUser } = require("../../services/pushNotificationService");

// Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Store helper rejection/pass in Redis
const storeHelperAction = async (taskId, helperId, action, reason = null) => {
  const key = `task:${taskId}:actions`;
  
  // Get existing actions
  const existingActions = await redis.get(key);
  const actions = existingActions 
    ? (typeof existingActions === 'string' ? JSON.parse(existingActions) : existingActions)
    : [];
  
  // Check if this helper has already acted on this task
  const existingActionIndex = actions.findIndex(a => a.helperId === helperId);
  
  if (existingActionIndex !== -1) {
    // Helper already acted - update the existing action instead of adding duplicate
    console.log(`⚠️ Helper ${helperId} already ${actions[existingActionIndex].action} task ${taskId}, updating action...`);
    actions[existingActionIndex] = {
      helperId,
      action,
      reason,
      timestamp: new Date().toISOString(),
      previousAction: actions[existingActionIndex].action,
      previousTimestamp: actions[existingActionIndex].timestamp,
    };
  } else {
    // New action - add to list
    const actionData = {
      helperId,
      action, // 'rejected' or 'passed'
      reason,
      timestamp: new Date().toISOString(),
    };
    actions.push(actionData);
  }
  
  await redis.set(key, JSON.stringify(actions));
  await redis.expire(key, 86400); // 24 hours
  
  return actions;
};

// Check if helper has already rejected or passed a task
const hasHelperActedOnTask = async (taskId, helperId) => {
  const key = `task:${taskId}:actions`;
  const actionsData = await redis.get(key);
  
  if (!actionsData) return { hasActed: false, taskId, helperId };
  
  const actions = typeof actionsData === 'string' ? JSON.parse(actionsData) : actionsData;
  const actionFound = actions.find(action => action.helperId === helperId);
  
  return {
    hasActed: !!actionFound,
    taskId,
    helperId,
    action: actionFound?.action || null,
    timestamp: actionFound?.timestamp || null,
    reason: actionFound?.reason || null
  };
};

// Get all helpers who have acted on a task
const getTaskActions = async (taskId) => {
  const key = `task:${taskId}:actions`;
  const actionsData = await redis.get(key);
  
  return actionsData 
    ? (typeof actionsData === 'string' ? JSON.parse(actionsData) : actionsData)
    : [];
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

    // Enforce maximum radius of 100km to prevent unreasonable search radius
    const envRadius = parseFloat(process.env.TASK_SEARCH_RADIUS || 50);
    const maxRadius = 100;
    const searchRadius = Math.min(envRadius, maxRadius);
    
    if (envRadius > maxRadius) {
      console.log(`⚠️ Search radius ${envRadius}km exceeds maximum ${maxRadius}km, using ${searchRadius}km`);
    }

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

    // PERFORMANCE FIX: Use sorted set instead of keys() for non-blocking operation
    console.log("📡 Fetching tasks from Redis using sorted set...");
    const fetchStart = Date.now();
    
    // Get task IDs from sorted set (much faster than keys())
    const taskIds = await redis.zrange('jobs:published', 0, -1);
    
    if (!taskIds || taskIds.length === 0) {
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
    
    // Batch fetch all task data
    const redisPromises = taskIds.map(taskId => redis.get(`job:${taskId}`));
    const redisResults = await Promise.all(redisPromises);
    const tasksFromRedis = redisResults
      .filter(result => result)
      .map(result => {
        // Handle both string and object responses from Upstash Redis
        if (typeof result === 'string') {
          return JSON.parse(result);
        }
        return result;
      })
      .filter(task => task.status === 'in_queue');

    console.log(`✅ Found ${tasksFromRedis.length} tasks in Redis with status 'in_queue' (fetched in ${Date.now() - fetchStart}ms)`);

    // PERFORMANCE FIX: Batch validate tasks against database - Single query instead of N queries
    const taskIdsToValidate = tasksFromRedis.map(t => t.taskId || t.id);
    const validationStart = Date.now();
    
    const validDbTasks = await Task.findAll({
      where: {
        id: { [Sequelize.Op.in]: taskIdsToValidate },
        status: { [Sequelize.Op.in]: ['in_queue', 'published'] },
        assignedHelperId: null
      },
      attributes: ['id', 'status', 'assignedHelperId']
    });
    
    console.log(`⚡ Batch validation completed in ${Date.now() - validationStart}ms`);
    
    // Create Set for O(1) lookup
    const validTaskIdsSet = new Set(validDbTasks.map(t => t.id));
    
    // Filter Redis tasks to only valid ones
    const validTasks = tasksFromRedis.filter(task => {
      const taskId = task.taskId || task.id;
      return validTaskIdsSet.has(taskId);
    });
    
    // Clean up stale tasks from Redis in parallel (non-blocking)
    const staleTasks = tasksFromRedis.filter(task => {
      const taskId = task.taskId || task.id;
      return !validTaskIdsSet.has(taskId);
    });
    
    if (staleTasks.length > 0) {
      console.log(`🧹 Cleaning up ${staleTasks.length} stale task(s) from Redis...`);
      // Don't await - clean up in background
      Promise.all(
        staleTasks.map(task => {
          const taskId = task.taskId || task.id;
          return Promise.all([
            redis.del(`job:${taskId}`),
            redis.zrem('jobs:published', taskId)
          ]);
        })
      ).catch(err => console.warn('⚠️ Redis cleanup error:', err.message));
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

    // PERFORMANCE FIX: Batch fetch all task actions at once
    const actionCheckStart = Date.now();
    const actionKeys = tasksToProcess.map(task => `task:${task.taskId || task.id}:actions`);
    const actionsResults = await Promise.all(
      actionKeys.map(key => redis.get(key))
    );
    
    // Create a Map for O(1) lookup of whether helper acted on each task
    const helperActedOnTasks = new Map();
    actionsResults.forEach((actionsData, index) => {
      const taskId = tasksToProcess[index].taskId || tasksToProcess[index].id;
      if (actionsData) {
        const actions = typeof actionsData === 'string' ? JSON.parse(actionsData) : actionsData;
        const helperAction = actions.find(a => a.helperId === helperId);
        if (helperAction) {
          helperActedOnTasks.set(taskId, helperAction.action);
        }
      }
    });
    
    console.log(`⚡ Batch action check completed in ${Date.now() - actionCheckStart}ms`);
    
    // Filter out tasks this helper has already rejected or passed
    const availableTasksForHelper = tasksToProcess.filter(task => {
      const taskId = task.taskId || task.id;
      const action = helperActedOnTasks.get(taskId);
      if (action) {
        console.log(`⏭️ Helper ${helperId} already ${action} task ${taskId}, skipping...`);
        return false;
      }
      return true;
    });
    
    console.log(`✅ ${availableTasksForHelper.length} tasks available after filtering acted tasks`);

    // FIX PERFORMANCE: Batch all Google Maps API calls instead of sequential
    const distanceStart = Date.now();
    const nearbyTasks = [];
    
    // Separate tasks with and without location
    const noLocationTasks = [];
    const tasksWithLocation = [];
    
    for (const task of availableTasksForHelper) {
      if (!task.locationRequired || (!task.location && (!task.steps || !task.steps[0]?.location))) {
        noLocationTasks.push({ task, distance: 0, duration: null, distanceText: 'N/A', durationText: 'N/A' });
      } else {
        const taskLocation = task.location || (task.steps && task.steps[0] ? task.steps[0].location : null);
        if (taskLocation && taskLocation.lat && taskLocation.lng) {
          tasksWithLocation.push({
            task,
            location: { lat: parseFloat(taskLocation.lat), lng: parseFloat(taskLocation.lng) }
          });
        }
      }
    }
    
    // Add all no-location tasks
    nearbyTasks.push(...noLocationTasks);
    
    // Batch process tasks with location
    if (tasksWithLocation.length > 0) {
      const destinations = tasksWithLocation.map(t => t.location);
      
      // Call Google Maps API once for all destinations (up to 25 at a time)
      const batchSize = 25;
      for (let i = 0; i < destinations.length; i += batchSize) {
        const batch = destinations.slice(i, i + batchSize);
        const batchTasks = tasksWithLocation.slice(i, i + batchSize);
        
        const googleDistances = await getGoogleMapsDistances(
          { lat: helperLat, lng: helperLng },
          batch
        );
        
        if (googleDistances && googleDistances.length > 0) {
          batchTasks.forEach((taskInfo, index) => {
            const distanceData = googleDistances[index];
            
            if (distanceData && distanceData.status === 'OK') {
              const distance = distanceData.distance;
              const duration = distanceData.duration;
              
              if (distance <= searchRadius) {
                const distanceText = distance < 1 ? `${Math.round(distance * 1000)} m` : `${distance.toFixed(1)} km`;
                const durationText = duration < 60 ? `${Math.round(duration)} mins` : `${Math.floor(duration / 60)} hr ${Math.round(duration % 60)} mins`;
                
                nearbyTasks.push({
                  task: taskInfo.task,
                  distance: parseFloat(distance.toFixed(2)),
                  duration: duration * 60,
                  distanceText: distanceText,
                  durationText: durationText,
                  source: 'google_maps',
                });
              }
            } else {
              // Fallback to Haversine formula
              const distance = calculateDistance(
                helperLat,
                helperLng,
                taskInfo.location.lat,
                taskInfo.location.lng
              );
              
              if (distance <= searchRadius) {
                nearbyTasks.push({
                  task: taskInfo.task,
                  distance: parseFloat(distance.toFixed(2)),
                  duration: null,
                  distanceText: `${distance.toFixed(2)} km`,
                  durationText: 'N/A',
                  source: 'haversine',
                });
              }
            }
          });
        }
      }
    }
    
    console.log(`⚡ Distance calculations completed in ${Date.now() - distanceStart}ms`);
    
    // Sort nearby tasks by distance and format
    const sortedNearbyTasks = nearbyTasks
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

    // PERFORMANCE FIX: Batch fetch rejection counts for all tasks
    const rejectionStart = Date.now();
    const taskActionKeys = sortedNearbyTasks.map(task => `task:${task.id}:actions`);
    const taskActionsResults = await Promise.all(
      taskActionKeys.map(key => redis.get(key))
    );
    
    const tasksWithRejectionInfo = sortedNearbyTasks.map((task, index) => {
      const actionsData = taskActionsResults[index];
      let rejectionCount = 0;
      let passedCount = 0;
      let totalHelperActions = 0;
      
      if (actionsData) {
        const actions = typeof actionsData === 'string' ? JSON.parse(actionsData) : actionsData;
        rejectionCount = actions.filter(a => a.action === 'rejected').length;
        passedCount = actions.filter(a => a.action === 'passed').length;
        totalHelperActions = actions.length;
      }
      
      return {
        ...task,
        rejectionCount,
        passedCount,
        totalHelperActions,
      };
    });
    
    console.log(`⚡ Batch rejection info completed in ${Date.now() - rejectionStart}ms`);

    res.status(200).json({
      success: true,
      message: `Found ${sortedNearbyTasks.length} tasks within ${searchRadius}km`,
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
        nearbyTasks: sortedNearbyTasks.length,
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
  const helperId = req.user.id;
  const { taskId } = req.params;
  const startTime = Date.now();
  const redisTaskKey = `job:${taskId}`;
  
  // FIX RACE CONDITION: Start transaction FIRST with stricter isolation
  const transaction = await sequelize.transaction({
    isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE
  });
  
  try {
    // Get task with EXCLUSIVE ROW LOCK IMMEDIATELY to prevent concurrent access
    // Note: We cannot use include with FOR UPDATE in PostgreSQL, so lock first then fetch creator
    const task = await Task.findByPk(taskId, {
      lock: transaction.LOCK.UPDATE, // FOR UPDATE - blocks other helpers
      transaction
    });
    
    // Check if task exists in database
    if (!task) {
      await transaction.rollback();
      // Clean up Redis asynchronously
      Promise.all([
        redis.del(redisTaskKey),
        redis.zrem('jobs:published', taskId)
      ]).catch(err => console.warn('Redis cleanup failed:', err));
      
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }
    
    // Check if task exists in Redis (validate cache consistency)
    const cachedTask = await redis.get(redisTaskKey);
    
    if (!cachedTask) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Task not found or no longer available",
        hint: "This task may have been cancelled, completed, or removed from the queue",
      });
    }
 
    if (!task) {
      // Task exists in Redis but not in database - clean up Redis
      await transaction.rollback();
      await Promise.all([
        redis.del(redisTaskKey),
        redis.zrem('jobs:published', taskId)
      ]);
      
      return res.status(404).json({
        success: false,
        message: "Task not found in database",
      });
    }

    // Accept tasks with status "published" or "in_queue"
    if (task.status !== "in_queue" && task.status !== "published") {
      // Task status changed - remove from Redis cache
      await transaction.rollback();
      await Promise.all([
        redis.del(redisTaskKey),
        redis.zrem('jobs:published', taskId)
      ]);
      
      return res.status(400).json({
        success: false,
        message: "Task is not available for acceptance",
        currentStatus: task.status,
        allowedStatuses: ["in_queue", "published"],
        hint: "Task status has changed and has been removed from available tasks",
      });
    }

    // Check if task is already assigned (protected by row lock)
    if (task.assignedHelperId) {
      // Task already assigned - remove from Redis cache
      await transaction.rollback();
      await Promise.all([
        redis.del(redisTaskKey),
        redis.zrem('jobs:published', taskId)
      ]);
      
      return res.status(400).json({
        success: false,
        message: "This task has already been accepted by another helper",
        hint: "Another helper accepted this task moments ago",
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
      transaction
    });

    // Fetch creator (helpseeker) details separately (cannot include with FOR UPDATE lock)
    const creator = await Helpseeker.findByPk(task.helpseekerId, {
      attributes: ["id", "fullName", "email", "phone"],
      transaction
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
    await task.save({ transaction });

    // Remove from queue if exists
    await TaskQueue.destroy({
      where: { taskId: task.id },
      transaction
    });
    
    // Update helper availability status in database
    await Helper.update(
      { isAvailable: false },
      { where: { id: helperId }, transaction }
    );
    
    // FIX RACE CONDITION: Update Redis BEFORE commit to ensure atomicity
    // This prevents race window where helper appears available after accepting
    const redisCleanupStart = Date.now();
    try {
      await Promise.all([
        redis.del(redisTaskKey),
        redis.zrem('jobs:published', taskId),
        redis.del(`helper:online:${helperId}`),
        redis.zrem('helpers:available', helperId),
        redis.del(`task:${taskId}:actions`)
      ]);
      console.log(`✅ Redis cleanup completed in ${Date.now() - redisCleanupStart}ms`);
    } catch (redisError) {
      console.warn(`⚠️ Redis cleanup failed, rolling back transaction:`, redisError.message);
      await transaction.rollback();
      return res.status(500).json({
        success: false,
        message: "Failed to update task availability",
      });
    }
    
    // Commit transaction - releases lock
    await transaction.commit();
    console.log(`⏱️ [ACCEPT] Transaction committed in ${Date.now() - startTime}ms`);

    // FIX RESPONSE DELAY: Move location storage to background (non-blocking)
    // This reduces response time by 50-200ms
    setImmediate(async () => {
      try {
        console.log('📍 [ACCEPT TASK] Starting background location storage...');
        
        // Get helper's default address from the included addresses
        const helperAddress = helper.addresses?.find(addr => addr.isDefault === true) || helper.addresses?.[0];
        
        // Get helpseeker location from task or their default address
        let helpseekerLat = null;
        let helpseekerLng = null;

        if (task.location && task.location.lat && task.location.lng) {
          helpseekerLat = task.location.lat;
          helpseekerLng = task.location.lng;
        } else if (task.steps && task.steps.length > 0 && task.steps[0].location) {
          helpseekerLat = task.steps[0].location.lat;
          helpseekerLng = task.steps[0].location.lng;
        } else {
          const helpseekerAddress = await Address.findOne({
            where: { 
              helpseekerId: task.helpseekerId,
              isDefault: true 
            }
          });
          if (helpseekerAddress && helpseekerAddress.latitude && helpseekerAddress.longitude) {
            helpseekerLat = parseFloat(helpseekerAddress.latitude);
            helpseekerLng = parseFloat(helpseekerAddress.longitude);
          }
        }

        // Batch store both locations in parallel
        const locationPromises = [];
        
        if (helperAddress && helperAddress.latitude && helperAddress.longitude) {
          const helperLocationData = {
            taskId: task.id,
            helperId: helperId,
            latitude: parseFloat(helperAddress.latitude),
            longitude: parseFloat(helperAddress.longitude),
            timestamp: new Date().toISOString(),
          };
          
          const helperRedisKey = `tracking:task:${task.id}:helper:${helperId}`;
          locationPromises.push(
            redis.setex(helperRedisKey, 3600, JSON.stringify(helperLocationData))
              .then(() => console.log(`✅ [TRACKING] Helper location stored`))
          );
        }

        if (helpseekerLat && helpseekerLng) {
          const helpseekerLocationData = {
            taskId: task.id,
            helpseekerId: task.helpseekerId,
            latitude: helpseekerLat,
            longitude: helpseekerLng,
            timestamp: new Date().toISOString(),
          };
          
          const helpseekerRedisKey = `tracking:task:${task.id}:helpseeker:${task.helpseekerId}`;
          locationPromises.push(
            redis.setex(helpseekerRedisKey, 3600, JSON.stringify(helpseekerLocationData))
              .then(() => console.log(`✅ [TRACKING] Helpseeker location stored`))
          );
        }
        
        if (locationPromises.length > 0) {
          await Promise.all(locationPromises);
          console.log('✅ [TRACKING] All locations stored successfully');
        }
      } catch (locationError) {
        console.error("❌ [TRACKING] Background location storage failed:", locationError.message);
      }
    });

    // PERFORMANCE FIX: Create both notifications in parallel (non-blocking)
    Promise.all([
      Notification.create({
        helpseekerId: task.helpseekerId,
        userType: 'helpseeker',
        taskId: task.id,
        title: "Task Accepted by Helper",
        message: `${helper.fullName} has accepted your task "${task.title}". OTP: ${otp}. Share this OTP with the helper to start the task.`,
        type: "task_assigned",
        priority: "high",
      }),
      Notification.create({
        helperId: helperId,
        userType: 'helper',
        taskId: task.id,
        title: "Task Accepted Successfully",
        message: `You have accepted "${task.title}". The helpseeker will share the OTP with you to start the task. Contact: ${creator.fullName} (${creator.phone || creator.email})`,
        type: "task_assigned",
        priority: "high",
      })
    ]).catch(err => console.error('⚠️ Failed to create notifications:', err));

    // Send push notifications to both helper and helpseeker
    Promise.all([
      sendToUser(
        task.helpseekerId,
        'helpseeker',
        {
          title: "Task Accepted by Helper",
          body: `${helper.fullName} has accepted your task "${task.title}". OTP: ${otp}`,
        },
        {
          type: "task_assigned",
          taskId: task.id.toString(),
          otp: otp,
        }
      ).catch(err => console.error('⚠️ Failed to send push notification to helpseeker:', err)),
      sendToUser(
        helperId,
        'helper',
        {
          title: "Task Assigned Successfully",
          body: `You have accepted "${task.title}". Wait for helpseeker to share the OTP.`,
        },
        {
          type: "task_assigned",
          taskId: task.id.toString(),
        }
      ).catch(err => console.error('⚠️ Failed to send push notification to helper:', err))
    ]);

    res.status(200).json({
      success: true,
      message: "Task accepted successfully. OTP has been sent to the helpseeker.",
      data: {
        taskId: task.id,
        taskTitle: task.title,
        status: "assigned",
        acceptedAt: task.acceptedAt,
        helpseeker: {
          id: creator.id,
          name: creator.fullName,
          email: creator.email,
          phone: creator.phone,
        },
        message: "Wait for helpseeker to share the OTP with you to start the task",
      },
    });
  } catch (error) {
    // Rollback transaction on any error
    if (transaction && !transaction.finished) {
      await transaction.rollback();
      console.log('⚠️ Transaction rolled back due to error');
    }
    
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

    // Check if helper has already acted on this task
    const actionResult = await hasHelperActedOnTask(taskId, helperId);
    if (actionResult.hasActed) {
      return res.status(400).json({
        success: false,
        message: `You have already ${actionResult.action} this task`,
        data: {
          taskId: actionResult.taskId,
          action: actionResult.action,
          timestamp: actionResult.timestamp
        }
      });
    }

    // Store rejection in Redis immediately (even without reason)
    const actions = await storeHelperAction(taskId, helperId, 'rejected', rejectionReason);
    
    // PERFORMANCE FIX: Batch fetch both association lists in parallel
    const associationStart = Date.now();
    const helperTasksKey = `helper:${helperId}:associated_tasks`;
    const taskHelpersKey = `task:${taskId}:associated_helpers`;
    
    const [associatedTasksData, taskHelpersData] = await Promise.all([
      redis.get(helperTasksKey),
      redis.get(taskHelpersKey)
    ]);
    
    console.log(`⚡ Fetched associations in ${Date.now() - associationStart}ms`);
    
    // Remove this helper from task associations
    try {
      const updateOps = [];
      
      if (associatedTasksData) {
        const tasksList = typeof associatedTasksData === 'string' 
          ? JSON.parse(associatedTasksData) 
          : associatedTasksData;
        const updatedList = tasksList.filter(id => id !== taskId);
        
        if (updatedList.length > 0) {
          updateOps.push(redis.setex(helperTasksKey, 43200, JSON.stringify(updatedList)));
        } else {
          updateOps.push(redis.del(helperTasksKey));
        }
      }
      
      if (taskHelpersData) {
        const helpersList = typeof taskHelpersData === 'string' 
          ? JSON.parse(taskHelpersData) 
          : taskHelpersData;
        const updatedHelpers = helpersList.filter(id => id !== helperId);
        
        if (updatedHelpers.length > 0) {
          updateOps.push(redis.setex(taskHelpersKey, 2592000, JSON.stringify(updatedHelpers)));
        } else {
          updateOps.push(redis.del(taskHelpersKey));
        }
      }
      
      // Execute all Redis updates in parallel
      if (updateOps.length > 0) {
        await Promise.all(updateOps);
      }
      
      console.log(`✅ Helper ${helperId} removed from task ${taskId} associations after rejection`);
      
      // FIX PERFORMANCE: Move helper reassignment to background (non-blocking)
      // Add lightweight Redis lock per task to avoid concurrent reassignment
      setImmediate(async () => {
        const lockKey = `task:${taskId}:reassign_lock`;
        try {
          const existingLock = await redis.get(lockKey);
          if (existingLock) {
            console.log(`🔒 Reassignment lock already held for task ${taskId}, skipping this run`);
            return;
          }

          await redis.setex(lockKey, 10, "1");

          try {
            // Find and associate the nearest available helper to the rejected task
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
            
            // Now find other available tasks and associate them with this helper
            console.log(`\n🔄 [AUTO-ASSIGN] Searching for next pending task for helper ${helperId}...`);
            try {
              // Get helper's location
              const helperData = await redis.get(`helper:online:${helperId}`);
              if (helperData) {
                const helperInfo = typeof helperData === 'string' ? JSON.parse(helperData) : helperData;
                const helperAddress = helperInfo.addresses?.find(addr => addr.isDefault) || helperInfo.addresses?.[0];
                
                if (helperAddress && helperAddress.latitude && helperAddress.longitude) {
                  const taskIds = await redis.zrange('jobs:published', 0, -1);
                  console.log(`🔍 [AUTO-ASSIGN] Found ${taskIds.length} published tasks`);
                  
                  if (taskIds.length > 0) {
                    const tasksData = await Promise.all(taskIds.map(id => redis.get(`job:${id}`)));
                    const eligibleTasks = [];
                    
                    for (const taskData of tasksData) {
                      if (!taskData) continue;
                      
                      const pendingTask = typeof taskData === 'string' ? JSON.parse(taskData) : taskData;
                      const pendingTaskId = pendingTask.taskId || pendingTask.id;
                      
                      // Skip if task already has associated helpers
                      const taskHelpersData = await redis.get(`task:${pendingTaskId}:associated_helpers`);
                      if (taskHelpersData) {
                        const associatedHelpers = typeof taskHelpersData === 'string' ? JSON.parse(taskHelpersData) : taskHelpersData;
                        if (Array.isArray(associatedHelpers) && associatedHelpers.length > 0) {
                          continue;
                        }
                      }
                      
                      // Skip if helper already acted on this task
                      const actionsData = await redis.get(`task:${pendingTaskId}:actions`);
                      if (actionsData) {
                        const actions = typeof actionsData === 'string' ? JSON.parse(actionsData) : actionsData;
                        if (actions.some(action => action.helperId === helperId)) {
                          continue;
                        }
                      }
                      
                      const taskLocation = pendingTask.location || (pendingTask.steps && pendingTask.steps[0] ? pendingTask.steps[0].location : null);
                      if (taskLocation && taskLocation.lat && taskLocation.lng) {
                        eligibleTasks.push({
                          taskId: pendingTaskId,
                          location: taskLocation,
                          taskData: pendingTask
                        });
                      }
                    }
                    
                    console.log(`🔍 [AUTO-ASSIGN] Found ${eligibleTasks.length} eligible pending tasks`);
                    
                    if (eligibleTasks.length > 0) {
                      const axios = require('axios');
                      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
                      const tasksWithDistance = [];
                      
                      if (apiKey) {
                        const batchSize = 25;
                        for (let i = 0; i < eligibleTasks.length; i += batchSize) {
                          const batch = eligibleTasks.slice(i, i + batchSize);
                          const destinationsStr = batch.map(t => `${t.location.lat},${t.location.lng}`).join('|');
                          
                          try {
                            const response = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
                              params: {
                                origins: `${helperAddress.latitude},${helperAddress.longitude}`,
                                destinations: destinationsStr,
                                key: apiKey,
                                units: 'metric',
                              },
                              timeout: 5000,
                            });
                            
                            if (response.data.status === 'OK' && response.data.rows[0]) {
                              response.data.rows[0].elements.forEach((element, index) => {
                                if (element.status === 'OK') {
                                  const distanceInKm = element.distance.value / 1000;
                                  if (distanceInKm <= 50) {
                                    tasksWithDistance.push({
                                      taskId: batch[index].taskId,
                                      taskData: batch[index].taskData,
                                      distance: distanceInKm
                                    });
                                  }
                                }
                              });
                            }
                          } catch (error) {
                            console.warn(`⚠️ [AUTO-ASSIGN] Distance calculation failed:`, error.message);
                          }
                        }
                      }
                      
                      if (tasksWithDistance.length > 0) {
                        tasksWithDistance.sort((a, b) => a.distance - b.distance);
                        const nearestTask = tasksWithDistance[0];
                        
                        await redis.setex(`task:${nearestTask.taskId}:associated_helpers`, 2592000, JSON.stringify([helperId]));
                        await redis.setex(`helper:${helperId}:associated_tasks`, 43200, JSON.stringify([nearestTask.taskId]));
                        
                        console.log(`✅ [AUTO-ASSIGN] Helper ${helperId} auto-associated with task ${nearestTask.taskId} (${nearestTask.distance.toFixed(2)}km)`);
                        
                        const socketService = require("../../services/socketService");
                        socketService.notifyHelperOfAvailableJobs(helperId);
                        
                        const { sendToUser } = require("../../services/pushNotificationService");
                        await sendToUser(
                          helperId,
                          'helper',
                          {
                            title: "New Job Available",
                            body: `New job nearby: ${nearestTask.taskData.title}`,
                          },
                          { type: "new_job_available", taskId: nearestTask.taskId }
                        );
                      } else {
                        console.log(`ℹ️ [AUTO-ASSIGN] No pending tasks within 50km`);
                      }
                    }
                  }
                }
              }
            } catch (associateError) {
              console.error(`❌ [AUTO-ASSIGN] Error:`, associateError.message);
            }
          } finally {
            await redis.del(lockKey);
          }
        } catch (reassignError) {
          console.warn(`⚠️ Background reassignment failed:`, reassignError.message);
        }
      });
    } catch (reassignError) {
      console.warn(`⚠️ Failed to update task associations:`, reassignError.message);
    }
    
    // PERFORMANCE FIX: Use sorted set to get online helper count
    const onlineHelperCount = await redis.zcard('helpers:available');
    const rejectionCount = actions.filter(a => a.action === 'rejected').length;
    const passedCount = actions.filter(a => a.action === 'passed').length;
    const totalActions = rejectionCount + passedCount;
    
    // Check if all available helpers have acted on this task
    const allHelpersActed = totalActions >= onlineHelperCount;
   
    // PERFORMANCE FIX: Send notification asynchronously (non-blocking)
    Notification.create({
      helpseekerId: task.helpseekerId,
      userType: 'helpseeker',
      taskId: task.id,
      title: "Task Declined",
      message: `${helper.fullName} has declined your task "${task.title}". Reason: ${reason}${allHelpersActed ? ' (All available helpers have been shown this task)' : ''}`,
      type: "bid_rejected",
      priority: allHelpersActed ? "high" : "medium",
    }).catch(err => console.error('⚠️ Failed to create notification:', err));

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

    const actions = typeof actionsData === 'string' 
      ? JSON.parse(actionsData) 
      : actionsData;
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

    // Check if helper has already acted on this task
    const actionResult = await hasHelperActedOnTask(taskId, helperId);
    if (actionResult.hasActed) {
      return res.status(400).json({
        success: false,
        message: `You have already ${actionResult.action} this task`,
        data: {
          taskId: actionResult.taskId,
          action: actionResult.action,
          timestamp: actionResult.timestamp
        }
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
      
      // FIX PERFORMANCE: Move helper reassignment to background (non-blocking)
      // Add lightweight Redis lock per task to avoid concurrent reassignment
      setImmediate(async () => {
        const lockKey = `task:${taskId}:reassign_lock`;
        try {
          const existingLock = await redis.get(lockKey);
          if (existingLock) {
            console.log(`🔒 Reassignment lock already held for task ${taskId}, skipping this run`);
            return;
          }

          await redis.setex(lockKey, 10, "1");

          try {
            // Find and associate the nearest available helper to the passed task
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
            
            // Now find other available tasks and associate them with this helper
            console.log(`\n🔄 [AUTO-ASSIGN] Searching for next pending task for helper ${helperId}...`);
            try {
              // Get helper's location
              const helperData = await redis.get(`helper:online:${helperId}`);
              if (helperData) {
                const helper = typeof helperData === 'string' ? JSON.parse(helperData) : helperData;
                const helperAddress = helper.addresses?.find(addr => addr.isDefault) || helper.addresses?.[0];
                
                if (helperAddress && helperAddress.latitude && helperAddress.longitude) {
                  const taskIds = await redis.zrange('jobs:published', 0, -1);
                  console.log(`🔍 [AUTO-ASSIGN] Found ${taskIds.length} published tasks`);
                  
                  if (taskIds.length > 0) {
                    const tasksData = await Promise.all(taskIds.map(id => redis.get(`job:${id}`)));
                    const eligibleTasks = [];
                    
                    for (const taskData of tasksData) {
                      if (!taskData) continue;
                      
                      const pendingTask = typeof taskData === 'string' ? JSON.parse(taskData) : taskData;
                      const pendingTaskId = pendingTask.taskId || pendingTask.id;
                      
                      // Skip if task already has associated helpers
                      const taskHelpersData = await redis.get(`task:${pendingTaskId}:associated_helpers`);
                      if (taskHelpersData) {
                        const associatedHelpers = typeof taskHelpersData === 'string' ? JSON.parse(taskHelpersData) : taskHelpersData;
                        if (Array.isArray(associatedHelpers) && associatedHelpers.length > 0) {
                          continue;
                        }
                      }
                      
                      // Skip if helper already acted on this task
                      const actionsData = await redis.get(`task:${pendingTaskId}:actions`);
                      if (actionsData) {
                        const actions = typeof actionsData === 'string' ? JSON.parse(actionsData) : actionsData;
                        if (actions.some(action => action.helperId === helperId)) {
                          continue;
                        }
                      }
                      
                      const taskLocation = pendingTask.location || (pendingTask.steps && pendingTask.steps[0] ? pendingTask.steps[0].location : null);
                      if (taskLocation && taskLocation.lat && taskLocation.lng) {
                        eligibleTasks.push({
                          taskId: pendingTaskId,
                          location: taskLocation,
                          taskData: pendingTask
                        });
                      }
                    }
                    
                    console.log(`🔍 [AUTO-ASSIGN] Found ${eligibleTasks.length} eligible pending tasks`);
                    
                    if (eligibleTasks.length > 0) {
                      const axios = require('axios');
                      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
                      const tasksWithDistance = [];
                      
                      if (apiKey) {
                        const batchSize = 25;
                        for (let i = 0; i < eligibleTasks.length; i += batchSize) {
                          const batch = eligibleTasks.slice(i, i + batchSize);
                          const destinationsStr = batch.map(t => `${t.location.lat},${t.location.lng}`).join('|');
                          
                          try {
                            const response = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
                              params: {
                                origins: `${helperAddress.latitude},${helperAddress.longitude}`,
                                destinations: destinationsStr,
                                key: apiKey,
                                units: 'metric',
                              },
                              timeout: 5000,
                            });
                            
                            if (response.data.status === 'OK' && response.data.rows[0]) {
                              response.data.rows[0].elements.forEach((element, index) => {
                                if (element.status === 'OK') {
                                  const distanceInKm = element.distance.value / 1000;
                                  if (distanceInKm <= 50) {
                                    tasksWithDistance.push({
                                      taskId: batch[index].taskId,
                                      taskData: batch[index].taskData,
                                      distance: distanceInKm
                                    });
                                  }
                                }
                              });
                            }
                          } catch (error) {
                            console.warn(`⚠️ [AUTO-ASSIGN] Distance calculation failed:`, error.message);
                          }
                        }
                      }
                      
                      if (tasksWithDistance.length > 0) {
                        tasksWithDistance.sort((a, b) => a.distance - b.distance);
                        const nearestTask = tasksWithDistance[0];
                        
                        await redis.setex(`task:${nearestTask.taskId}:associated_helpers`, 2592000, JSON.stringify([helperId]));
                        await redis.setex(`helper:${helperId}:associated_tasks`, 43200, JSON.stringify([nearestTask.taskId]));
                        
                        console.log(`✅ [AUTO-ASSIGN] Helper ${helperId} auto-associated with task ${nearestTask.taskId} (${nearestTask.distance.toFixed(2)}km)`);
                        
                        const socketService = require("../../services/socketService");
                        socketService.notifyHelperOfAvailableJobs(helperId);
                        
                        const { sendToUser } = require("../../services/pushNotificationService");
                        await sendToUser(
                          helperId,
                          'helper',
                          {
                            title: "New Job Available",
                            body: `New job nearby: ${nearestTask.taskData.title}`,
                          },
                          { type: "new_job_available", taskId: nearestTask.taskId }
                        );
                      } else {
                        console.log(`ℹ️ [AUTO-ASSIGN] No pending tasks within 50km`);
                      }
                    }
                  }
                }
              }
            } catch (associateError) {
              console.error(`❌ [AUTO-ASSIGN] Error:`, associateError.message);
            }
          } finally {
            await redis.del(lockKey);
          }
        } catch (reassignError) {
          console.warn(`⚠️ Background reassignment failed:`, reassignError.message);
        }
      });
    } catch (reassignError) {
      console.warn(`⚠️ Failed to update task associations:`, reassignError.message);
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
  calculateDistance,
  getGoogleMapsDistances,
};
