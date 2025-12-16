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

    // Clean up task associations from Redis
    try {
      console.log(`\n🧹 Cleaning up task associations for completed task ${taskId}...`);
      
      // Remove task's associated helpers
      const taskHelpersKey = `task:${taskId}:associated_helpers`;
      await redis.del(taskHelpersKey);
      
      // Remove task from helper's associated tasks list
      const helperTasksKey = `helper:${helperId}:associated_tasks`;
      const helperTasksData = await redis.get(helperTasksKey);
      
      if (helperTasksData) {
        let taskIds = [];
        if (typeof helperTasksData === 'string') {
          taskIds = JSON.parse(helperTasksData);
        } else if (Array.isArray(helperTasksData)) {
          taskIds = helperTasksData;
        }
        
        // Remove this task from helper's list
        const updatedTaskIds = taskIds.filter(id => id !== taskId);
        
        if (updatedTaskIds.length > 0) {
          await redis.setex(helperTasksKey, 43200, JSON.stringify(updatedTaskIds));
        } else {
          await redis.del(helperTasksKey);
        }
      }
      
      // Remove task from published jobs
      await redis.del(`job:${taskId}`);
      
      console.log(`✅ Task ${taskId} associations cleaned up from Redis`);
    } catch (cleanupError) {
      console.warn(`⚠️ Failed to clean up task associations:`, cleanupError.message);
      // Continue execution even if cleanup fails
    }

    // Automatically set helper back to available if they were offline
    try {
      const Address = require('../../models/addressModel/addressModel');
      const helper = await Helper.findByPk(helperId, {
        include: [
          {
            model: Address,
            as: "addresses",
            attributes: ["id", "street", "city", "state", "latitude", "longitude", "isDefault"],
          },
        ],
      });

      if (helper && !helper.isAvailable) {
        helper.isAvailable = true;
        await helper.save();

        // Store helper in Redis as available
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

        await redis.set(`helper:online:${helper.id}`, helperData);
        await redis.expire(`helper:online:${helper.id}`, 43200);
        
        await redis.zadd('helpers:available', {
          score: Date.now(),
          member: helper.id,
        });
        
        console.log(`✅ Helper ${helper.id} automatically set to available after task completion`);
        
        // AUTO-ASSOCIATE: Find and assign next nearest pending task to this helper
        setImmediate(async () => {
          try {
            console.log(`\n🔍 [AUTO-ASSIGN] Looking for next pending task for helper ${helper.id}...`);
            
            const taskIds = await redis.zrange('jobs:published', 0, -1);
            console.log(`🔍 [AUTO-ASSIGN] Found ${taskIds.length} published tasks`);
            
            if (taskIds.length > 0) {
              const tasksData = await Promise.all(taskIds.map(id => redis.get(`job:${id}`)));
              const eligibleTasks = [];
              
              for (const taskData of tasksData) {
                if (!taskData) continue;
                
                const pendingTask = typeof taskData === 'string' ? JSON.parse(taskData) : taskData;
                const pendingTaskId = pendingTask.taskId || pendingTask.id;
                
                // Check if task already has associated helpers
                const taskHelpersData = await redis.get(`task:${pendingTaskId}:associated_helpers`);
                if (taskHelpersData) {
                  const associatedHelpers = typeof taskHelpersData === 'string' ? JSON.parse(taskHelpersData) : taskHelpersData;
                  if (Array.isArray(associatedHelpers) && associatedHelpers.length > 0) {
                    console.log(`   ⏭️ Task ${pendingTaskId} already has associated helpers, skipping`);
                    continue;
                  }
                }
                
                // Check if helper already acted on this task
                const actionsData = await redis.get(`task:${pendingTaskId}:actions`);
                if (actionsData) {
                  const actions = typeof actionsData === 'string' ? JSON.parse(actionsData) : actionsData;
                  if (actions.some(action => action.helperId === helper.id)) {
                    console.log(`   ⏭️ Helper already acted on task ${pendingTaskId}, skipping`);
                    continue;
                  }
                }
                
                // Add to eligible tasks if has location
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
                // Get helper's address from the helper object
                const helperAddress = helper.addresses?.find(addr => addr.isDefault) || helper.addresses?.[0];
                
                if (!helperAddress || !helperAddress.latitude || !helperAddress.longitude) {
                  console.log(`⚠️ [AUTO-ASSIGN] Helper ${helper.id} has no valid address`);
                  return;
                }
                
                // Calculate distances to find nearest task
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
                  // Sort by distance and get nearest
                  tasksWithDistance.sort((a, b) => a.distance - b.distance);
                  const nearestTask = tasksWithDistance[0];
                  
                  // Associate helper with nearest pending task
                  await redis.setex(
                    `task:${nearestTask.taskId}:associated_helpers`,
                    2592000,
                    JSON.stringify([helper.id])
                  );
                  
                  await redis.setex(
                    `helper:${helper.id}:associated_tasks`,
                    43200,
                    JSON.stringify([nearestTask.taskId])
                  );
                  
                  console.log(`✅ [AUTO-ASSIGN] Helper ${helper.id} auto-associated with task ${nearestTask.taskId} (${nearestTask.distance.toFixed(2)}km)`);
                  
                  // Notify helper via socket and push notification
                  const socketService = require("../../services/socketService");
                  socketService.notifyHelperOfAvailableJobs(helper.id);
                  
                  // Send push notification
                  const { sendPushNotification } = require("../../services/pushNotificationService");
                  await sendPushNotification({
                    userId: helper.id,
                    userType: 'helper',
                    title: "New Job Available",
                    message: `New job nearby: ${nearestTask.taskData.title}`,
                    data: {
                      type: "new_job_available",
                      taskId: nearestTask.taskId,
                    },
                  });
                } else {
                  console.log(`ℹ️ [AUTO-ASSIGN] No pending tasks within 50km for helper ${helper.id}`);
                }
              }
            } else {
              console.log(`ℹ️ [AUTO-ASSIGN] No published tasks available`);
            }
          } catch (autoAssignError) {
            console.error(`❌ [AUTO-ASSIGN] Error:`, autoAssignError.message);
          }
        });
      }
    } catch (helperUpdateError) {
      console.warn(`⚠️ Failed to update helper availability:`, helperUpdateError.message);
      // Continue execution even if helper update fails
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
      message: "Task completed successfully",
      data: { 
        task: {
          id: task.id,
          title: task.title,
          status: task.status,
          completedAt: task.completedAt,
          workDuration: workDuration,
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
    const io = socketService.getIO();
    if (io) {
      io.to(`task:${taskId}:tracking`).emit('helperLocationUpdate', locationData);
      console.log(`📍 [TRACKING] Broadcasted helper location for task ${taskId}`);
    }

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
