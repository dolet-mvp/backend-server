const Task = require("../../models/taskModel/taskModel");
const TaskQueue = require("../../models/queueModel/queueModel");
const Notification = require("../../models/notificationModel/notificationModel");
const User = require("../../models/authModel/userModel");

// Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Create a new task (Helpseeker)
const createTask = async (req, res) => {
  try {
    const userId = req.user.id;
    let {
      title,
      description,
      category,
      skillsRequired,
      budget,
      estimatedDuration,
      dueDate,
      priority,
      locationRequired,
      location,
      requirements,
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

    // Parse skillsRequired if it comes as string from form-data
    if (skillsRequired && typeof skillsRequired === 'string') {
      try {
        skillsRequired = JSON.parse(skillsRequired);
      } catch (error) {
        skillsRequired = [];
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
        if (!step.title || typeof step.title !== 'string') {
          return res.status(400).json({
            success: false,
            message: `Step ${i + 1} must have a title`,
          });
        }
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

    // Parse and validate dueDate if provided
    let parsedDueDate = null;
    if (dueDate) {
      // Handle different date formats: DD-MM-YYYY, YYYY-MM-DD, ISO string
      const dateStr = dueDate.trim();
      
      // Check if it's DD-MM-YYYY format
      if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
        const [day, month, year] = dateStr.split('-');
        parsedDueDate = new Date(`${year}-${month}-${day}`);
      } 
      // Check if it's YYYY-MM-DD format
      else if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        parsedDueDate = new Date(dateStr);
      }
      // Try parsing as ISO string or other formats
      else {
        parsedDueDate = new Date(dateStr);
      }

      // Validate the parsed date
      if (isNaN(parsedDueDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid due date format. Use DD-MM-YYYY or YYYY-MM-DD",
        });
      }

      // Get current date and time
      const now = new Date();
      
      // Set parsedDueDate to end of day if only date is provided (no time)
      // This allows tasks due "today" to be valid
      const dateOnly = /^\d{2}-\d{2}-\d{4}$/.test(dateStr) || /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
      if (dateOnly) {
        // Set to end of the day (23:59:59)
        parsedDueDate.setHours(23, 59, 59, 999);
      }

      // Check if date/time is in the past (before current moment)
      if (parsedDueDate < now) {
        return res.status(400).json({
          success: false,
          message: "Due date cannot be in the past",
        });
      }
    }

    // Handle uploaded attachments
    const attachments = req.fileUrls || [];

    const task = await Task.create({
      userId,
      title,
      description,
      category,
      skillsRequired: skillsRequired || [],
      budget: taskBudget,
      estimatedDuration,
      dueDate: parsedDueDate,
      priority: priority || "medium",
      status: "draft",
      locationRequired: locationRequired || false,
      location: locationRequired ? location : null,
      attachments,
      requirements,
      allowDirectAcceptance: allowDirectAcceptance || true,
      steps: steps || []
    });

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

// Publish task to queue (Helpseeker)
const publishTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.user.id;

    const task = await Task.findOne({ where: { id: taskId, userId } });

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
    const helpers = await User.findAll({
      where: { role: "helper", isVerified: true },
    });

    const notifications = helpers.map((helper) => ({
      userId: helper.id,
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

// Schedule task to be published at a specific date and time
const scheduleTaskPublish = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { scheduledPublishAt } = req.body;
    const userId = req.user.id;

    if (!scheduledPublishAt) {
      return res.status(400).json({
        success: false,
        message: "Scheduled publish date and time is required",
      });
    }

    const task = await Task.findOne({ where: { id: taskId, userId } });

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

// Cancel scheduled publish
const cancelScheduledPublish = async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.user.id;

    const task = await Task.findOne({ where: { id: taskId, userId } });

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

// Get all tasks created by helpseeker
const getMyTasks = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status } = req.query;

    const whereClause = { userId };
    if (status) {
      whereClause.status = status;
    }

    const tasks = await Task.findAll({
      where: whereClause,
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: User,
          as: "assignedHelper",
          attributes: ["id", "fullName", "profilePhoto", "phone"],
        },
      ],
    });

    res.status(200).json({
      success: true,
      data: tasks,
    });
  } catch (error) {
    console.error("Get my tasks error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch tasks",
      error: error.message,
    });
  }
};

// Update task (Helpseeker - only draft tasks)
const updateTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.user.id;
    let updateData = { ...req.body };

    const task = await Task.findOne({ where: { id: taskId, userId } });

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

    // Parse skillsRequired if it comes as string from form-data
    if (updateData.skillsRequired && typeof updateData.skillsRequired === 'string') {
      try {
        updateData.skillsRequired = JSON.parse(updateData.skillsRequired);
      } catch (error) {
        updateData.skillsRequired = [];
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
        if (!step.title || typeof step.title !== 'string') {
          return res.status(400).json({
            success: false,
            message: `Step ${i + 1} must have a title`,
          });
        }
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

    // Parse and validate dueDate if provided
    if (updateData.dueDate) {
      const dateStr = updateData.dueDate.trim();
      let parsedDueDate = null;
      
      // Check if it's DD-MM-YYYY format
      if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
        const [day, month, year] = dateStr.split('-');
        parsedDueDate = new Date(`${year}-${month}-${day}`);
      } 
      // Check if it's YYYY-MM-DD format
      else if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        parsedDueDate = new Date(dateStr);
      }
      // Try parsing as ISO string or other formats
      else {
        parsedDueDate = new Date(dateStr);
      }

      // Validate the parsed date
      if (isNaN(parsedDueDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid due date format. Use DD-MM-YYYY or YYYY-MM-DD",
        });
      }

      // Get current date and time
      const now = new Date();
      
      // Set parsedDueDate to end of day if only date is provided (no time)
      const dateOnly = /^\d{2}-\d{2}-\d{4}$/.test(dateStr) || /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
      if (dateOnly) {
        parsedDueDate.setHours(23, 59, 59, 999);
      }

      // Check if date/time is in the past
      if (parsedDueDate < now) {
        return res.status(400).json({
          success: false,
          message: "Due date cannot be in the past",
        });
      }

      updateData.dueDate = parsedDueDate;
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
    const userId = req.user.id;

    const task = await Task.findOne({ where: { id: taskId, userId } });

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
        userId: task.assignedHelperId,
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
    const userId = req.user.id;
    const { additionalAmount } = req.body;

    if (!additionalAmount || additionalAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid additional amount",
      });
    }

    const task = await Task.findOne({ where: { id: taskId, userId } });

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
    const helpers = await User.findAll({
      where: { role: "helper", isVerified: true },
    });

    const notifications = helpers.map((helper) => ({
      userId: helper.id,
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

// Approve helper request and assign task (Helpseeker) - Step 2: Helpseeker approves helper
const approveHelperRequest = async (req, res) => {
  try {
    const userId = req.user.id;
    const { taskId } = req.params;

    const task = await Task.findOne({ 
      where: { id: taskId, userId },
      include: [
        {
          model: User,
          as: "creator",
          attributes: ["id", "fullName"],
        },
      ],
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found or you are not authorized",
      });
    }

    if (!task.pendingHelperId) {
      return res.status(400).json({
        success: false,
        message: "No pending helper request for this task",
      });
    }

    if (task.status !== "in_queue") {
      return res.status(400).json({
        success: false,
        message: "Task is not available for assignment",
      });
    }

    // Get helper details
    const helper = await User.findByPk(task.pendingHelperId, {
      attributes: ["id", "fullName", "email", "phone"],
    });

    if (!helper) {
      return res.status(404).json({
        success: false,
        message: "Helper not found",
      });
    }

    // Generate OTP for task verification
    const otp = generateOTP();

    // Assign task to helper
    task.status = "assigned";
    task.assignedHelperId = task.pendingHelperId;
    task.acceptedAt = new Date();
    task.verificationOtp = otp;
    task.otpGeneratedAt = new Date();
    task.isOtpVerified = false;
    task.pendingHelperId = null; // Clear pending helper
    await task.save();

    // Remove from queue
    await TaskQueue.destroy({ where: { taskId: task.id } });

    // Notify helper (approved + OTP instruction)
    await Notification.create({
      userId: helper.id,
      taskId: task.id,
      title: "Request Approved - Task Assigned!",
      message: `Great news! ${task.creator.fullName} has approved your request for "${task.title}". Ask the helpseeker for the 6-digit OTP to start work.`,
      type: "request_approved",
      priority: "high",
    });

    // Notify helpseeker with OTP
    await Notification.create({
      userId: userId,
      taskId: task.id,
      title: "Helper Approved",
      message: `You approved ${helper.fullName} for "${task.title}". Your verification OTP is: ${otp}. Share this OTP with the helper when work begins.`,
      type: "helper_approved",
      priority: "high",
    });

    res.status(200).json({
      success: true,
      message: "Helper approved and task assigned successfully",
      data: {
        task: {
          id: task.id,
          title: task.title,
          status: task.status,
          assignedHelperId: task.assignedHelperId,
          acceptedAt: task.acceptedAt,
        },
        helper: {
          id: helper.id,
          fullName: helper.fullName,
          email: helper.email,
          phone: helper.phone,
        },
        otp: otp,
        otpGeneratedAt: task.otpGeneratedAt,
        message: "Share this OTP with the helper when work begins. OTP is valid for 24 hours.",
      },
    });
  } catch (error) {
    console.error("Approve helper request error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to approve helper request",
      error: error.message,
    });
  }
};

// Reject helper request (Helpseeker)
const rejectHelperRequest = async (req, res) => {
  try {
    const userId = req.user.id;
    const { taskId } = req.params;
    const { reason } = req.body; // Optional rejection reason

    const task = await Task.findOne({ where: { id: taskId, userId } });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found or you are not authorized",
      });
    }

    if (!task.pendingHelperId) {
      return res.status(400).json({
        success: false,
        message: "No pending helper request for this task",
      });
    }

    const helperId = task.pendingHelperId;

    // Clear pending helper
    task.pendingHelperId = null;
    await task.save();

    // Notify helper
    await Notification.create({
      userId: helperId,
      taskId: task.id,
      title: "Request Not Approved",
      message: `Your request to accept "${task.title}" was not approved. ${reason ? `Reason: ${reason}` : 'You can request other available tasks.'}`,
      type: "request_rejected",
      priority: "medium",
    });

    res.status(200).json({
      success: true,
      message: "Helper request rejected",
    });
  } catch (error) {
    console.error("Reject helper request error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reject helper request",
      error: error.message,
    });
  }
};

// Regenerate OTP for task (Helpseeker)
const regenerateOTP = async (req, res) => {
  try {
    const userId = req.user.id;
    const { taskId } = req.params;

    const task = await Task.findOne({ where: { id: taskId, userId } });

    if (!task) {
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
    const helper = await User.findByPk(task.assignedHelperId, {
      attributes: ["id", "fullName"],
    });

    // Notify helpseeker
    await Notification.create({
      userId: userId,
      taskId: task.id,
      title: "New OTP Generated",
      message: `New verification OTP for "${task.title}" is: ${newOtp}. Share this with ${helper.fullName}.`,
      type: "otp_regenerated",
      priority: "high",
    });

    // Notify helper
    await Notification.create({
      userId: task.assignedHelperId,
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

// Get tasks with pending helper requests (Helpseeker)
const getTasksWithPendingHelpers = async (req, res) => {
  try {
    const userId = req.user.id;

    // Find all tasks created by this helpseeker that have pending helpers
    const tasks = await Task.findAll({
      where: {
        userId: userId,
        pendingHelperId: { [require("sequelize").Op.ne]: null }, // Has pending helper
        status: "in_queue", // Still in queue (not assigned yet)
      },
      include: [
        {
          model: User,
          as: "pendingHelper", // We need to add this association
          attributes: ["id", "fullName", "email", "phone", "profilePhoto"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json({
      success: true,
      message: `Found ${tasks.length} tasks with pending helper requests`,
      data: tasks,
    });
  } catch (error) {
    console.error("Get tasks with pending helpers error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch tasks with pending helpers",
      error: error.message,
    });
  }
};

// Get pending helper request for a specific task (Helpseeker)
const getPendingHelperForTask = async (req, res) => {
  try {
    const userId = req.user.id;
    const { taskId } = req.params;

    const task = await Task.findOne({
      where: {
        id: taskId,
        userId: userId,
      },
      include: [
        {
          model: User,
          as: "pendingHelper",
          attributes: ["id", "fullName", "email", "phone", "profilePhoto", "createdAt"],
        },
      ],
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found or you are not authorized",
      });
    }

    if (!task.pendingHelperId) {
      return res.status(200).json({
        success: true,
        message: "No pending helper request for this task",
        data: {
          taskId: task.id,
          taskTitle: task.title,
          hasPendingHelper: false,
          pendingHelper: null,
        },
      });
    }

    res.status(200).json({
      success: true,
      message: "Pending helper request found",
      data: {
        taskId: task.id,
        taskTitle: task.title,
        hasPendingHelper: true,
        pendingHelper: task.pendingHelper,
        requestedAt: task.updatedAt, // Approximate time when helper requested
      },
    });
  } catch (error) {
    console.error("Get pending helper for task error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch pending helper",
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
  updateTask,
  cancelTask,
  increaseReward,
  approveHelperRequest,
  rejectHelperRequest,
  regenerateOTP,
  getTasksWithPendingHelpers,
  getPendingHelperForTask,
};
