const Task = require("../../models/taskModel/taskModel");
const TaskQueue = require("../../models/queueModel/queueModel");
const Notification = require("../../models/notificationModel/notificationModel");
const Helper = require("../../models/authModel/helperModel");
const Helpseeker = require("../../models/authModel/helpseekerModel");
const Address = require("../../models/addressModel/addressModel");


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

    // Notify available helpers
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

    const scheduledDate = new Date(scheduledPublishAt);
    const currentDate = new Date();

    // Validate that scheduled date is in the future
    if (scheduledDate <= currentDate) {
      return res.status(400).json({
        success: false,
        message: "Scheduled publish time must be in the future",
      });
    }

    // Update task with schedule information
    task.scheduledPublishAt = scheduledDate;
    task.isScheduled = true;
    await task.save();

    res.status(200).json({
      success: true,
      message: "Task scheduled for publishing successfully",
      data: {
        task: {
          id: task.id,
          title: task.title,
          status: task.status,
          isScheduled: task.isScheduled,
          scheduledPublishAt: task.scheduledPublishAt,
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

// Get nearby helpers within radius (Helpseeker)
const getNearbyHelpers = async (req, res) => {
  try {
    const helpseekerId = req.user.id;
    const radius = process.env.TASK_SEARCH_RADIUS;

    console.log("Searching for helpers near helpseeker:", helpseekerId);

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

    console.log(" Search filters:");
    console.log(`   Radius: ${searchRadius} km`);
    console.log("\n Step 1: Checking total helpers in database...");

    // First, check how many helpers exist at all
    const totalHelpers = await Helper.count({ where: { verificationStatus: "approved" } });
    console.log(`   Total approved helpers: ${totalHelpers}`);

    // Check how many have addresses
    const helpersWithAddresses = await Helper.count({
      where: { verificationStatus: "approved" },
      include: [
        {
          model: Address,
          as: "addresses",
          required: true,
          where: {
            userType: 'helper',
            latitude: { [require("sequelize").Op.ne]: null },
            longitude: { [require("sequelize").Op.ne]: null },
          },
        },
      ],
    });
    console.log(`   Helpers with valid addresses: ${helpersWithAddresses}`);

    // Note: Helper profiles are now integrated into Helper model
    const helpersWithProfiles = totalHelpers;
    console.log(`   Helpers with profiles: ${helpersWithProfiles} (all approved helpers have profiles)`);
    console.log(`   Helpers with profiles: ${helpersWithProfiles}`);

    console.log("\n Step 2: Querying helpers with BOTH address AND profile...");

    // Get all helpers with their addresses (profiles are now part of Helper model)
    const helpers = await Helper.findAll({
      where: {
        verificationStatus: "approved",
        isApproved: true,
      },
      attributes: ["id", "fullName"],
      include: [
        {
          model: Address,
          as: "addresses",
          where: {
            userType: 'helper',
            latitude: {
              [require("sequelize").Op.ne]: null,
            },
            longitude: {
              [require("sequelize").Op.ne]: null,
            },
          },
          required: true,
          attributes: ["latitude", "longitude", "city", "state", "type", "isDefault"],
        },
      ],
    });

    console.log(`📍 Found ${helpers.length} helpers with BOTH address AND profile`);
    
    if (helpers.length === 0 && totalHelpers > 0) {
      console.log("\n ISSUE IDENTIFIED:");
      if (helpersWithAddresses === 0) {
        console.log("   Problem: Helpers exist but NONE have addresses with coordinates");
        console.log("   Solution: Add addresses to helper users");
      } else if (helpersWithProfiles === 0) {
        console.log("   Problem: Helpers exist but NONE have helper profiles");
        console.log("   Solution: Create helper_profiles for helper users");
      } else {
        console.log("   Problem: Helpers have addresses OR profiles, but not BOTH");
        console.log("   Solution: Ensure each helper has BOTH address AND profile");
      }
    }

    // Debug: Log all helpers found
    if (helpers.length === 0) {
      console.log(" No helpers found in database with addresses and profiles");
      console.log(" Possible reasons:");
      console.log("   1. No users with role='helper'");
      console.log("   2. Helpers don't have addresses with lat/lng");
      console.log("   3. Helpers don't have helper profiles");
    } else {
      console.log(`🔍 Processing ${helpers.length} helpers...`);
    }

    // Filter helpers within radius and format response
    const nearbyHelpers = [];
    const debugInfo = {
      totalHelpers: helpers.length,
      processedHelpers: 0,
      skippedNoAddress: 0,
      skippedInvalidCoords: 0,
      skippedOutOfRadius: 0,
      skippedNotAvailable: 0,
      withinRadius: 0
    };

    for (const helper of helpers) {
      debugInfo.processedHelpers++;
      
      // Get default address or first available address
      const address = helper.addresses.find((addr) => addr.isDefault) || helper.addresses[0];
      
      if (!address) {
        debugInfo.skippedNoAddress++;
        console.log(`⚠️ Helper ${helper.fullName} (${helper.id}): No address found`);
        continue;
      }

      const helperLat = parseFloat(address.latitude);
      const helperLng = parseFloat(address.longitude);

      if (isNaN(helperLat) || isNaN(helperLng)) {
        debugInfo.skippedInvalidCoords++;
        console.log(` Helper ${helper.fullName} (${helper.id}): Invalid coordinates (${address.latitude}, ${address.longitude})`);
        continue;
      }

      // Calculate distance
      const distance = calculateDistance(lat, lng, helperLat, helperLng);
      
      console.log(` Helper ${helper.fullName}:`);
      console.log(`   Location: (${helperLat}, ${helperLng}) - ${address.city}`);
      console.log(`   Distance: ${distance.toFixed(2)} km`);
      console.log(`   Available: ${helper.isApproved}`);
      console.log(`   Skills: ${JSON.stringify(helper.skills || [])}`);

      // Check if within radius
      if (distance > searchRadius) {
        debugInfo.skippedOutOfRadius++;
        console.log(`    Outside radius (${distance.toFixed(2)} km > ${searchRadius} km)`);
        continue;
      }

      // Check if available (already filtered in query, but double-check)
      if (!helper.isApproved) {
        debugInfo.skippedNotAvailable++;
        console.log(`    Helper not available`);
        continue;
      }

      debugInfo.withinRadius++;
      console.log(`    Added to results!`);

      nearbyHelpers.push({
        id: helper.id,
        fullName: helper.fullName,
        location: {
          latitude: helperLat,
          longitude: helperLng,
          city: address.city,
          state: address.state,
        },
        distance: parseFloat(distance.toFixed(2)), // Distance in km
      });
    }

    // Sort by distance (nearest first)
    nearbyHelpers.sort((a, b) => a.distance - b.distance);

    console.log("\n SEARCH SUMMARY:");
    console.log(`   Total helpers in DB: ${debugInfo.totalHelpers}`);
    console.log(`   Processed: ${debugInfo.processedHelpers}`);
    console.log(`   Skipped (no address): ${debugInfo.skippedNoAddress}`);
    console.log(`   Skipped (invalid coords): ${debugInfo.skippedInvalidCoords}`);
    console.log(`   Skipped (out of radius): ${debugInfo.skippedOutOfRadius}`);
    console.log(`   Skipped (not available): ${debugInfo.skippedNotAvailable}`);
    console.log(`    Within radius & available: ${debugInfo.withinRadius}`);
    console.log(`\n Returning ${nearbyHelpers.length} helpers within ${searchRadius}km`);

    res.status(200).json({
      success: true,
      data: {
        searchLocation: {
          latitude: lat,
          longitude: lng,
        },
        radius: searchRadius,
        count: nearbyHelpers.length,
        helpers: nearbyHelpers,
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
      await Notification.create({
        helperId: task.assignedHelperId,
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
    await Notification.create({
      helpseekerId: helpseekerId,
      userType: 'helpseeker',
      taskId: task.id,
      title: "New OTP Generated",
      message: `New verification OTP for "${task.title}" is: ${newOtp}. Share this with ${helper.fullName}.`,
      type: "otp_regenerated",
      priority: "high",
    });

    // Notify helper
    await Notification.create({
      helperId: task.assignedHelperId,
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
