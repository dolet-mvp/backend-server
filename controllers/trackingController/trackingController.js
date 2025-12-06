const Task = require("../../models/taskModel/taskModel");
const Notification = require("../../models/notificationModel/notificationModel");
const Helper = require("../../models/authModel/helperModel");
const Helpseeker = require("../../models/authModel/helpseekerModel");
const { createNotification } = require("../../services/notificationService");

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

    const task = await Task.findOne({
      where: { id: taskId, assignedHelperId: helperId },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found or not assigned to you",
      });
    }

    // Store current location in task's location field
    const currentLocation = task.location || {};
    currentLocation.helperCurrentLat = latitude;
    currentLocation.helperCurrentLng = longitude;
    currentLocation.lastUpdated = new Date();
    
    task.location = currentLocation;
    task.changed('location', true); // Force Sequelize to recognize JSON change
    await task.save();

    res.status(200).json({
      success: true,
      message: "Location updated successfully",
      data: {
        taskId: task.id,
        currentLocation: {
          latitude,
          longitude,
          lastUpdated: currentLocation.lastUpdated,
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

module.exports = {
  updateOnTheWay,
  markArrived,
  completeWork,
  getTaskTracking,
  updateLocation,
};
