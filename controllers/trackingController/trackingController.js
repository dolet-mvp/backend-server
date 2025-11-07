const TaskTracking = require("../../models/trackingModel/trackingModel");
const Task = require("../../models/taskModel/taskModel");
const Notification = require("../../models/notificationModel/notificationModel");
const Helper = require("../../models/authModel/helperModel");
const Helpseeker = require("../../models/authModel/helpseekerModel");

// Update helper status - On the way
const updateOnTheWay = async (req, res) => {
  try {
    const helperId = req.user.id;
    const { taskId } = req.params;
    const { currentLocation, estimatedArrival } = req.body;

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

    const tracking = await TaskTracking.create({
      taskId,
      helperId,
      currentLocation,
      status: "on_the_way",
      estimatedArrival,
    });

    // Notify helpseeker
    await Notification.create({
      helpseekerId: task.helpseekerId,
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
      data: tracking,
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
    const { currentLocation } = req.body;

    const task = await Task.findOne({
      where: { id: taskId, assignedHelperId: helperId },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found or not assigned to you",
      });
    }

    const tracking = await TaskTracking.create({
      taskId,
      helperId,
      currentLocation,
      status: "arrived",
      actualArrival: new Date(),
    });

    // Notify helpseeker
    await Notification.create({
      helpseekerId: task.helpseekerId,
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
      data: tracking,
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

// Start work
const startWork = async (req, res) => {
  try {
    const helperId = req.user.id;
    const { taskId } = req.params;
    const { photos, notes } = req.body;

    const task = await Task.findOne({
      where: { id: taskId, assignedHelperId: helperId },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found or not assigned to you",
      });
    }

    // Check if OTP is verified
    if (!task.isOtpVerified) {
      return res.status(400).json({
        success: false,
        message: "Please verify OTP before starting work",
      });
    }

    const tracking = await TaskTracking.create({
      taskId,
      helperId,
      status: "work_started",
      workStartTime: new Date(),
      photos: photos || [],
      notes,
    });

    // Update task status
    task.status = "in_progress";
    task.startedAt = new Date();
    await task.save();

    // Notify helpseeker
    await Notification.create({
      helpseekerId: task.helpseekerId,
      userType: 'helpseeker',
      taskId: task.id,
      title: "Work Started",
      message: `Helper has started working on "${task.title}"`,
      type: "task_started",
      priority: "high",
    });

    res.status(200).json({
      success: true,
      message: "Work started successfully",
      data: { tracking, task },
    });
  } catch (error) {
    console.error("Start work error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to start work",
      error: error.message,
    });
  }
};

// Complete work
const completeWork = async (req, res) => {
  try {
    const helperId = req.user.id;
    const { taskId } = req.params;
    const { notes } = req.body;

    // Handle uploaded photos from Supabase middleware
    const photos = req.fileUrls || [];

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

    // Generate 6-digit OTP for completion verification
    const completionOtp = Math.floor(100000 + Math.random() * 900000).toString();

    // Update task with completion OTP
    task.completionOtp = completionOtp;
    task.completionOtpGeneratedAt = new Date();
    task.isCompletionOtpVerified = false;
    await task.save();

    // Get work start time
    const workStart = await TaskTracking.findOne({
      where: { taskId, status: "work_started" },
      order: [["createdAt", "DESC"]],
    });

    const workEndTime = new Date();
    const workDuration = workStart
      ? Math.floor((workEndTime - new Date(workStart.workStartTime)) / 60000)
      : 0;

    // Create tracking record with work_completed status (but task not marked completed yet)
    const tracking = await TaskTracking.create({
      taskId,
      helperId,
      status: "work_completed",
      workEndTime,
      totalWorkDuration: workDuration,
      photos: photos,
      notes,
    });

    // Notify helpseeker with OTP
    await Notification.create({
      helpseekerId: task.helpseekerId,
      userType: 'helpseeker',
      taskId: task.id,
      title: "Task Completion Verification Required",
      message: `Helper has completed "${task.title}". Your OTP for verification is: ${completionOtp}. Please share this OTP with the helper to confirm task completion.`,
      type: "task_update",
      priority: "high",
    });

    res.status(200).json({
      success: true,
      message: "Task marked as work completed. Waiting for helpseeker verification with OTP.",
      data: { 
        tracking, 
        task: {
          id: task.id,
          title: task.title,
          status: task.status,
          requiresOtpVerification: true,
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
    if (task.userId !== userId && task.assignedHelperId !== userId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to view tracking",
      });
    }

    const tracking = await TaskTracking.findAll({
      where: { taskId },
      order: [["createdAt", "ASC"]],
      include: [
        {
          model: Helper,
          as: "helper",
          attributes: ["id", "fullName", "profilePhoto", "phone"],
        },
      ],
    });

    res.status(200).json({
      success: true,
      data: tracking,
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
    const { currentLocation } = req.body;

    const task = await Task.findOne({
      where: { id: taskId, assignedHelperId: helperId },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found or not assigned to you",
      });
    }

    // Get latest tracking entry
    const latestTracking = await TaskTracking.findOne({
      where: { taskId, helperId },
      order: [["createdAt", "DESC"]],
    });

    if (latestTracking) {
      latestTracking.currentLocation = currentLocation;
      await latestTracking.save();

      res.status(200).json({
        success: true,
        message: "Location updated",
        data: latestTracking,
      });
    } else {
      res.status(404).json({
        success: false,
        message: "No active tracking found",
      });
    }
  } catch (error) {
    console.error("Update location error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update location",
      error: error.message,
    });
  }
};

// Verify completion OTP and mark task as completed
const verifyCompletionOtp = async (req, res) => {
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

    const task = await Task.findOne({
      where: { id: taskId, assignedHelperId: helperId },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found or not assigned to you",
      });
    }

    // Check if task already completed
    if (task.status === "completed") {
      return res.status(400).json({
        success: false,
        message: "Task is already completed",
      });
    }

    // Check if OTP was generated
    if (!task.completionOtp || !task.completionOtpGeneratedAt) {
      return res.status(400).json({
        success: false,
        message: "No completion OTP found. Please mark work as complete first.",
      });
    }

    // Check OTP expiry (valid for 30 minutes)
    const otpAge = Date.now() - new Date(task.completionOtpGeneratedAt).getTime();
    const OTP_EXPIRY = 30 * 60 * 1000; // 30 minutes

    if (otpAge > OTP_EXPIRY) {
      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please request a new OTP by marking work as complete again.",
      });
    }

    // Verify OTP
    if (task.completionOtp !== otp.trim()) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP. Please check and try again.",
      });
    }

    // Mark task as completed
    task.status = "completed";
    task.completedAt = new Date();
    task.isCompletionOtpVerified = true;
    task.completionOtpVerifiedAt = new Date();
    await task.save();

    // Notify helpseeker that task is now completed
    await Notification.create({
      helpseekerId: task.helpseekerId,
      userType: 'helpseeker',
      taskId: task.id,
      title: "Task Completed Successfully",
      message: `Task "${task.title}" has been verified and marked as completed.`,
      type: "task_completed",
      priority: "high",
    });

    // Notify helper
    await Notification.create({
      helperId: helperId,
      userType: 'helper',
      taskId: task.id,
      title: "Task Verified",
      message: `Task "${task.title}" has been verified by the helpseeker and marked as completed.`,
      type: "task_completed",
      priority: "high",
    });

    res.status(200).json({
      success: true,
      message: "Task completed and verified successfully",
      data: {
        task: {
          id: task.id,
          title: task.title,
          status: task.status,
          completedAt: task.completedAt,
          isCompletionOtpVerified: task.isCompletionOtpVerified,
        }
      },
    });
  } catch (error) {
    console.error("Verify completion OTP error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify OTP",
      error: error.message,
    });
  }
};

module.exports = {
  updateOnTheWay,
  markArrived,
  startWork,
  completeWork,
  verifyCompletionOtp,
  getTaskTracking,
  updateLocation,
};
