const Task = require("../../models/taskModel/taskModel");
const TaskQueue = require("../../models/queueModel/queueModel");
const Notification = require("../../models/notificationModel/notificationModel");
const Helper = require("../../models/authModel/helperModel");
const Helpseeker = require("../../models/authModel/helpseekerModel");
const Address = require("../../models/addressModel/addressModel");
const axios = require("axios");
const jobMatchingService = require("../../services/jobMatchingService");
const redis = require("../../config/redis/redis");
const { createNotification } = require("../../services/notificationService");


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

// Helper function to calculate distance using Google Maps Distance Matrix API
const calculateDistanceWithGoogle = async (origin, destination) => {
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    
    if (!apiKey) {
      console.error("❌ Google Maps API key not found in environment");
      return null;
    }

    const url = `https://maps.googleapis.com/maps/api/distancematrix/json`;
    console.log(`      🌐 API Request: ${url}`);
    console.log(`      📍 Origin: ${origin.lat},${origin.lng}`);
    console.log(`      📍 Destination: ${destination.lat},${destination.lng}`);
    
    const response = await axios.get(url, {
      params: {
        origins: `${origin.lat},${origin.lng}`,
        destinations: `${destination.lat},${destination.lng}`,
        key: apiKey,
        units: 'metric',
      },
    });

    console.log(`      📡 API Response Status: ${response.data.status}`);
    
    if (response.data.status !== 'OK') {
      console.error(`      ❌ API returned status: ${response.data.status}`);
      if (response.data.error_message) {
        console.error(`      ❌ Error message: ${response.data.error_message}`);
      }
      console.error(`      📄 Full response:`, JSON.stringify(response.data));
      return null;
    }
    
    const element = response.data.rows[0]?.elements[0];
    if (!element) {
      console.error(`      ❌ No route elements in response`);
      return null;
    }
    
    console.log(`      📡 Element Status: ${element.status}`);
    
    if (element.status !== 'OK') {
      console.error(`      ❌ Element status: ${element.status}`);
      return null;
    }
    
    const distanceInMeters = element.distance.value;
    const distanceInKm = distanceInMeters / 1000;
    const durationInSeconds = element.duration.value;
    
    return {
      distance: distanceInKm,
      duration: durationInSeconds,
      distanceText: element.distance.text,
      durationText: element.duration.text,
    };
  } catch (error) {
    console.error(`      ❌ Google Distance Matrix API error: ${error.message}`);
    if (error.response) {
      console.error(`      📡 Response status: ${error.response.status}`);
      console.error(`      📄 Response data:`, JSON.stringify(error.response.data));
    }
    console.error(`      📚 Stack:`, error.stack);
    return null;
  }
};

// Helper function to find the nearest available helper and associate with task
const associateHelpersWithTask = async (taskId, taskLocation, searchRadius = 50) => {
  try {
    console.log('\n========================================');
    console.log('🔗 STARTING HELPER ASSOCIATION');
    console.log('========================================');
    console.log(`📍 Task ID: ${taskId}`);
    console.log(`📍 Task Location: lat=${taskLocation.lat}, lng=${taskLocation.lng}`);
    console.log(`📍 Search Radius: ${searchRadius}km`);
    console.log('----------------------------------------');
    
    // Get all online helpers from Redis
    console.log('🔍 Step 1: Searching for online helpers in Redis...');
    const onlineHelperKeys = await redis.keys('helper:online:*');
    console.log(`   Found ${onlineHelperKeys ? onlineHelperKeys.length : 0} helper key(s)`);
    
    if (!onlineHelperKeys || onlineHelperKeys.length === 0) {
      console.log('❌ RESULT: No online helpers found in Redis');
      console.log('========================================\n');
      return [];
    }
    
    console.log('🔍 Step 2: Fetching helper data from Redis...');
    const helperPromises = onlineHelperKeys.map(key => redis.get(key));
    const helpersData = await Promise.all(helperPromises);
    
    const helpers = helpersData
      .filter(data => data !== null)
      .map(data => typeof data === 'string' ? JSON.parse(data) : data);
    
    console.log(`   Retrieved ${helpers.length} helper profile(s)`);
    
    // Prepare helper locations for batch API call
    const helperLocations = [];
    const validHelpers = [];
    
    for (let i = 0; i < helpers.length; i++) {
      const helper = helpers[i];
      console.log(`\n   📌 Helper ${i + 1}/${helpers.length}: ${helper.id}`);
      console.log(`      Name: ${helper.fullName || 'N/A'}`);
      
      const address = helper.addresses?.find(addr => addr.isDefault) || helper.addresses?.[0];
      
      if (!address || !address.latitude || !address.longitude) {
        console.log(`      ⚠️ No valid address - SKIPPED`);
        continue;
      }
      
      console.log(`      Location: lat=${address.latitude}, lng=${address.longitude}`);
      helperLocations.push({ lat: parseFloat(address.latitude), lng: parseFloat(address.longitude) });
      validHelpers.push(helper);
    }
    
    if (validHelpers.length === 0) {
      console.log('\n❌ RESULT: No helpers with valid addresses');
      console.log('========================================\n');
      return [];
    }
    
    // Calculate distances using Google Maps API (batch call)
    console.log('\n🔍 Step 3: Calculating distances using Google Maps API...');
    console.log(`   Batch request for ${validHelpers.length} helper(s)`);
    
    const googleDistances = await getGoogleMapsDistances(
      { lat: taskLocation.lat, lng: taskLocation.lng },
      helperLocations
    );
    
    if (!googleDistances) {
      console.log('   ❌ Google Maps API call failed - falling back to Haversine');
    } else {
      console.log(`   ✓ Received ${googleDistances.length} distance result(s)`);
    }
    
    const helpersWithDistance = [];
    
    for (let i = 0; i < validHelpers.length; i++) {
      const helper = validHelpers[i];
      const address = helper.addresses?.find(addr => addr.isDefault) || helper.addresses?.[0];
      
      let distance, duration;
      
      if (googleDistances && googleDistances[i] && googleDistances[i].status === 'OK') {
        distance = googleDistances[i].distance;
        duration = googleDistances[i].duration;
        
        const distanceText = distance < 1 ? `${Math.round(distance * 1000)} m` : `${distance.toFixed(1)} km`;
        const durationText = duration < 60 ? `${Math.round(duration)} mins` : `${Math.floor(duration / 60)} hr ${Math.round(duration % 60)} mins`;
        
        console.log(`\n   ✓ Helper: ${helper.fullName || helper.id}`);
        console.log(`      🚗 Road Distance: ${distanceText}`);
        console.log(`      ⏱️  Travel Time: ${durationText}`);
        
        if (distance <= searchRadius) {
          console.log(`      ✓ Within ${searchRadius}km radius - INCLUDED`);
          helpersWithDistance.push({
            helperId: helper.id,
            helperName: helper.fullName,
            distance: distance,
            duration: duration * 60, // Convert minutes to seconds
            distanceText: distanceText,
            durationText: durationText,
          });
        } else {
          console.log(`      ✗ Beyond ${searchRadius}km radius - EXCLUDED`);
        }
      } else {
        // Fallback to Haversine
        distance = calculateDistance(taskLocation.lat, taskLocation.lng, address.latitude, address.longitude);
        console.log(`\n   ⚠️ Helper: ${helper.fullName || helper.id}`);
        console.log(`      📏 Straight-line Distance: ${distance.toFixed(2)} km (Haversine fallback)`);
        
        if (distance <= searchRadius) {
          console.log(`      ✓ Within ${searchRadius}km radius - INCLUDED`);
          helpersWithDistance.push({
            helperId: helper.id,
            helperName: helper.fullName,
            distance: distance,
            duration: null,
            distanceText: `${distance.toFixed(1)} km`,
            durationText: 'N/A',
          });
        } else {
          console.log(`      ✗ Beyond ${searchRadius}km radius - EXCLUDED`);
        }
      }
    }
    
    console.log('\n----------------------------------------');
    console.log('🔍 Step 4: Selecting nearest helper...');
    
    if (helpersWithDistance.length === 0) {
      console.log(`❌ RESULT: No helpers found within ${searchRadius}km for task ${taskId}`);
      console.log('========================================\n');
      return [];
    }
    
    console.log(`   Found ${helpersWithDistance.length} helper(s) within radius`);
    
    // Sort by distance and take only the nearest helper
    helpersWithDistance.sort((a, b) => a.distance - b.distance);
    const nearestHelper = helpersWithDistance[0];
    
    console.log(`   🎯 NEAREST HELPER SELECTED:`);
    console.log(`      ID: ${nearestHelper.helperId}`);
    console.log(`      Name: ${nearestHelper.helperName || 'N/A'}`);
    console.log(`      Distance: ${nearestHelper.distanceText}`);
    console.log(`      ETA: ${nearestHelper.durationText}`);
    
    // Store association in Redis (only 1 helper)
    console.log('\n🔍 Step 5: Creating bidirectional associations in Redis...');
    const associationKey = `task:${taskId}:associated_helpers`;
    const helperIds = [nearestHelper.helperId];
    
    console.log(`   Setting key: ${associationKey}`);
    await redis.setex(associationKey, 2592000, JSON.stringify(helperIds)); // 30 days
    console.log(`   ✓ Stored helper [${nearestHelper.helperId}] for task [${taskId}]`);
    
    // Create reverse mapping (helper -> tasks)
    const helperTasksKey = `helper:${nearestHelper.helperId}:associated_tasks`;
    const existingTasksData = await redis.get(helperTasksKey);
    
    // Handle both string and object responses from Upstash Redis
    let tasksList = [];
    if (existingTasksData) {
      if (typeof existingTasksData === 'string') {
        try {
          tasksList = JSON.parse(existingTasksData);
        } catch (parseError) {
          console.error(`   ⚠️ Failed to parse existing tasks, starting fresh:`, parseError.message);
          tasksList = [];
        }
      } else if (Array.isArray(existingTasksData)) {
        tasksList = existingTasksData;
      } else {
        console.error(`   ⚠️ Unexpected data type, starting fresh`);
        tasksList = [];
      }
    }
    
    console.log(`   Current tasks for helper: ${tasksList.length}`);
    
    if (!tasksList.includes(taskId)) {
      tasksList.push(taskId);
      console.log(`   Setting key: ${helperTasksKey}`);
      await redis.setex(helperTasksKey, 43200, JSON.stringify(tasksList)); // 12 hours
      console.log(`   ✓ Added task [${taskId}] to helper's task list`);
    } else {
      console.log(`   ℹ️ Task already in helper's list`);
    }
    
    console.log('\n✅ ASSOCIATION SUCCESSFUL!');
    console.log('========================================\n');
    
    return [{
      helperId: nearestHelper.helperId,
      helperName: nearestHelper.helperName,
      distance: nearestHelper.distance,
      distanceText: nearestHelper.distanceText,
      duration: nearestHelper.duration,
      durationText: nearestHelper.durationText,
    }];
  } catch (error) {
    console.error('\n❌ ERROR IN ASSOCIATION PROCESS:');
    console.error('   Error:', error.message);
    console.error('   Stack:', error.stack);
    console.log('========================================\n');
    return [];
  }
};

const publishTask = async (req, res) => {
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

    if (task.status !== "draft") {
      return res.status(400).json({
        success: false,
        message: "Only draft tasks can be published",
      });
    }

    task.status = "in_queue";
    await task.save();

    const queueCount = await TaskQueue.count();

    // Add to queue
    const queueEntry = await TaskQueue.create({
      taskId: task.id,
      queuePosition: queueCount + 1,
      priority: task.priority === "urgent" ? 10 : task.priority === "high" ? 5 : 0,
    });

    // Store the published job in Redis
    try {
      const jobData = {
        taskId: task.id,
        helpseekerId: helpseekerId,
        title: task.title,
        description: task.description,
        category: task.category,
        budget: task.budget,
        estimatedDuration: task.estimatedDuration,
        priority: task.priority,
        locationRequired: task.locationRequired,
        location: task.location,
        status: task.status,
        queuePosition: queueEntry.queuePosition,
        steps : task.steps,
        publishedAt: new Date().toISOString(),
      };
      
   
      await redis.setex(`job:${task.id}`, 2592000, JSON.stringify(jobData));
      
      await redis.zadd('jobs:published', {
        score: Date.now(),
        member: `job:${task.id}`,
      });
      
      console.log(`✅ Job ${task.id} stored in Redis successfully`);
      
      // Associate nearest available helper with this task
      console.log(`\n🔄 Checking if task has location for helper association...`);
      const taskLocation = task.location || (task.steps && task.steps[0] ? task.steps[0].location : null);
      
      if (!taskLocation) {
        console.log(`⚠️ Task ${task.id} has NO location data`);
        console.log(`   task.location: ${task.location}`);
        console.log(`   task.steps: ${task.steps ? 'exists' : 'null'}`);
        if (task.steps && task.steps.length > 0) {
          console.log(`   steps[0]: ${JSON.stringify(task.steps[0])}`);
        }
      } else if (!taskLocation.lat || !taskLocation.lng) {
        console.log(`⚠️ Task ${task.id} location missing lat/lng`);
        console.log(`   Location data:`, taskLocation);
      } else {
        console.log(`✓ Task ${task.id} has valid location`);
        console.log(`   Using location: lat=${taskLocation.lat}, lng=${taskLocation.lng}`);
        console.log(`   Address: ${taskLocation.address || 'N/A'}`);
        
        const associatedHelpers = await associateHelpersWithTask(task.id, taskLocation);
        
        if (associatedHelpers.length > 0) {
          console.log(`\n✅ FINAL RESULT: Task associated with ${associatedHelpers.length} helper`);
          console.log(`   Helper: ${associatedHelpers[0].helperName || associatedHelpers[0].helperId}`);
          console.log(`   Distance: ${associatedHelpers[0].distanceText}`);
          console.log(`   ETA: ${associatedHelpers[0].durationText}`);
        } else {
          console.log(`\n⚠️ FINAL RESULT: No helpers associated with task ${task.id}`);
        }
      }
    } catch (redisError) {
      console.error(`⚠️ Failed to store job in Redis:`, redisError);
      // Continue execution even if Redis fails
    }

    if (task.locationRequired && task.location && task.location.lat && task.location.lng) {
      // Trigger job matching service asynchronously (non-blocking)
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
    } else {
      // For non-location tasks, notify all approved helpers (fallback)
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
    }

    res.status(200).json({
      success: true,
      message: "Task published to queue successfully",
      data: { task, queuePosition: queueEntry.queuePosition },
    });
  } catch (error) {
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
    const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    
    if (!GOOGLE_MAPS_API_KEY) {
      console.warn("⚠️ Google Maps API key not found, falling back to Haversine formula");
      return null;
    }

    // Format origin and destinations for API
    const originStr = `${origin.lat},${origin.lng}`;
    const destinationsStr = destinations
      .map((dest) => `${dest.lat},${dest.lng}`)
      .join("|");

    const url = `https://maps.googleapis.com/maps/api/distancematrix/json`;
    
    const response = await axios.get(url, {
      params: {
        origins: originStr,
        destinations: destinationsStr,
        key: GOOGLE_MAPS_API_KEY,
        mode: "driving", // or "walking", "bicycling", "transit"
        units: "metric",
      },
    });

    if (response.data.status !== "OK") {
      console.warn(`⚠️ Google Maps API returned status: ${response.data.status}`);
      if (response.data.error_message) {
        console.warn(`⚠️ Error message: ${response.data.error_message}`);
      }
      console.warn(`⚠️ Full response:`, JSON.stringify(response.data));
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
      redis.get(`helper:online:${helperId}`)
    );
    
    const helperDataResults = await Promise.all(helperDataPromises);
    const onlineHelpers = helperDataResults
      .filter(data => data !== null)
      .map(data => {
        // Upstash Redis returns objects directly if they were stored as JSON strings
        // If it's already an object, return it; if it's a string, parse it
        if (typeof data === 'string') {
          return JSON.parse(data);
        }
        return data;
      });

    console.log(`✅ Retrieved ${onlineHelpers.length} helper profiles from Redis`);

    // Step 3: Calculate distances and filter by radius
    console.log("\n📏 Step 3: Calculating distances and filtering by radius...");
    
    const helperLocations = [];
    const helperData = [];

    for (const helper of onlineHelpers) {
      // Get default address or first available address
      const address = helper.addresses?.find(addr => addr.isDefault) || helper.addresses?.[0];
      
      if (!address || !address.latitude || !address.longitude) {
        console.log(`⚠️  Helper ${helper.fullName} has no valid address, skipping`);
        continue;
      }

      const helperLat = parseFloat(address.latitude);
      const helperLng = parseFloat(address.longitude);

      if (isNaN(helperLat) || isNaN(helperLng)) {
        console.log(`⚠️  Helper ${helper.fullName} has invalid coordinates, skipping`);
        continue;
      }

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

    // Remove from Redis cache when cancelled
    try {
      await redis.del(`job:${task.id}`);
      await redis.zrem('jobs:published', `job:${task.id}`);
      console.log(`✅ Cancelled task ${task.id} removed from Redis`);
    } catch (redisError) {
      console.warn(`⚠️ Failed to remove cancelled task from Redis:`, redisError.message);
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

    // Notify helpers about increased reward
    const helpers = await Helper.findAll({
      where: { verificationStatus: "approved", isApproved: true },
    });

    const notifications = helpers.map((helper) => ({
      helperId: helper.id,
      userType: 'helper',
      taskId: task.id,
      title: "Task Reward Increased",
      message: `Reward increased from $${oldBudget} to $${task.budget} for "${task.title}"`,
      type: "general",
      priority: "medium",
    }));

    await Notification.bulkCreate(notifications);

    res.status(200).json({
      success: true,
      message: "Task reward increased successfully",
      data: task,
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

};
