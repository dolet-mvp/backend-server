const Helper = require("../../models/authModel/helperModel");
const Helpseeker = require("../../models/authModel/helpseekerModel");
const Task = require("../../models/taskModel/taskModel");
const Rating = require("../../models/ratingModel/ratingModel");


// Toggle helper availability
const toggleAvailability = async (req, res) => {
  try {
    const helperId = req.user.id;

    const helper = await Helper.findByPk(helperId);

    if (!helper) {
      return res.status(404).json({
        success: false,
        message: "Helper not found",
      });
    }

    // Toggle availability
    helper.isAvailable = !helper.isAvailable;
    await helper.save();

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
    const count = await Helper.count({
      where: {
        isAvailable: true,
        verificationStatus: "approved",
      },
    });

    res.status(200).json({
      success: true,
      message: "Available helpers count retrieved successfully",
      data: {
        availableHelpers: count,
      },
    });
  } catch (error) {
    console.error("Get available helpers count error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch available helpers count",
      error: error.message,
    });
  }
};

module.exports = {
  toggleAvailability,
  getHelperCompletedTasks,
  getHelperActiveTasks,
  getAvailableHelpersCount,
};
