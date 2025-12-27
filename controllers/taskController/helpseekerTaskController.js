const Task = require("../../models/taskModel/taskModel");
const TaskQueue = require("../../models/queueModel/queueModel");
const Notification = require("../../models/notificationModel/notificationModel");
const Helper = require("../../models/authModel/helperModel");
const Helpseeker = require("../../models/authModel/helpseekerModel");
const Address = require("../../models/addressModel/addressModel");
const axios = require("axios");
const jobMatchingService = require("../../services/jobMatchingService");
const socketService = require("../../services/socketService");
const redis = require("../../config/redis/redis");
const { createNotification } = require("../../services/notificationService");
const { getCachedDistance, batchCacheDistances } = require("../../services/distanceCacheService");
const { sequelize } = require("../../dbConnection/dbConfig");
const { Transaction } = require("sequelize");
const { sendToUser } = require("../../services/pushNotificationService");


const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const createTask = async (req, res) => {
  try {
    const helpseekerId = req.user.id;
    // Verify helpseeker exists in database
    const helpseeker = await Helpseeker.findByPk(helpseekerId);
    if (!helpseeker) {
      return res.status(404).json({
        success: false,
        message: "Helpseeker not found. Please log in again.",
      });
    }
    
    let {
      title,
      description,
      category,
      budget,
      estimatedDuration,
      priority,
      locationRequired,
      location,
      allowDirectAcceptance,
      steps
    } = req.body;

    // Parse location if it comes as string from form-data
    if (location && typeof location === 'string') {
      try {
        location = JSON.parse(location);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: "Invalid location format. Must be a valid JSON object",
        });
      }
    }

    // Parse steps if it comes as string from form-data
    if (steps && typeof steps === 'string') {
      try {
        steps = JSON.parse(steps);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: "Invalid steps format. Must be a valid JSON array",
        });
      }
    }

    // Validate steps structure if provided
    if (steps && Array.isArray(steps)) {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
     
        // Set default values for step
        step.order = step.order || i + 1;
        step.isCompleted = step.isCompleted || false;
        step.completedAt = step.completedAt || null;
        step.description = step.description || "";
        step.notes = step.notes || "";
      }
    }

    // Validate location if task requires it
    if (locationRequired === 'true' || locationRequired === true) {
      if (!location) {
        return res.status(400).json({
          success: false,
          message: "Location is required for location-based tasks",
        });
      }

      // Validate location object structure
      if (!location.lat || !location.lng || !location.address) {
        return res.status(400).json({
          success: false,
          message: "Location must include latitude (lat), longitude (lng), and address",
        });
      }

      // Validate coordinates
      const lat = parseFloat(location.lat);
      const lng = parseFloat(location.lng);

      if (
        isNaN(lat) ||
        isNaN(lng) ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid location coordinates. Latitude must be between -90 and 90, longitude between -180 and 180",
        });
      }

      // Normalize location data
      location.lat = lat;
      location.lng = lng;
    }

    // Validate budget
    const taskBudget = parseFloat(budget);
    if (isNaN(taskBudget) || taskBudget <= 0) {
      return res.status(400).json({
        success: false,
        message: "Budget must be a positive number",
      });
    }

    // Handle uploaded attachments
    const attachments = req.fileUrls || [];

    const task = await Task.create({
      helpseekerId,
      title,
      description,
      category,
      budget: taskBudget,
      estimatedDuration,
      priority: priority || "medium",
      status: "draft",
      locationRequired: locationRequired || false,
      location: locationRequired ? location : null,
      attachments,
      allowDirectAcceptance: allowDirectAcceptance || true,
      steps: steps || []
    });

    console.log(" Task created successfully! Task ID:", task.id);
    console.log(" Helpseeker ID:", helpseekerId);

    res.status(201).json({
      success: true,
      message: "Task created successfully",
      data: task,
    });
  } catch (error) {
    console.error("Create task error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create task",
      error: error.message,
    });
  }
};

const   publishTask = async (req, res) => {
  const publishStartTime = Date.now();
  let transaction;
  try {
    const { taskId } = req.params;
    const helpseekerId = req.user.id;

    console.log(`⏱️ [PUBLISH] Starting publish for task ${taskId}`);

    // Use transaction + row lock to make publish idempotent per task
    transaction = await sequelize.transaction({
      isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE,
    });

    const task = await Task.findOne({
      where: { id: taskId, helpseekerId },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    console.log(`⏱️ [PUBLISH] Task found in ${Date.now() - publishStartTime}ms`);

    if (!task) {
      await transaction.rollback();
      transaction = null;
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (task.status !== "draft") {
      // Another publish may have already moved this task out of draft
      await transaction.rollback();
      transaction = null;
      return res.status(400).json({
        success: false,
        message: "Only draft tasks can be published",
      });
    }

    const saveStart = Date.now();
    task.status = "in_queue";
    await task.save({ transaction });
    console.log(`⏱️ [PUBLISH] Task saved in ${Date.now() - saveStart}ms`);

    const queueStart = Date.now();
    const queueCount = await TaskQueue.count({ transaction });

    // Ensure only one queue row per task inside the same transaction
    await TaskQueue.destroy({ where: { taskId: task.id }, transaction });
//remove ----check
    const queueEntry = await TaskQueue.create({
      taskId: task.id,
      queuePosition: queueCount + 1,
      priority: task.priority === "urgent" ? 10 : task.priority === "high" ? 5 : 0,
    }, { transaction });
    console.log(`⏱️ [PUBLISH] Queue entry created in ${Date.now() - queueStart}ms`);

    await transaction.commit();
    transaction = null;

    // Fetch helpseeker data for Redis
    const helpseeker = await Helpseeker.findByPk(helpseekerId);

    // Store the published job in Redis
    try {
      // Use main location or first step location for job data
      const jobLocation = task.location || (task.steps && task.steps[0] ? task.steps[0].location : null);
      
      const jobData = {
        taskId: task.id,
        helpseekerId: helpseekerId,
        helpseekerName: helpseeker?.fullName || null,
        helpseekerRating: helpseeker?.averageRating || 0.0,
        title: task.title,
        description: task.description,
        category: task.category,
        budget: task.budget,
        estimatedDuration: task.estimatedDuration,
        priority: task.priority,
        locationRequired: task.locationRequired,
        location: jobLocation, // Use combined location
        status: task.status,
        queuePosition: queueEntry.queuePosition,
        steps : task.steps,
        publishedAt: new Date().toISOString(),
      };
      
   
      // PERFORMANCE FIX: Batch Redis writes in parallel
      const redisStart = Date.now();
      await Promise.all([
        redis.setex(`job:${task.id}`, 2592000, JSON.stringify(jobData)),
        redis.zadd('jobs:published', {
          score: Date.now(),
          member: task.id // Store task ID, not key
        })
      ]);
      
      console.log(`⏱️ [PUBLISH] Redis writes completed in ${Date.now() - redisStart}ms`);
      console.log(`⏱️ [PUBLISH] Starting helper association (non-blocking) at ${Date.now() - publishStartTime}ms from start`);

      // Check if task has location (either main location or first step location)
      const taskLocationForBroadcast = task.location || (task.steps && task.steps[0] ? task.steps[0].location : null);
      const hasValidLocation = taskLocationForBroadcast && taskLocationForBroadcast.lat && taskLocationForBroadcast.lng;
      
      console.log(`📍 [PUBLISH] Task location check:`, {
        hasMainLocation: !!(task.location && task.location.lat && task.location.lng),
        hasStepLocation: !!(task.steps && task.steps[0] && task.steps[0].location),
        willBroadcast: !!hasValidLocation,
        locationSource: task.location ? 'main' : 'step',
      });

      // Associate newly published task with online helpers FIRST, then broadcast
      if (hasValidLocation) {
        // Capture the location in closure before async operation
        const taskLat = taskLocationForBroadcast.lat;
        const taskLng = taskLocationForBroadcast.lng;
        
        setImmediate(async () => {
          try {
            const startTime = Date.now();
            console.log(`🔗 [PUBLISH-BG] Helper association started for task ${task.id}`);
            
            // PERFORMANCE FIX: Use sorted set instead of keys()
            const onlineHelperIds = await redis.zrange('helpers:available', 0, -1);
            console.log(`🔗 [PUBLISH] Found ${onlineHelperIds.length} online helpers`);
            
            if (onlineHelperIds.length > 0) {
              const helpersData = await Promise.all(
                onlineHelperIds.map(id => redis.get(`helper:online:${id}`))
              );
              
              const eligibleHelpers = [];
              
              // Check each helper for eligibility
              for (const helperData of helpersData) {
                if (!helperData) continue;
                
                const helper = typeof helperData === 'string' ? JSON.parse(helperData) : helperData;
                const helperId = helper.id;
                
                // Check if helper already acted on this task  --check
                const actionsData = await redis.get(`task:${task.id}:actions`);
                if (actionsData) {
                  const actions = typeof actionsData === 'string' ? JSON.parse(actionsData) : actionsData;
                  if (actions.some(action => action.helperId === helperId)) {
                    console.log(`   ⏭️ Helper ${helperId} already acted on task, skipping`);
                    continue;
                  }
                }
                
                // CHECK: Skip if helper already has associated tasks (busy with another job)
                const helperTasksKey = `helper:${helperId}:associated_tasks`;
                const helperTasksData = await redis.get(helperTasksKey);
                if (helperTasksData) {
                  const existingTasks = typeof helperTasksData === 'string' ? JSON.parse(helperTasksData) : helperTasksData;
                  if (Array.isArray(existingTasks) && existingTasks.length > 0) {
                    console.log(`   ⏭️ Helper ${helperId} already has ${existingTasks.length} associated task(s), skipping`);
                    continue;
                  }
                }
                
                // Get helper's address
                const helperAddress = helper.addresses?.find(addr => addr.isDefault) || helper.addresses?.[0];
                if (helperAddress && helperAddress.latitude && helperAddress.longitude) {
                  eligibleHelpers.push({
                    helperId: helperId,
                    latitude: helperAddress.latitude,
                    longitude: helperAddress.longitude
                  });
                }
              }
              
              console.log(`🔗 [PUBLISH] ${eligibleHelpers.length} eligible helpers for association`);
              
              if (eligibleHelpers.length > 0) {
                // Calculate distances using Google Maps API
                const apiKey = process.env.GOOGLE_MAPS_API_KEY;
                const axios = require('axios');
                const helpersWithDistance = [];
                
                // PERFORMANCE FIX: Check cache before calling Google Maps API
                if (apiKey) {
                  // First, check cache for all helpers
                  const cacheCheckPromises = eligibleHelpers.map(async (helper) => {
                    const cached = await getCachedDistance(
                      helper.latitude,
                      helper.longitude,
                      taskLat,
                      taskLng
                    );
                    
                    if (cached && cached.distanceInMeters) {
                      const distanceInKm = cached.distanceInMeters / 1000;
                      if (distanceInKm <= 50) {
                        return {
                          helperId: helper.helperId,
                          distance: distanceInKm,
                          cached: true
                        };
                      }
                    }
                    
                    return {
                      helperId: helper.helperId,
                      helper: helper,
                      cached: false
                    };
                  });
                  
                  const cacheResults = await Promise.all(cacheCheckPromises);
                  const cachedHelpers = cacheResults.filter(r => r.cached);
                  const uncachedHelpers = cacheResults
                    .filter(r => !r.cached)
                    .map(r => r.helper);
                  
                  // Add cached results
                  helpersWithDistance.push(...cachedHelpers);
                  console.log(`📊 [PUBLISH] Cache hits: ${cachedHelpers.length}/${eligibleHelpers.length}`);
                  
                  // Only call API for uncached helpers
                  if (uncachedHelpers.length > 0) {
                    const batchSize = 25;
                    for (let i = 0; i < uncachedHelpers.length; i += batchSize) {
                      const batch = uncachedHelpers.slice(i, i + batchSize);
                      const originsStr = batch.map(h => `${h.latitude},${h.longitude}`).join('|');
                      
                      try {
                        const response = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
                          params: {
                            origins: originsStr,
                            destinations: `${taskLat},${taskLng}`,
                            key: apiKey,
                            units: 'metric',
                          },
                          timeout: 5000,
                        });
                        
                        if (response.data.status === 'OK') {
                          const distancesToCache = [];
                          
                          response.data.rows.forEach((row, index) => {
                            if (row.elements[0] && row.elements[0].status === 'OK') {
                              const distanceInKm = row.elements[0].distance.value / 1000;
                              
                              // Cache this result
                              distancesToCache.push({
                                originLat: batch[index].latitude,
                                originLng: batch[index].longitude,
                                destLat: taskLat,
                                destLng: taskLng,
                                distanceData: {
                                  distanceInMeters: row.elements[0].distance.value,
                                  durationInSeconds: row.elements[0].duration.value,
                                  distanceText: row.elements[0].distance.text,
                                  durationText: row.elements[0].duration.text
                                }
                              });
                              
                              if (distanceInKm <= 50) {
                                helpersWithDistance.push({
                                  helperId: batch[index].helperId,
                                  distance: distanceInKm
                                });
                              }
                            }
                          });
                          
                          // Batch cache all new results
                          if (distancesToCache.length > 0) {
                            batchCacheDistances(distancesToCache).catch(err => 
                              console.error('Failed to cache distances:', err)
                            );
                          }
                        }
                      } catch (error) {
                        console.warn(`⚠️ Batch distance calculation failed:`, error.message);
                      }
                    }
                  }
                }
                
                console.log(`🔗 [PUBLISH] ${helpersWithDistance.length} helpers within 50km`);
                
                if (helpersWithDistance.length > 0) {
                  // Sort by distance and get closest helper
                  helpersWithDistance.sort((a, b) => a.distance - b.distance);
                  const closestHelper = helpersWithDistance[0];
                  
                  // Associate task with closest helper
                  await redis.setex(
                    `task:${task.id}:associated_helpers`,
                    780,
                    JSON.stringify([closestHelper.helperId])
                  );
                  
                  // Add to helper's associated tasks
                  const helperTasksKey = `helper:${closestHelper.helperId}:associated_tasks`;
                  const existingTasks = await redis.get(helperTasksKey);
                  let taskIds = existingTasks 
                    ? (typeof existingTasks === 'string' ? JSON.parse(existingTasks) : existingTasks)
                    : [];
                  
                  if (!taskIds.includes(task.id)) {
                    taskIds.push(task.id);
                    await redis.setex(helperTasksKey, 43200, JSON.stringify(taskIds));
                  }
                  
                  console.log(`✅ [PUBLISH] Task ${task.id} associated with helper ${closestHelper.helperId} (${closestHelper.distance.toFixed(2)}km)`);
                  console.log(`⏱️ [PUBLISH] Total time: ${Date.now() - startTime}ms`);
                  
                  // NOW broadcast to helpers via socket AFTER association is complete
                  console.log(`📡 [PUBLISH] Broadcasting to helpers now that association is complete...`);
                  console.log(`📡 [PUBLISH] Task data being broadcast:`, {
                    taskId: jobData.taskId,
                    title: jobData.title,
                    associatedHelper: closestHelper.helperId,
                    location: jobData.location,
                  });
                  
                  try {
                    await socketService.broadcastNewJobToSearchingHelpers(jobData);
                    console.log(`✅ [PUBLISH] Socket broadcast completed successfully`);
                  } catch (socketError) {
                    console.error(`❌ [PUBLISH] Failed to broadcast job via socket:`, socketError.message);
                    console.error(`❌ [PUBLISH] Socket error stack:`, socketError.stack);
                  }
                  
                  // Send push notification to the associated helper
                  try {
                    await sendToUser(
                      closestHelper.helperId,
                      'helper',
                      {
                        title: "New Task Available Near You!",
                        body: `${task.title} - ₹${task.budget} (${closestHelper.distance.toFixed(2)}km away)`,
                      },
                      {
                        type: "task_available",
                        taskId: task.id.toString(),
                        distance: closestHelper.distance.toString(),
                      }
                    );
                    console.log(`📲 [PUBLISH] Push notification sent to helper ${closestHelper.helperId}`);
                  } catch (pushError) {
                    console.error(`⚠️ [PUBLISH] Failed to send push notification:`, pushError.message);
                  }
                }
              }
            }
          } catch (error) {
            console.error(`⚠️ [PUBLISH] Helper association failed:`, error.message);
          }
        });
      }
    } catch (redisError) {
      console.error(`⚠️ Failed to store job in Redis:`, redisError);
      // Continue execution even if Redis fails
    }

    if (task.locationRequired && task.location && task.location.lat && task.location.lng) {
      // FIX PERFORMANCE: Move job matching to background (non-blocking)
      setImmediate(() => {
        jobMatchingService.startJobMatching({
          taskId: task.id,
          userId: helpseekerId,
          title: task.title,
          description: task.description,
          budget: task.budget,
          category: task.category,
          latitude: task.location.lat,
          longitude: task.location.lng,
        }).catch(err => {
          console.error(`Job matching failed for task ${task.id}:`, err);
        });
      });
    } else {
      // FIX PERFORMANCE: Move notifications to background (non-blocking)
      setImmediate(async () => {
        try {
          const helpers = await Helper.findAll({
            where: { verificationStatus: "approved", isApproved: true },
          });

          const notifications = helpers.map((helper) => ({
            helperId: helper.id,
            userType: 'helper',
            taskId: task.id,
            title: "New Task Available",
            message: `New task: ${task.title}`,
            type: "task_created",
            priority: task.priority,
          }));

          await Notification.bulkCreate(notifications);
          console.log(`✅ Sent notifications to ${helpers.length} helpers for non-location task ${task.id}`);
        } catch (notifError) {
          console.error(`⚠️ Failed to send notifications for task ${task.id}:`, notifError.message);
        }
      });
    }

    console.log(`⏱️ [PUBLISH] Total time: ${Date.now() - publishStartTime}ms - Sending response now`);
    res.status(200).json({
      success: true,
      message: "Task published to queue successfully",
      data: { task, queuePosition: queueEntry.queuePosition },
    });
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }

    console.error("Publish task error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to publish task",
      error: error.message,
    });
  }
};

const scheduleTaskPublish = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { scheduledPublishAt } = req.body;
    const helpseekerId = req.user.id;

    if (!scheduledPublishAt) {
      return res.status(400).json({
        success: false,
        message: "Scheduled publish date and time is required",
      });
    }

    const task = await Task.findOne({ where: { id: taskId, helpseekerId } });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (task.status !== "draft") {
      return res.status(400).json({
        success: false,
        message: "Only draft tasks can be scheduled for publishing",
      });
    }

    // Parse the received time as IST and convert to UTC
    const receivedTime = scheduledPublishAt;
    
    // Create date object from received time (assumes IST input)
    const istDate = new Date(receivedTime);
    
    // Subtract 5 hours 30 minutes to convert IST to UTC
    const utcDate = new Date(istDate.getTime() - (5 * 60 + 30) * 60 * 1000);
    
    const currentDate = new Date();

    console.log(`\n⏰ Scheduling task "${task.title}":`);
    console.log(`   Received time (IST): ${receivedTime}`);
    console.log(`   Received as Date: ${istDate.toISOString()}`);
    console.log(`   Converted to UTC: ${utcDate.toISOString()}`);
    console.log(`   Converted to IST display: ${utcDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    console.log(`   Current time (UTC): ${currentDate.toISOString()}`);
    console.log(`   Current time (IST): ${currentDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);

    // Validate that scheduled date is in the future (must be at least 1 hour ahead)
    // Add 1 hour buffer to current time since we publish 1 hour early
    const minimumScheduleTime = new Date(currentDate.getTime() + 60 * 60 * 1000);
    
    if (utcDate <= minimumScheduleTime) {
      return res.status(400).json({
        success: false,
        message: `Scheduled publish time must be at least 1 hour in the future. Current time (IST): ${currentDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}, Minimum schedule time (IST): ${minimumScheduleTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
      });
    }

    // Calculate actual publish time (1 hour before scheduled time)
    const actualPublishTime = new Date(utcDate.getTime() - 60 * 60 * 1000);
    
    console.log(`   📋 Schedule details:`);
    console.log(`      User requested schedule (IST): ${utcDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    console.log(`      Actual publish time (IST): ${actualPublishTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} (1 hour before)`);
    console.log(`      Actual publish time (UTC): ${actualPublishTime.toISOString()}`);

    // Update task with schedule information
    // Store the actual publish time (1 hour before user's requested time)
    task.scheduledPublishAt = actualPublishTime;
    task.isScheduled = true;
    await task.save();

    console.log(`   ✅ Task scheduled successfully!`);
    console.log(`   ✅ Will be published 1 hour before the requested time`);

    res.status(200).json({
      success: true,
      message: "Task scheduled for publishing successfully. Note: The task will be published 1 hour before the scheduled time to ensure timely delivery.",
      data: {
        task: {
          id: task.id,
          title: task.title,
          status: task.status,
          isScheduled: task.isScheduled,
          requestedScheduleTime: utcDate,
          requestedScheduleTimeIST: utcDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
          actualPublishTime: task.scheduledPublishAt,
          actualPublishTimeIST: new Date(task.scheduledPublishAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
          publishedEarly: "1 hour before scheduled time"
        },
      },
    });
  } catch (error) {
    console.error("Schedule task publish error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to schedule task",
      error: error.message,
    });
  }
};

const cancelScheduledPublish = async (req, res) => {
  try {
    const { taskId } = req.params;
    const helpseekerId = req.user.id;

    const task = await Task.findOne({ where: { id: taskId, helpseekerId } });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (!task.isScheduled) {
      return res.status(400).json({
        success: false,
        message: "Task is not scheduled for publishing",
      });
    }

    if (task.status !== "draft") {
      return res.status(400).json({
        success: false,
        message: "Cannot cancel schedule for non-draft tasks",
      });
    }

    // Cancel the schedule
    task.scheduledPublishAt = null;
    task.isScheduled = false;
    await task.save();

    res.status(200).json({
      success: true,
      message: "Scheduled publish cancelled successfully",
      data: { task },
    });
  } catch (error) {
    console.error("Cancel scheduled publish error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to cancel scheduled publish",
      error: error.message,
    });
  }
};

const getMyTasks = async (req, res) => {
  try {
    const helpseekerId = req.user.id;

    const { status } = req.query;

    console.log(" Getting tasks for helpseekerId:", helpseekerId);
    console.log(" Status filter:", status || "all");

    const whereClause = { helpseekerId };
    if (status) {
      whereClause.status = status;
    }

    const tasks = await Task.findAll({
      where: whereClause,
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: Helper,
          as: "assignedHelper",
          attributes: ["id", "fullName", "profilePhoto", "phone"],
        },
      ],
    });

    console.log(` Found ${tasks.length} tasks for user`);

    res.status(200).json({
      success: true,
      data: tasks,
    });
  } catch (error) {
    console.error("❌ Get my tasks error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch tasks",
      error: error.message,
    });
  }
};

const getTaskById = async (req, res) => {
  try {
    const helpseekerId = req.user.id;
    const { taskId } = req.params;

    const task = await Task.findOne({
      where: { 
        id: taskId, 
        helpseekerId 
      },
      include: [
        {
          model: Helper,
          as: "assignedHelper",
          attributes: ["id", "fullName", "profilePhoto", "phone", "email"],
        },
      ],
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    res.status(200).json({
      success: true,
      data: task,
    });
  } catch (error) {
    console.error("Get task by ID error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch task details",
      error: error.message,
    });
  }
};

const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return distance; // Returns distance in kilometers
};

// Get distances using Google Maps Distance Matrix API
const getGoogleMapsDistances = async (origin, destinations) => {
  try {
    const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY?.trim();
    
    if (!GOOGLE_MAPS_API_KEY) {
      console.warn("⚠️ Google Maps API key not found, falling back to Haversine formula");
      return null;
    }

    // Validate destinations array
    if (!destinations || destinations.length === 0) {
      console.warn("⚠️ No destinations provided for Google Maps API");
      return null;
    }

    // Validate and filter destinations
    const validDestinations = destinations.filter(dest => 
      dest && 
      dest.lat != null && 
      dest.lng != null && 
      !isNaN(dest.lat) && 
      !isNaN(dest.lng)
    );

    if (validDestinations.length === 0) {
      console.warn("⚠️ No valid destinations with coordinates");
      return null;
    }

    // Validate origin
    if (!origin || origin.lat == null || origin.lng == null || isNaN(origin.lat) || isNaN(origin.lng)) {
      console.warn("⚠️ Invalid origin coordinates");
      return null;
    }

    // Format origin and destinations for API
    const originStr = `${origin.lat},${origin.lng}`;
    const destinationsStr = validDestinations
      .map((dest) => `${dest.lat},${dest.lng}`)
      .join("|");

    console.log(`🔍 Google Maps API Request - Origin: ${originStr}, Destinations count: ${validDestinations.length}`);

    const url = `https://maps.googleapis.com/maps/api/distancematrix/json`;
    
    const response = await axios.get(url, {
      params: {
        origins: originStr,
        destinations: destinationsStr,
        key: GOOGLE_MAPS_API_KEY,
        mode: "driving",
        units: "metric",
      },
    });

    if (response.data.status !== "OK") {
      console.warn(`⚠️ Google Maps API returned status: ${response.data.status}`);
      if (response.data.error_message) {
        console.warn(`⚠️ Error message: ${response.data.error_message}`);
      }
      return null;
    }

    // Extract distances from response
    const results = response.data.rows[0]?.elements || [];
    return results.map((element, index) => ({
      helperIndex: index,
      distance: element.status === "OK" ? element.distance.value / 1000 : null, // Convert meters to km
      duration: element.status === "OK" ? element.duration.value / 60 : null, // Convert seconds to minutes
      status: element.status,
    }));
  } catch (error) {
    console.error("❌ Google Maps API error:", error.message);
    return null;
  }
};

// Get nearby helpers within radius (Helpseeker)
const getNearbyHelpers = async (req, res) => {
  try {
    const helpseekerId = req.user.id;
    const radius = process.env.TASK_SEARCH_RADIUS;

    console.log("🔍 Searching for online helpers near helpseeker:", helpseekerId);

    // Get helpseeker's address with coordinates
    const userAddress = await Address.findOne({
      where: {
        helpseekerId: helpseekerId,
        userType: 'helpseeker',
        latitude: {
          [require("sequelize").Op.ne]: null,
        },
        longitude: {
          [require("sequelize").Op.ne]: null,
        },
      },
      order: [
        ["isDefault", "DESC"], // Prefer default address
        ["createdAt", "DESC"],  // Or most recent address
      ],
    });

    if (!userAddress) {
      return res.status(400).json({
        success: false,
        message: "No address with coordinates found for your account. Please add your location in profile settings.",
      });
    }

    const lat = parseFloat(userAddress.latitude);
    const lng = parseFloat(userAddress.longitude);
    const searchRadius = parseFloat(radius);

    console.log("📍 User location:", {
      latitude: lat,
      longitude: lng,
      city: userAddress.city,
      state: userAddress.state,
      addressType: userAddress.type,
      isDefault: userAddress.isDefault
    });

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({
        success: false,
        message: "Invalid coordinates",
      });
    }

    console.log("🔄 Search filters:");
    console.log(`   Radius: ${searchRadius} km`);
    console.log(`   Source: Redis (online helpers only)`);

    // Step 1: Get all online helper IDs from Redis
    console.log("\n📡 Step 1: Fetching online helpers from Redis...");
    const onlineHelperIds = await redis.zrange('helpers:available', 0, -1);
    
    if (!onlineHelperIds || onlineHelperIds.length === 0) {
      console.log("ℹ️  No online helpers found in Redis");
      return res.status(200).json({
        success: true,
        message: "No online helpers available at the moment",
        data: {
          searchLocation: {
            latitude: lat,
            longitude: lng,
          },
          radius: searchRadius,
          count: 0,
          helpers: [],
        },
      });
    }

    console.log(`✅ Found ${onlineHelperIds.length} online helpers in Redis`);

    // Step 2: Get full helper details from Redis
    console.log("\n📄 Step 2: Fetching helper details from Redis...");
    const helperDataPromises = onlineHelperIds.map(helperId => 
      redis.get(`helper:online:${helperId}`).catch(err => {
        console.error(`⚠️ Failed to get helper ${helperId} from Redis:`, err.message);
        return null;
      })
    );
    
    const helperDataResults = await Promise.all(helperDataPromises);
    const onlineHelpers = helperDataResults
      .filter(data => data !== null && data !== undefined)
      .map(data => {
        try {
          // Upstash Redis returns objects directly if they were stored as JSON strings
          // If it's already an object, return it; if it's a string, parse it
          if (typeof data === 'string') {
            return JSON.parse(data);
          }
          return data;
        } catch (parseError) {
          console.error('⚠️ Failed to parse helper data from Redis:', parseError.message);
          return null;
        }
      })
      .filter(helper => helper !== null && helper !== undefined && typeof helper === 'object');

    console.log(`✅ Retrieved ${onlineHelpers.length} valid helper profiles from Redis`);

    // Step 3: Calculate distances and filter by radius
    console.log("\n📏 Step 3: Calculating distances and filtering by radius...");
    
    const helperLocations = [];
    const helperData = [];

    for (const helper of onlineHelpers) {
      // Safety check: ensure helper has required fields
      if (!helper || !helper.id) {
        console.log(`⚠️  Invalid helper object, skipping`);
        continue;
      }

      // Get default address or first available address
      const addresses = Array.isArray(helper.addresses) ? helper.addresses : [];
      const address = addresses.find(addr => addr && addr.isDefault) || addresses[0];
      
      if (!address || !address.latitude || !address.longitude) {
        console.log(`⚠️  Helper ${helper.fullName || helper.id} has no valid address, skipping`);
        continue;
      }

      const helperLat = parseFloat(address.latitude);
      const helperLng = parseFloat(address.longitude);

      if (isNaN(helperLat) || isNaN(helperLng)) {
        console.log(`⚠️  Helper ${helper.fullName || helper.id} has invalid coordinates, skipping`);
        continue;
      }
//await ---check
     helperLocations.push({ lat: helperLat, lng: helperLng });
      helperData.push({
        id: helper.id,
        fullName: helper.fullName,
        email: helper.email,
        phone: helper.phone,
        profilePhoto: helper.profilePhoto,
        averageRating: helper.averageRating,
        completedTasks: helper.completedTasks,
        location: {
          latitude: helperLat,
          longitude: helperLng,
          city: address.city,
          state: address.state,
        },
        onlineAt: helper.onlineAt,
      });
    }

    console.log(`📊 Processing ${helperData.length} helpers with valid addresses...`);

    // Get distances using Google Maps API
    console.log("\n🗺️  Step 4: Calculating real road distances with Google Maps API...");
    const googleDistances = await getGoogleMapsDistances(
      { lat, lng },
      helperLocations
    );

    // Filter helpers within radius and format response
    const nearbyHelpers = [];
    const debugInfo = {
      totalOnline: onlineHelpers.length,
      withValidAddress: helperData.length,
      withinRadius: 0,
      outsideRadius: 0,
      usingGoogleMaps: googleDistances !== null
    };

    for (let i = 0; i < helperData.length; i++) {
      const helper = helperData[i];

      let distance;
      let duration = null;

      // Use Google Maps distance if available, otherwise fallback to Haversine
      if (googleDistances && googleDistances[i] && googleDistances[i].status === "OK") {
        distance = googleDistances[i].distance;
        duration = googleDistances[i].duration;
        console.log(`✓ ${helper.fullName}:`);
        console.log(`   📍 ${helper.location.city}, ${helper.location.state}`);
        console.log(`   🚗 Road Distance: ${distance.toFixed(2)} km`);
        console.log(`   ⏱️  Travel Time: ${Math.round(duration)} mins`);
      } else {
        // Fallback to Haversine formula
        distance = calculateDistance(lat, lng, helper.location.latitude, helper.location.longitude);
        console.log(`✓ ${helper.fullName}:`);
        console.log(`   📍 ${helper.location.city}, ${helper.location.state}`);
        console.log(`   📏 Straight-line Distance: ${distance.toFixed(2)} km`);
      }

      // Check if within radius
      if (distance > searchRadius) {
        debugInfo.outsideRadius++;
        console.log(`   ❌ Outside radius (${distance.toFixed(2)} km > ${searchRadius} km)`);
        continue;
      }

      debugInfo.withinRadius++;
      console.log(`   ✅ Within radius!`);
//await --check
      nearbyHelpers.push({
        id: helper.id,
        fullName: helper.fullName,
        email: helper.email,
        phone: helper.phone,
        profilePhoto: helper.profilePhoto,
        averageRating: helper.averageRating,
        completedTasks: helper.completedTasks,
        location: helper.location,
        distance: parseFloat(distance.toFixed(2)),
        travelTime: duration ? Math.round(duration) : null,
        distanceType: googleDistances ? "road" : "straight-line",
        onlineAt: helper.onlineAt,
        status: "online",
      });
    }

    // Sort by distance (nearest first)
    nearbyHelpers.sort((a, b) => a.distance - b.distance);

    console.log("\n✨ SEARCH SUMMARY:");
    console.log(`   Total online helpers: ${debugInfo.totalOnline}`);
    console.log(`   With valid addresses: ${debugInfo.withValidAddress}`);
    console.log(`   Distance calculation: ${debugInfo.usingGoogleMaps ? "🗺️  Google Maps API (road)" : "📏 Haversine (straight-line)"}`);
    console.log(`   Outside radius: ${debugInfo.outsideRadius}`);
    console.log(`   ✅ Within ${searchRadius}km: ${debugInfo.withinRadius}`);
    console.log(`\n🎯 Returning ${nearbyHelpers.length} nearby online helpers`);

    res.status(200).json({
      success: true,
      message: "Online helpers fetched from Redis",
      data: {
        searchLocation: {
          latitude: lat,
          longitude: lng,
          city: userAddress.city,
          state: userAddress.state,
        },
        radius: searchRadius,
        count: nearbyHelpers.length,
        helpers: nearbyHelpers,
        source: "redis",
      },
    });
  } catch (error) {
    console.error("❌ Get nearby helpers error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch nearby helpers",
      error: error.message,
    });
  }
};

const updateTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const helpseekerId = req.user.id;
    let updateData = { ...req.body };

    const task = await Task.findOne({ where: { id: taskId, helpseekerId } });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (task.status !== "draft") {
      return res.status(400).json({
        success: false,
        message: "Only draft tasks can be edited",
      });
    }

    // Parse location if it comes as string from form-data
    if (updateData.location && typeof updateData.location === 'string') {
      try {
        updateData.location = JSON.parse(updateData.location);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: "Invalid location format. Must be a valid JSON object",
        });
      }
    }


    // Parse steps if it comes as string from form-data
    if (updateData.steps && typeof updateData.steps === 'string') {
      try {
        updateData.steps = JSON.parse(updateData.steps);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: "Invalid steps format. Must be a valid JSON array",
        });
      }
    }

    // Validate steps structure if provided
    if (updateData.steps && Array.isArray(updateData.steps)) {
      for (let i = 0; i < updateData.steps.length; i++) {
        const step = updateData.steps[i];
        // Ensure default values for step
        step.order = step.order || i + 1;
        step.isCompleted = step.isCompleted !== undefined ? step.isCompleted : false;
        step.description = step.description || "";
        step.notes = step.notes || "";
        
        // If marking as completed and no completedAt timestamp, add it
        if (step.isCompleted && !step.completedAt) {
          step.completedAt = new Date().toISOString();
        }
        // If marking as not completed, remove completedAt
        if (!step.isCompleted) {
          step.completedAt = null;
        }
      }
    }

    // Validate location if provided
    if (updateData.locationRequired === 'true' || updateData.locationRequired === true) {
      if (!updateData.location) {
        return res.status(400).json({
          success: false,
          message: "Location is required for location-based tasks",
        });
      }

      // Validate location object structure
      if (!updateData.location.lat || !updateData.location.lng || !updateData.location.address) {
        return res.status(400).json({
          success: false,
          message: "Location must include latitude (lat), longitude (lng), and address",
        });
      }

      // Validate coordinates
      const lat = parseFloat(updateData.location.lat);
      const lng = parseFloat(updateData.location.lng);

      if (
        isNaN(lat) ||
        isNaN(lng) ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid location coordinates",
        });
      }

      // Normalize location data
      updateData.location.lat = lat;
      updateData.location.lng = lng;
    }

    // Validate budget if provided
    if (updateData.budget) {
      const taskBudget = parseFloat(updateData.budget);
      if (isNaN(taskBudget) || taskBudget <= 0) {
        return res.status(400).json({
          success: false,
          message: "Budget must be a positive number",
        });
      }
      updateData.budget = taskBudget;
    }

    // Handle new attachments from upload
    if (req.fileUrls && req.fileUrls.length > 0) {
      // Merge existing attachments with new ones
      const existingAttachments = task.attachments || [];
      updateData.attachments = [...existingAttachments, ...req.fileUrls];
    }

    await task.update(updateData);

    res.status(200).json({
      success: true,
      message: "Task updated successfully",
      data: task,
    });
  } catch (error) {
    console.error("Update task error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update task",
      error: error.message,
    });
  }
};

// Cancel task (Helpseeker)
const cancelTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const helpseekerId = req.user.id;

    const task = await Task.findOne({ where: { id: taskId, helpseekerId } });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (["completed", "cancelled"].includes(task.status)) {
      return res.status(400).json({
        success: false,
        message: "Cannot cancel completed or already cancelled task",
      });
    }

    // If task is assigned, notify helper
    if (task.assignedHelperId) {
      await createNotification({
        userId: task.assignedHelperId,
        userType: 'helper',
        taskId: task.id,
        title: "Task Cancelled",
        message: `Task "${task.title}" has been cancelled by the helpseeker`,
        type: "general",
        priority: "high",
      });
    }

    task.status = "cancelled";
    await task.save();

    // Remove from queue if exists
    await TaskQueue.destroy({ where: { taskId: task.id } });

    // Clean up Redis and notify all associated helpers
    try {
      // Get associated helpers before cleanup
      const associatedHelpersData = await redis.get(`task:${taskId}:associated_helpers`);
      let associatedHelperIds = [];
      
      if (associatedHelpersData) {
        associatedHelperIds = typeof associatedHelpersData === 'string' 
          ? JSON.parse(associatedHelpersData) 
          : associatedHelpersData;
      }
      
      console.log(`🧹 [CANCEL TASK] Task ${taskId} cancelled - notifying ${associatedHelperIds.length} associated helpers`);
      
      // Remove task from Redis
      await Promise.all([
        redis.del(`job:${taskId}`),
        redis.zrem('jobs:published', taskId),
        redis.del(`task:${taskId}:associated_helpers`),
        redis.del(`task:${taskId}:actions`),
      ]);
      
      // Remove task from each helper's associated tasks
      const cleanupPromises = associatedHelperIds.map(async (helperId) => {
        const helperTasksKey = `helper:${helperId}:associated_tasks`;
        const tasksData = await redis.get(helperTasksKey);
        if (tasksData) {
          const tasks = typeof tasksData === 'string' ? JSON.parse(tasksData) : tasksData;
          const updatedTasks = tasks.filter(id => id !== taskId);
          if (updatedTasks.length > 0) {
            await redis.setex(helperTasksKey, 43200, JSON.stringify(updatedTasks));
          } else {
            await redis.del(helperTasksKey);
          }
        }
      });
      await Promise.all(cleanupPromises);
      
      console.log(`✅ [CANCEL TASK] Redis cleanup completed for task ${taskId}`);
      
      // Emit socket event to all associated helpers
      const io = socketService.getIO();
      
      console.log(`🔍 [CANCEL TASK] Connected users map size: ${socketService.connectedUsers.size}`);
      console.log(`🔍 [CANCEL TASK] All connected users:`, 
        Array.from(socketService.connectedUsers.entries()).map(([sid, user]) => ({
          socketId: sid,
          userId: user.userId,
          userType: user.userType
        }))
      );
      
      for (const helperId of associatedHelperIds) {
        console.log(`🔍 [CANCEL TASK] Looking for helper ${helperId} in connected users...`);
        
        // Find helper's socket
        const helperSocketEntry = Array.from(socketService.connectedUsers.entries()).find(
          ([socketId, user]) => user.userId === helperId && user.userType === 'helper'
        );
        
        if (helperSocketEntry) {
          console.log(`✅ [CANCEL TASK] Found helper ${helperId} in connectedUsers with socketId: ${helperSocketEntry[0]}`);
          const socketId = helperSocketEntry[0];
          const socket = io.sockets.sockets.get(socketId);
          if (socket) {
            console.log(`✅ [CANCEL TASK] Socket object found for ${helperId}, emitting taskCancelled event...`);
            socket.emit('taskCancelled', {
              taskId: taskId,
              title: task.title,
              reason: 'cancelled_by_helpseeker',
            });
            console.log(`📤 [CANCEL TASK] Successfully emitted taskCancelled to helper ${helperId}`);
          } else {
            console.log(`❌ [CANCEL TASK] Socket object NOT found in io.sockets.sockets for socketId: ${socketId}`);
          }
        } else {
          console.log(`⚠️ [CANCEL TASK] Helper ${helperId} not found in connectedUsers map - they may be offline or disconnected`);
        }
      }
      
    } catch (cleanupError) {
      console.error(`⚠️ [CANCEL TASK] Redis cleanup failed:`, cleanupError.message);
    }

    res.status(200).json({
      success: true,
      message: "Task cancelled successfully",
      data: task,
    });
  } catch (error) {
    console.error("Cancel task error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to cancel task",
      error: error.message,
    });
  }
};

// Increase reward for task (Helpseeker)
const increaseReward = async (req, res) => {
  try {
    const { taskId } = req.params;
    const helpseekerId = req.user.id;
    const { additionalAmount } = req.body;

    if (!additionalAmount || additionalAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid additional amount",
      });
    }

    const task = await Task.findOne({ where: { id: taskId, helpseekerId } });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (task.status !== "in_queue") {
      return res.status(400).json({
        success: false,
        message: "Can only increase reward for tasks in queue",
      });
    }

    const oldBudget = task.budget;
    task.budget = parseFloat(task.budget) + parseFloat(additionalAmount);
    await task.save();

    console.log(`💰 [REWARD INCREASE] Task ${taskId} reward increased from ${oldBudget} to ${task.budget}`);

    // Clear all helper actions for this task (rejected/passed) to give everyone a fresh chance
    console.log(`🧹 [REWARD INCREASE] Clearing all helper actions for task ${taskId}`);
    await redis.del(`task:${taskId}:actions`);

    // Clear existing helper associations for this task
    console.log(`🧹 [REWARD INCREASE] Clearing existing helper associations for task ${taskId}`);
    const existingAssociatedHelpers = await redis.get(`task:${taskId}:associated_helpers`);
    if (existingAssociatedHelpers) {
      const helperIds = typeof existingAssociatedHelpers === 'string' 
        ? JSON.parse(existingAssociatedHelpers) 
        : existingAssociatedHelpers;
      
      // Remove task from each helper's associated tasks
      const cleanupPromises = helperIds.map(async (helperId) => {
        const helperTasksKey = `helper:${helperId}:associated_tasks`;
        const tasksData = await redis.get(helperTasksKey);
        if (tasksData) {
          const tasks = typeof tasksData === 'string' ? JSON.parse(tasksData) : tasksData;
          const updatedTasks = tasks.filter(id => id !== taskId);
          if (updatedTasks.length > 0) {
            await redis.setex(helperTasksKey, 43200, JSON.stringify(updatedTasks));
          } else {
            await redis.del(helperTasksKey);
          }
        }
      });
      await Promise.all(cleanupPromises);
    }
    await redis.del(`task:${taskId}:associated_helpers`);

    // Fetch helpseeker data for Redis
    const helpseeker = await Helpseeker.findByPk(helpseekerId);
    
    // Update Redis job data with new budget
    const jobData = {
      taskId: task.id,
      helpseekerId: helpseekerId,
      helpseekerName: helpseeker?.fullName || null,
      helpseekerRating: helpseeker?.averageRating || 0.0,
      title: task.title,
      description: task.description,
      category: task.category,
      budget: task.budget,
      estimatedDuration: task.estimatedDuration,
      priority: task.priority,
      locationRequired: task.locationRequired,
      location: task.location,
      status: task.status,
      steps: task.steps,
      publishedAt: new Date().toISOString(),
    };
    
    await redis.setex(`job:${task.id}`, 2592000, JSON.stringify(jobData));
    console.log(`✅ [REWARD INCREASE] Updated Redis job data with new budget`);

    // Re-run helper association logic (same as publish) in background
    const taskLocationForReward = task.location || (task.steps && task.steps[0] ? task.steps[0].location : null);
    const hasValidLocation = taskLocationForReward && taskLocationForReward.lat && taskLocationForReward.lng;
    
    if (hasValidLocation) {
      console.log(`🔄 [REWARD INCREASE] Starting fresh helper association for task ${taskId}`);
      
      // Capture location in closure
      const taskLat = taskLocationForReward.lat;
      const taskLng = taskLocationForReward.lng;
      
      setImmediate(async () => {
        try {
          const startTime = Date.now();
          
          // Get online helpers
          const onlineHelperIds = await redis.zrange('helpers:available', 0, -1);
          console.log(`🔗 [REWARD INCREASE] Found ${onlineHelperIds.length} online helpers`);
          
          if (onlineHelperIds.length > 0) {
            const helpersData = await Promise.all(
              onlineHelperIds.map(id => redis.get(`helper:online:${id}`))
            );
            
            const eligibleHelpers = [];
            
            // Get all helpers with addresses (no action filtering since we just cleared actions)
            for (const helperData of helpersData) {
              if (!helperData) continue;
              
              const helper = typeof helperData === 'string' ? JSON.parse(helperData) : helperData;
              const helperId = helper.id;
              
              const helperAddress = helper.addresses?.find(addr => addr.isDefault) || helper.addresses?.[0];
              if (helperAddress && helperAddress.latitude && helperAddress.longitude) {
                eligibleHelpers.push({
                  helperId: helperId,
                  latitude: helperAddress.latitude,
                  longitude: helperAddress.longitude
                });
              }
            }
            
            console.log(`🔗 [REWARD INCREASE] ${eligibleHelpers.length} eligible helpers for association`);
            
            if (eligibleHelpers.length > 0) {
              const apiKey = process.env.GOOGLE_MAPS_API_KEY;
              const axios = require('axios');
              const helpersWithDistance = [];
              
              if (apiKey) {
                // Check cache for distances
                const cacheCheckPromises = eligibleHelpers.map(async (helper) => {
                  const cached = await getCachedDistance(
                    helper.latitude,
                    helper.longitude,
                    taskLat,
                    taskLng
                  );
                  
                  if (cached && cached.distanceInMeters) {
                    const distanceInKm = cached.distanceInMeters / 1000;
                    if (distanceInKm <= 50) {
                      return {
                        helperId: helper.helperId,
                        distance: distanceInKm,
                        cached: true
                      };
                    }
                  }
                  
                  return {
                    helperId: helper.helperId,
                    helper: helper,
                    cached: false
                  };
                });
                
                const cacheResults = await Promise.all(cacheCheckPromises);
                const cachedHelpers = cacheResults.filter(r => r.cached);
                const uncachedHelpers = cacheResults
                  .filter(r => !r.cached)
                  .map(r => r.helper);
                
                helpersWithDistance.push(...cachedHelpers);
                console.log(`📊 [REWARD INCREASE] Cache hits: ${cachedHelpers.length}/${eligibleHelpers.length}`);
                
                // Call API for uncached helpers
                if (uncachedHelpers.length > 0) {
                  const batchSize = 25;
                  for (let i = 0; i < uncachedHelpers.length; i += batchSize) {
                    const batch = uncachedHelpers.slice(i, i + batchSize);
                    const originsStr = batch.map(h => `${h.latitude},${h.longitude}`).join('|');
                    
                    try {
                      const response = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
                        params: {
                          origins: originsStr,
                          destinations: `${taskLat},${taskLng}`,
                          key: apiKey,
                          units: 'metric',
                        },
                        timeout: 5000,
                      });
                      
                      if (response.data.status === 'OK') {
                        const distancesToCache = [];
                        
                        response.data.rows.forEach((row, index) => {
                          if (row.elements[0] && row.elements[0].status === 'OK') {
                            const distanceInKm = row.elements[0].distance.value / 1000;
                            
                            distancesToCache.push({
                              originLat: batch[index].latitude,
                              originLng: batch[index].longitude,
                              destLat: taskLat,
                              destLng: taskLng,
                              distanceData: {
                                distanceInMeters: row.elements[0].distance.value,
                                durationInSeconds: row.elements[0].duration.value,
                                distanceText: row.elements[0].distance.text,
                                durationText: row.elements[0].duration.text
                              }
                            });
                            
                            if (distanceInKm <= 50) {
                              helpersWithDistance.push({
                                helperId: batch[index].helperId,
                                distance: distanceInKm
                              });
                            }
                          }
                        });
                        
                        if (distancesToCache.length > 0) {
                          batchCacheDistances(distancesToCache).catch(err => 
                            console.error('Failed to cache distances:', err)
                          );
                        }
                      }
                    } catch (error) {
                      console.warn(`⚠️ Batch distance calculation failed:`, error.message);
                    }
                  }
                }
              }
              
              console.log(`🔗 [REWARD INCREASE] ${helpersWithDistance.length} helpers within 50km`);
              
              if (helpersWithDistance.length > 0) {
                // Sort by distance and associate with closest helper
                helpersWithDistance.sort((a, b) => a.distance - b.distance);
                const closestHelper = helpersWithDistance[0];
                
                await redis.setex(
                  `task:${task.id}:associated_helpers`,
                  2592000,
                  JSON.stringify([closestHelper.helperId])
                );
                
                const helperTasksKey = `helper:${closestHelper.helperId}:associated_tasks`;
                const existingTasks = await redis.get(helperTasksKey);
                let taskIds = existingTasks 
                  ? (typeof existingTasks === 'string' ? JSON.parse(existingTasks) : existingTasks)
                  : [];
                
                if (!taskIds.includes(task.id)) {
                  taskIds.push(task.id);
                  await redis.setex(helperTasksKey, 43200, JSON.stringify(taskIds));
                }
                
                console.log(`✅ [REWARD INCREASE] Task ${task.id} re-associated with helper ${closestHelper.helperId} (${closestHelper.distance.toFixed(2)}km)`);
                console.log(`⏱️ [REWARD INCREASE] Total reassociation time: ${Date.now() - startTime}ms`);
                
                // Broadcast to helpers via socket
                try {
                  await socketService.broadcastNewJobToSearchingHelpers(jobData);
                  console.log(`📡 [REWARD INCREASE] Broadcasted updated job to helpers`);
                } catch (socketError) {
                  console.error(`⚠️ [REWARD INCREASE] Failed to broadcast job:`, socketError.message);
                }
                
                // Also notify the associated helper specifically about reward increase
                try {
                  const io = socketService.getIO();
                  const helperSocketEntry = Array.from(socketService.connectedUsers.entries()).find(
                    ([socketId, user]) => user.userId === closestHelper.helperId && user.userType === 'helper'
                  );
                  
                  if (helperSocketEntry) {
                    const socketId = helperSocketEntry[0];
                    const socket = io.sockets.sockets.get(socketId);
                    if (socket) {
                      socket.emit('taskRewardIncreased', {
                        taskId: task.id,
                        oldBudget: parseFloat(oldBudget),
                        newBudget: parseFloat(task.budget),
                        increase: parseFloat(task.budget) - parseFloat(oldBudget),
                        title: task.title,
                      });
                      console.log(`💰 [REWARD INCREASE] Notified helper ${closestHelper.helperId} via socket about reward increase`);
                    }
                  }
                } catch (notifyError) {
                  console.error(`⚠️ [REWARD INCREASE] Failed to notify helper via socket:`, notifyError.message);
                }
              }
            }
          }
        } catch (error) {
          console.error(`⚠️ [REWARD INCREASE] Helper reassociation failed:`, error.message);
        }
      });
    } else {
      // For non-location tasks, send notifications to all approved helpers
      setImmediate(async () => {
        try {
          const helpers = await Helper.findAll({
            where: { verificationStatus: "approved", isApproved: true },
          });

          const notifications = helpers.map((helper) => ({
            helperId: helper.id,
            userType: 'helper',
            taskId: task.id,
            title: "Task Reward Increased",
            message: `Reward increased from $${oldBudget} to $${task.budget} for "${task.title}". Check it out again!`,
            type: "general",
            priority: "high",
          }));

          await Notification.bulkCreate(notifications);
          console.log(`✅ [REWARD INCREASE] Sent notifications to ${helpers.length} helpers`);
        } catch (notifError) {
          console.error(`⚠️ [REWARD INCREASE] Failed to send notifications:`, notifError.message);
        }
      });
    }

    res.status(200).json({
      success: true,
      message: "Task reward increased successfully. All helpers can now see this task again.",
      data: {
        task,
        oldBudget,
        newBudget: task.budget,
        actionsCleared: true,
        reassociationStarted: true,
      },
    });
  } catch (error) {
    console.error("Increase reward error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to increase reward",
      error: error.message,
    });
  }
};



// Regenerate OTP for task (Helpseeker)
const regenerateOTP = async (req, res) => {
  try {
    const helpseekerId = req.user.id;
    const { taskId } = req.params;
    
    const task = await Task.findOne({ where: { id: taskId, helpseekerId } });    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (task.status !== "assigned") {
      return res.status(400).json({
        success: false,
        message: "OTP can only be regenerated for assigned tasks",
      });
    }

    if (task.isOtpVerified) {
      return res.status(400).json({
        success: false,
        message: "Task is already in progress. OTP already verified.",
      });
    }

    // Generate new OTP
    const newOtp = generateOTP();
    task.verificationOtp = newOtp;
    task.otpGeneratedAt = new Date();
    await task.save();

    // Get helper details
    const helper = await Helper.findByPk(task.assignedHelperId, {
      attributes: ["id", "fullName"],
    });

    // Notify helpseeker
    await createNotification({
      userId: helpseekerId,
      userType: 'helpseeker',
      taskId: task.id,
      title: "New OTP Generated",
      message: `New verification OTP for "${task.title}" is: ${newOtp}. Share this with ${helper.fullName}.`,
      type: "otp_regenerated",
      priority: "high",
    });

    // Notify helper
    await createNotification({
      userId: task.assignedHelperId,
      userType: 'helper',
      taskId: task.id,
      title: "New OTP Generated",
      message: `A new OTP has been generated for "${task.title}". Please ask the helpseeker for the updated OTP.`,
      type: "otp_regenerated",
      priority: "medium",
    });

    res.status(200).json({
      success: true,
      message: "New OTP generated successfully",
      data: {
        otp: newOtp,
        taskId: task.id,
        otpGeneratedAt: task.otpGeneratedAt,
        expiresIn: "24 hours",
      },
    });
  } catch (error) {
    console.error("Regenerate OTP error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to regenerate OTP",
      error: error.message,
    });
  }
};

// Get task rejections with reasons and suggested minimum prices (Helpseeker)
const getTaskRejections = async (req, res) => {
  try {
    const helpseekerId = req.user.id;
    const { taskId } = req.params;

    // Verify task exists and belongs to the helpseeker
    const task = await Task.findByPk(taskId, {
      attributes: ['id', 'title', 'description', 'budget', 'status', 'helpseekerId'],
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (task.helpseekerId !== helpseekerId) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to view rejections for this task",
      });
    }

    // Fetch all rejections for this task
    const TaskRejection = require("../../models/taskRejectionModel/taskRejectionModel");
    const rejections = await TaskRejection.findAll({
      where: { taskId },
      include: [
        {
          model: Helper,
          as: "helper",
          attributes: ["id", "fullName", "averageRating"],
        },
      ],
      order: [["rejectedAt", "DESC"]],
    });

    if (rejections.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No rejections found for this task",
        data: {
          taskId,
          taskTitle: task.title,
          currentBudget: task.budget,
          totalRejections: 0,
          rejections: [],
          priceAnalysis: null,
          suggestions: [],
        },
      });
    }

    // Categorize rejections by reason
    const rejectionsByCategory = {
      price: [],
      distance: [],
      availability: [],
      skills: [],
      other: [],
    };

    rejections.forEach((rejection) => {
      const category = rejection.reasonCategory || 'other';
      rejectionsByCategory[category].push({
        helperId: rejection.helperId,
        helperName: rejection.helper?.fullName || 'Unknown',
        helperRating: rejection.helper?.averageRating || null,
        reason: rejection.reason,
        minPrice: rejection.minPrice,
        rejectedAt: rejection.rejectedAt,
      });
    });

    // Analyze price-based rejections
    let priceAnalysis = null;
    const priceRejections = rejectionsByCategory.price.filter(r => r.minPrice !== null);
    
    if (priceRejections.length > 0) {
      const minPrices = priceRejections.map(r => parseFloat(r.minPrice));
      const minOfMin = Math.min(...minPrices);
      const maxOfMin = Math.max(...minPrices);
      const avgOfMin = minPrices.reduce((sum, price) => sum + price, 0) / minPrices.length;

      priceAnalysis = {
        totalPriceRejections: priceRejections.length,
        currentBudget: parseFloat(task.budget),
        suggestedMinimumPrice: minOfMin,
        suggestedMaximumPrice: maxOfMin,
        averageSuggestedPrice: Math.round(avgOfMin * 100) / 100,
        priceRange: {
          lowest: minOfMin,
          highest: maxOfMin,
        },
        allSuggestedPrices: minPrices.sort((a, b) => a - b),
      };
    }

    // Generate suggestions
    const suggestions = [];
    
    if (priceRejections.length > 0 && priceAnalysis) {
      const currentBudget = parseFloat(task.budget);
      const suggestedPrice = priceAnalysis.averageSuggestedPrice;
      const increaseAmount = suggestedPrice - currentBudget;
      const increasePercent = Math.round((increaseAmount / currentBudget) * 100);

      suggestions.push({
        type: "price",
        priority: "high",
        message: `${priceRejections.length} helper(s) rejected due to low budget. Consider increasing budget to ₹${suggestedPrice} (${increasePercent}% increase).`,
        actionable: true,
        suggestedBudget: suggestedPrice,
      });
    }

    if (rejectionsByCategory.distance.length > 0) {
      suggestions.push({
        type: "distance",
        priority: "medium",
        message: `${rejectionsByCategory.distance.length} helper(s) rejected due to distance. Consider expanding your search radius or offering travel compensation.`,
        actionable: true,
      });
    }

    if (rejectionsByCategory.availability.length > 0) {
      suggestions.push({
        type: "availability",
        priority: "medium",
        message: `${rejectionsByCategory.availability.length} helper(s) were unavailable. Consider adjusting your timeline or scheduling flexibility.`,
        actionable: true,
      });
    }

    if (rejectionsByCategory.skills.length > 0) {
      suggestions.push({
        type: "skills",
        priority: "low",
        message: `${rejectionsByCategory.skills.length} helper(s) rejected due to skill mismatch. Your task requirements might be too specific.`,
        actionable: false,
      });
    }

    res.status(200).json({
      success: true,
      message: "Task rejections retrieved successfully",
      data: {
        taskId,
        taskTitle: task.title,
        currentBudget: task.budget,
        totalRejections: rejections.length,
        rejectionsByCategory: {
          price: rejectionsByCategory.price.length,
          distance: rejectionsByCategory.distance.length,
          availability: rejectionsByCategory.availability.length,
          skills: rejectionsByCategory.skills.length,
          other: rejectionsByCategory.other.length,
        },
        rejections: rejectionsByCategory,
        priceAnalysis,
        suggestions,
      },
    });
  } catch (error) {
    console.error("Get task rejections error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve task rejections",
      error: error.message,
    });
  }
};



module.exports = {
  createTask,
  publishTask,
  scheduleTaskPublish,
  cancelScheduledPublish,
  getMyTasks,
  getTaskById,
  getNearbyHelpers,
  updateTask,
  cancelTask,
  increaseReward,
  regenerateOTP,
  getGoogleMapsDistances,
  getTaskRejections,

};
