const Task = require("../../models/taskModel/taskModel");
const TaskQueue = require("../../models/queueModel/queueModel");
const Notification = require("../../models/notificationModel/notificationModel");
const Helper = require("../../models/authModel/helperModel");
const Helpseeker = require("../../models/authModel/helpseekerModel");
const Address = require("../../models/addressModel/addressModel");

// Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Haversine formula to calculate distance between two points
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

    // Check if helper is available/online
    if (helperId) {
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

    let helperLat, helperLng;
    let helperAddress = null;

    // Fetch helper's address from AddressModel
    if (helperId) {
      helperAddress = await Address.findOne({
        where: { helperId: helperId, userType: 'helper' },
        attributes: ['id', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'latitude', 'longitude', 'type'],
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
    

    // Get all tasks in queue
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
          attributes: ["id", "fullName", "profilePhoto"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    // Filter tasks by location radius
    const nearbyTasks = tasks
      .filter((task) => {
        // If task doesn't require location or has no location, include it
        if (!task.locationRequired || !task.location) {
          return true;
        }

        // If task has location, check if it's within radius
        if (task.location.lat && task.location.lng) {
          const distance = calculateDistance(
            helperLat,
            helperLng,
            parseFloat(task.location.lat),
            parseFloat(task.location.lng)
          );
          
          // Add distance to task object for reference
          task.dataValues.distance = parseFloat(distance.toFixed(2));
          
          return distance <= searchRadius;
        }

        return false;
      })
      .sort((a, b) => {
        // Sort by distance if available, otherwise by creation date
        if (a.dataValues.distance && b.dataValues.distance) {
          return a.dataValues.distance - b.dataValues.distance;
        }
        return 0;
      });

    res.status(200).json({
      success: true,
      message: `Found ${nearbyTasks.length} tasks within ${searchRadius}km`,
      data: nearbyTasks,
      meta: {
        isHelperAvailable: true,
        helperStatus: "online",
        helperLocation: { 
          lat: helperLat, 
          lng: helperLng,
          address: helperAddress ? {
            addressLine1: helperAddress.addressLine1,
            addressLine2: helperAddress.addressLine2,
            city: helperAddress.city,
            state: helperAddress.state,
            postalCode: helperAddress.postalCode,
            type: helperAddress.type,
          } : null,
          source: helperAddress ? 'address_model' : 'query_params'
        },
        searchRadius: searchRadius,
    
        totalTasks: tasks.length,
        nearbyTasks: nearbyTasks.length,
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

   
    // Notify helpseeker about rejection
    await Notification.create({
      helpseekerId: task.helpseekerId,
      userType: 'helpseeker',
      taskId: task.id,
      title: "Task Declined",
      message: `${helper.fullName} has declined your task "${task.title}". Reason: ${reason}`,
      type: "bid_rejected",
      priority: "medium",
    });

    res.status(200).json({
      success: true,
      message: "Task rejected successfully",
      data: {
        taskId: task.id,
        reason: reason,
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
    if (task.status !== "assigned") {
      return res.status(400).json({
        success: false,
        message: "Task is not in assigned status",
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

module.exports = {
  getAvailableTasks,
  acceptTask,
  rejectTask,
  verifyOTPAndStartTask,
};
