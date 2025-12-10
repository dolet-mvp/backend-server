const Helper = require("../../models/authModel/helperModel");
const Helpseeker = require("../../models/authModel/helpseekerModel");
const Task = require("../../models/taskModel/taskModel");
const Rating = require("../../models/ratingModel/ratingModel");
const Address = require("../../models/addressModel/addressModel");
const redis = require("../../config/redis/redis");
const axios = require("axios");

// Helper function to find and associate nearest available helper with a task
const findAndAssociateNearestHelper = async (taskId, taskLocation, excludeHelperId = null) => {
  try {
    console.log(`\n🔍 Finding replacement helper for task ${taskId}...`);
    
    // Get helpers who have already acted on this task (rejected/passed)
    const actionsKey = `task:${taskId}:actions`;
    const actionsData = await redis.get(actionsKey);
    let actedHelperIds = [];
    
    if (actionsData) {
      const actions = typeof actionsData === 'string' ? JSON.parse(actionsData) : actionsData;
      actedHelperIds = actions.map(action => action.helperId);
      console.log(`   Found ${actedHelperIds.length} helper(s) who already acted on this task`);
    }
    
    // Get all online helpers from Redis
    const onlineHelperKeys = await redis.keys('helper:online:*');
    
    if (!onlineHelperKeys || onlineHelperKeys.length === 0) {
      console.log('   ⚠️ No online helpers available');
      return null;
    }
    
    const helperPromises = onlineHelperKeys.map(key => redis.get(key));
    const helpersData = await Promise.all(helperPromises);
    
    const validHelpers = helpersData
      .filter(data => data !== null)
      .map(data => typeof data === 'string' ? JSON.parse(data) : data)
      .filter(helper => helper.id !== excludeHelperId && !actedHelperIds.includes(helper.id)); // Exclude helpers who acted
    
    if (validHelpers.length === 0) {
      console.log('   ⚠️ No other online helpers available');
      return null;
    }
    
    console.log(`   Found ${validHelpers.length} available helper(s)`);
    
    // Calculate distances using Google Maps API
    const helperLocations = [];
    const helperIds = [];
    
    for (const helper of validHelpers) {
      const address = helper.addresses?.find(addr => addr.isDefault) || helper.addresses?.[0];
      if (address && address.latitude && address.longitude) {
        helperLocations.push({ lat: parseFloat(address.latitude), lng: parseFloat(address.longitude) });
        helperIds.push(helper.id);
      }
    }
    
    if (helperLocations.length === 0) {
      console.log('   ⚠️ No helpers with valid addresses');
      return null;
    }
    
    // Get distances using batch API call
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      console.log('   ⚠️ Google Maps API key not found');
      return null;
    }
    
    const originStr = `${taskLocation.lat},${taskLocation.lng}`;
    const destinationsStr = helperLocations.map(loc => `${loc.lat},${loc.lng}`).join('|');
    
    try {
      const response = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
        params: {
          origins: originStr,
          destinations: destinationsStr,
          key: apiKey,
          mode: 'driving',
          units: 'metric',
        },
      });
      
      if (response.data.status === 'OK') {
        const elements = response.data.rows[0]?.elements || [];
        const helpersWithDistance = [];
        
        for (let i = 0; i < elements.length; i++) {
          if (elements[i].status === 'OK') {
            const distanceKm = elements[i].distance.value / 1000;
            if (distanceKm <= 50) { // Within 50km
              helpersWithDistance.push({
                helperId: helperIds[i],
                distance: distanceKm,
              });
            }
          }
        }
        
        if (helpersWithDistance.length > 0) {
          // Sort by distance and get nearest
          helpersWithDistance.sort((a, b) => a.distance - b.distance);
          const nearest = helpersWithDistance[0];
          
          console.log(`   ✅ Found replacement helper: ${nearest.helperId} (${nearest.distance.toFixed(2)}km)`);
          return nearest.helperId;
        }
      }
    } catch (apiError) {
      console.warn(`   ⚠️ Google Maps API error:`, apiError.message);
    }
    
    return null;
  } catch (error) {
    console.error(`   ❌ Error finding replacement helper:`, error.message);
    return null;
  }
};


// Get helper availability status
const getAvailabilityStatus = async (req, res) => {
  try {
    const helperId = req.user.id;

    // Check Redis first for online status
    const cachedHelper = await redis.get(`helper:online:${helperId}`);
    
    if (cachedHelper) {
      // Upstash Redis returns objects directly, no need to parse
      const helperData = typeof cachedHelper === 'string' ? JSON.parse(cachedHelper) : cachedHelper;
      return res.status(200).json({
        success: true,
        message: "Availability status retrieved successfully",
        data: {
          isAvailable: true,
          status: "online",
          onlineAt: helperData.onlineAt,
        },
      });
    }

    // If not in Redis, check database
    const helper = await Helper.findByPk(helperId, {
      attributes: ["id", "fullName", "isAvailable"],
    });

    if (!helper) {
      return res.status(404).json({
        success: false,
        message: "Helper not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Availability status retrieved successfully",
      data: {
        isAvailable: helper.isAvailable,
        status: helper.isAvailable ? "online" : "offline",
      },
    });
  } catch (error) {
    console.error("Get availability status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get availability status",
      error: error.message,
    });
  }
};

// Toggle helper availability
const toggleAvailability = async (req, res) => {
  try {
    const helperId = req.user.id;

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
      
      // ⚡ Run task association asynchronously (don't wait for it)
      // This allows the API to respond immediately while association happens in background
      setImmediate(async () => {
        try {
          const startTime = Date.now();
          const Task = require("../../models/taskModel/taskModel");
          const axios = require("axios");
          
          console.log(`⏱️ [PERF] Starting task association for helper ${helper.id}`);
          
          const allTaskKeys = await redis.keys('job:*');
          console.log(`⏱️ [PERF] Found ${allTaskKeys.length} task keys in ${Date.now() - startTime}ms`);
          
          if (allTaskKeys && allTaskKeys.length > 0) {
            const tasksPromises = allTaskKeys.map(key => redis.get(key));
            const tasksData = await Promise.all(tasksPromises);
            console.log(`⏱️ [PERF] Fetched task data in ${Date.now() - startTime}ms`);
          
            const helperAddress = helper.addresses.find(addr => addr.isDefault) || helper.addresses[0];
          
            if (helperAddress && helperAddress.latitude && helperAddress.longitude) {
              // Step 1: Parse tasks and collect task IDs
              const taskInfos = [];
              
              for (const taskData of tasksData) {
                if (!taskData) continue;
                
                const task = typeof taskData === 'string' ? JSON.parse(taskData) : taskData;
                const taskId = task.taskId || task.id;
                const taskLocation = task.location || (task.steps && task.steps[0] ? task.steps[0].location : null);
                
                if (taskLocation && taskLocation.lat && taskLocation.lng) {
                  taskInfos.push({
                    taskId: taskId,
                    location: taskLocation
                  });
                }
              }
            
              console.log(`⏱️ [PERF] Parsed ${taskInfos.length} tasks with valid locations in ${Date.now() - startTime}ms`);
              
              // Step 2: Batch fetch all Redis data (actions + associations) in parallel
              const redisCheckPromises = taskInfos.map(async (taskInfo) => {
                const [actionsData, associatedHelpersData] = await Promise.all([
                  redis.get(`task:${taskInfo.taskId}:actions`),
                  redis.get(`task:${taskInfo.taskId}:associated_helpers`)
                ]);
                
                return {
                  taskId: taskInfo.taskId,
                  location: taskInfo.location,
                  actionsData,
                  associatedHelpersData
                };
              });
              
              const redisResults = await Promise.all(redisCheckPromises);
              console.log(`⏱️ [PERF] Batch fetched Redis data for ${redisResults.length} tasks in ${Date.now() - startTime}ms`);
              
              // Step 3: Filter eligible tasks (fast, no Redis calls)
              const eligibleTasks = redisResults.filter(result => {
              // Check if helper already acted
              if (result.actionsData) {
                const actions = typeof result.actionsData === 'string' ? JSON.parse(result.actionsData) : result.actionsData;
                const hasActed = actions.some(action => action.helperId === helper.id);
                if (hasActed) {
                  console.log(`   ⏭️ Helper already acted on task ${result.taskId}, skipping`);
                  return false;
                }
              }
              
              // Check if task already associated with another helper
              if (result.associatedHelpersData) {
                const associatedHelpers = typeof result.associatedHelpersData === 'string' 
                  ? JSON.parse(result.associatedHelpersData) 
                  : result.associatedHelpersData;
                
                if (associatedHelpers && associatedHelpers.length > 0 && !associatedHelpers.includes(helper.id)) {
                  console.log(`   ⏭️ Task ${result.taskId} already associated with another helper, skipping`);
                  return false;
                }
              }
              
              return true;
            }).map(result => ({
              taskId: result.taskId,
              location: result.location
            }));
            
            console.log(`⏱️ [PERF] Filtered to ${eligibleTasks.length} eligible tasks in ${Date.now() - startTime}ms`);
            
            // Step 4: Calculate distances using BATCH Google Maps API call
            const tasksWithDistance = [];
            
            if (eligibleTasks.length > 0) {
              const apiKey = process.env.GOOGLE_MAPS_API_KEY;
              
              if (apiKey) {
                console.log(`⏱️ [PERF] Starting batch Google Maps API calls in ${Date.now() - startTime}ms`);
                
                // Google Maps allows up to 25 destinations per request
                const batchSize = 25;
                const batches = [];
                
                for (let i = 0; i < eligibleTasks.length; i += batchSize) {
                  batches.push(eligibleTasks.slice(i, i + batchSize));
                }
                
                console.log(`⏱️ [PERF] Split into ${batches.length} batch(es)`);
                
                // Process batches in parallel
                const batchPromises = batches.map(async (batch, batchIndex) => {
                  try {
                    const batchStart = Date.now();
                    const destinationsStr = batch.map(t => `${t.location.lat},${t.location.lng}`).join('|');
                    const url = `https://maps.googleapis.com/maps/api/distancematrix/json`;
                    
                    const response = await axios.get(url, {
                      params: {
                        origins: `${helperAddress.latitude},${helperAddress.longitude}`,
                        destinations: destinationsStr,
                        key: apiKey,
                        units: 'metric',
                      },
                      timeout: 5000, // 5 second timeout
                    });
                    
                    console.log(`⏱️ [PERF] Batch ${batchIndex + 1} completed in ${Date.now() - batchStart}ms`);
                    
                    if (response.data.status === 'OK' && response.data.rows[0]) {
                      const elements = response.data.rows[0].elements;
                      
                      return batch.map((task, index) => {
                        if (elements[index] && elements[index].status === 'OK') {
                          const distanceInMeters = elements[index].distance.value;
                          const distanceInKm = distanceInMeters / 1000;
                          
                          if (distanceInKm <= 50) {
                            return {
                              taskId: task.taskId,
                              distance: distanceInKm,
                            };
                          }
                        }
                        return null;
                      }).filter(Boolean);
                    }
                    return [];
                  } catch (error) {
                    console.warn(`⚠️ Batch API call failed:`, error.message);
                    return [];
                  }
                });
                
                const batchResults = await Promise.all(batchPromises);
                tasksWithDistance.push(...batchResults.flat());
                
                console.log(`⏱️ [PERF] All batches completed, found ${tasksWithDistance.length} tasks within 50km in ${Date.now() - startTime}ms`);
              }
            }
            
            // Step 5: Associate with nearest task
            if (tasksWithDistance.length > 0) {
              tasksWithDistance.sort((a, b) => a.distance - b.distance);
              const nearestTask = tasksWithDistance[0];
              const taskId = nearestTask.taskId;
              
              // Add helper to task's associated helpers (replace existing)
              const taskHelpersKey = `task:${taskId}:associated_helpers`;
              await redis.setex(taskHelpersKey, 2592000, JSON.stringify([helper.id]));
              
              // Add task to helper's associated tasks
              const helperTasksKey = `helper:${helper.id}:associated_tasks`;
              await redis.setex(helperTasksKey, 43200, JSON.stringify([taskId]));
              
              console.log(`✅ Helper ${helper.id} associated with nearest task ${taskId} (${nearestTask.distance.toFixed(2)}km)`);
              console.log(`⏱️ [PERF] TOTAL TIME: ${Date.now() - startTime}ms`);
            } else {
              console.log(`⚠️ No tasks found within 50km for helper ${helper.id} (after filtering acted tasks)`);
              console.log(`⏱️ [PERF] TOTAL TIME: ${Date.now() - startTime}ms`);
            }
            } // Close if (helperAddress && helperAddress.latitude && helperAddress.longitude)
          } // Close if (allTaskKeys && allTaskKeys.length > 0)
        } catch (associationError) {
          console.warn(`⚠️ Failed to associate helper with tasks:`, associationError.message);
        }
      });
      
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
      // If helper goes offline, remove from Redis immediately
      console.log(`\n📴 Helper ${helper.id} going offline...`);
      
      await redis.del(`helper:online:${helper.id}`);
      await redis.zrem('helpers:available', helper.id);
      
      console.log(`✅ Helper ${helper.id} marked as offline in Redis`);
      
      // ⚡ Run task reassignment asynchronously (don't wait for it)
      // This allows the API to respond immediately while reassignment happens in background
      setImmediate(async () => {
        try {
          const startTime = Date.now();
          console.log(`⏱️ [OFFLINE-PERF] Starting task reassignment for helper ${helper.id}`);
          
          const helperTasksKey = `helper:${helper.id}:associated_tasks`;
          const associatedTasksData = await redis.get(helperTasksKey);
          
          let taskIds = [];
          if (associatedTasksData) {
            if (typeof associatedTasksData === 'string') {
              taskIds = JSON.parse(associatedTasksData);
            } else if (Array.isArray(associatedTasksData)) {
              taskIds = associatedTasksData;
            }
          }
          
          console.log(`⏱️ [OFFLINE-PERF] Helper has ${taskIds.length} associated task(s) - fetched in ${Date.now() - startTime}ms`);
          
          if (taskIds.length === 0) {
            await redis.del(helperTasksKey);
            console.log(`⏱️ [OFFLINE-PERF] No tasks to reassign, TOTAL TIME: ${Date.now() - startTime}ms`);
            return;
          }
          
          // Batch fetch all task data in parallel
          const taskDataPromises = taskIds.map(taskId => redis.get(`job:${taskId}`));
          const taskDataResults = await Promise.all(taskDataPromises);
          console.log(`⏱️ [OFFLINE-PERF] Fetched ${taskIds.length} task data in ${Date.now() - startTime}ms`);
          
          // Process all task reassignments in parallel
          const reassignmentPromises = taskIds.map(async (taskId, index) => {
            const taskData = taskDataResults[index];
            
            if (!taskData) {
              console.log(`   ⚠️ Task ${taskId} not found in Redis`);
              return null;
            }
            
            const task = typeof taskData === 'string' ? JSON.parse(taskData) : taskData;
            const taskLocation = task.location || (task.steps && task.steps[0] ? task.steps[0].location : null);
            
            if (!taskLocation || !taskLocation.lat || !taskLocation.lng) {
              console.log(`   ⚠️ Task ${taskId} has no valid location`);
              await redis.del(`task:${taskId}:associated_helpers`);
              return null;
            }
            
            // Find replacement helper
            const replacementHelperId = await findAndAssociateNearestHelper(taskId, taskLocation, helper.id);
            
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
              
              console.log(`   ✅ Task ${taskId} reassigned to helper ${replacementHelperId}`);
              return replacementHelperId;
            } else {
              // No replacement found, remove association
              await redis.del(`task:${taskId}:associated_helpers`);
              console.log(`   ⚠️ No replacement found for task ${taskId}, association removed`);
              return null;
            }
          });
          
          await Promise.all(reassignmentPromises);
          console.log(`⏱️ [OFFLINE-PERF] All reassignments completed in ${Date.now() - startTime}ms`);
          
          // Clear this helper's associated tasks
          await redis.del(helperTasksKey);
          console.log(`✅ Helper ${helper.id} removed from all task associations`);
          console.log(`⏱️ [OFFLINE-PERF] TOTAL TIME: ${Date.now() - startTime}ms`);
          
        } catch (cleanupError) {
          console.error(`❌ Failed to reassign tasks:`, cleanupError.message);
        }
      });
      
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
};



// Get helper's completed tasks
const getHelperCompletedTasks = async (req, res) => {
  try {
    const { helperId } = req.params;

    const tasks = await Task.findAll({
      where: {
        assignedHelperId: helperId,
        status: "completed",
      },
      include: [
        {
          model: Helpseeker,
          as: "creator",
          attributes: ["id", "fullName", "profilePhoto"],
        },
      ],
      order: [["completedAt", "DESC"]],
      limit: 20,
    });

    res.status(200).json({
      success: true,
      data: tasks,
    });
  } catch (error) {
    console.error("Get helper completed tasks error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch completed tasks",
      error: error.message,
    });
  }
};

// Get helper's active tasks
const getHelperActiveTasks = async (req, res) => {
  try {
    const helperId = req.user.id;

    const tasks = await Task.findAll({
      where: {
        assignedHelperId: helperId,
        status: ["assigned", "in_progress"],
      },
      include: [
        {
          model: Helpseeker,
          as: "creator",
          attributes: ["id", "fullName", "profilePhoto", "phone"],
        },
      ],
      order: [["acceptedAt", "DESC"]],
    });

    res.status(200).json({
      success: true,
      data: tasks,
    });
  } catch (error) {
    console.error("Get helper active tasks error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch active tasks",
      error: error.message,
    });
  }
};

// Get count of available helpers
const getAvailableHelpersCount = async (req, res) => {
  try {
    // Get count from Redis sorted set
    const count = await redis.zcard('helpers:available');
    
    console.log(`📊 Available helpers count from Redis: ${count}`);

    res.status(200).json({
      success: true,
      message: "Available helpers count retrieved successfully from Redis",
      data: {
        availableHelpers: count,
        source: "redis",
      },
    });
  } catch (error) {
    console.error("Get available helpers count error:", error);
    
    // Fallback to database if Redis fails
    try {
      const count = await Helper.count({
        where: {
          isAvailable: true,
          verificationStatus: "approved",
        },
      });
      
      console.log(`📊 Fallback: Available helpers count from database: ${count}`);
      
      res.status(200).json({
        success: true,
        message: "Available helpers count retrieved successfully (database fallback)",
        data: {
          availableHelpers: count,
          source: "database",
        },
      });
    } catch (dbError) {
      console.error("Database fallback also failed:", dbError);
      res.status(500).json({
        success: false,
        message: "Failed to fetch available helpers count",
        error: error.message,
      });
    }
  }
};

// Debug endpoint to check Redis state
const debugRedisState = async (req, res) => {
  try {
    const { taskId } = req.query;
    
    const result = {
      timestamp: new Date().toISOString(),
    };
    
    // Get online helpers
    const onlineHelperKeys = await redis.keys('helper:online:*');
    result.onlineHelpersCount = onlineHelperKeys ? onlineHelperKeys.length : 0;
    result.onlineHelperIds = onlineHelperKeys ? onlineHelperKeys.map(key => key.replace('helper:online:', '')) : [];
    
    // If taskId provided, get task associations
    if (taskId) {
      const jobData = await redis.get(`job:${taskId}`);
      result.task = jobData ? (typeof jobData === 'string' ? JSON.parse(jobData) : jobData) : null;
      
      const associatedHelpersData = await redis.get(`task:${taskId}:associated_helpers`);
      result.associatedHelpers = associatedHelpersData ? JSON.parse(associatedHelpersData) : null;
    }
    
    // Get total jobs in queue
    const allJobKeys = await redis.keys('job:*');
    result.totalJobsInQueue = allJobKeys ? allJobKeys.length : 0;
    
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Debug Redis state error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to debug Redis state",
      error: error.message,
    });
  }
};

module.exports = {
  findAndAssociateNearestHelper,
  getAvailabilityStatus,
  toggleAvailability,
  getHelperCompletedTasks,
  getHelperActiveTasks,
  getAvailableHelpersCount,
  debugRedisState,
};
