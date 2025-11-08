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

    // Find or create tracking record for this task
    const [tracking, created] = await TaskTracking.findOrCreate({
      where: { taskId, helperId },
      defaults: {
        status: "on_the_way",
      },
    });

    // If already exists, update the status
    if (!created) {
      tracking.status = "on_the_way";
      await tracking.save();
    }

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

    const task = await Task.findOne({
      where: { id: taskId, assignedHelperId: helperId },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found or not assigned to you",
      });
    }

    // Find or create tracking record for this task
    const [tracking, created] = await TaskTracking.findOrCreate({
      where: { taskId, helperId },
      defaults: {
        status: "arrived",
        actualArrival: new Date(),
      },
    });

    // If already exists, update the status and arrival time
    if (!created) {
      tracking.status = "arrived";
      tracking.actualArrival = new Date();
      await tracking.save();
    }

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

    // Find or create tracking record for this task
    const [tracking, created] = await TaskTracking.findOrCreate({
      where: { taskId, helperId },
      defaults: {
        status: "work_completed",
        workEndTime,
        totalWorkDuration: workDuration,
      },
    });

    // If already exists, update the status and completion details
    if (!created) {
      tracking.status = "work_completed";
      tracking.workEndTime = workEndTime;
      tracking.totalWorkDuration = workDuration;
      await tracking.save();
    }

    // Mark task as completed
    task.status = "completed";
    task.completedAt = new Date();
    await task.save();

    // Notify helpseeker
    await Notification.create({
      helpseekerId: task.helpseekerId,
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
        tracking, 
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

    // Get the tracking record for this task (should be only one now)
    const tracking = await TaskTracking.findOne({
      where: { taskId },
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

module.exports = {
  updateOnTheWay,
  markArrived,
  completeWork,
  getTaskTracking,
  updateLocation,
};
