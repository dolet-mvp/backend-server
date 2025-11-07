const Helper = require("../../models/authModel/helperModel");
const Helpseeker = require("../../models/authModel/helpseekerModel");
const Task = require("../../models/taskModel/taskModel");
const Rating = require("../../models/ratingModel/ratingModel");

// Create or update helper profile
const updateHelperProfile = async (req, res) => {
  try {
    const helperId = req.user.id;


    const {
      skills,
      experience,
      hourlyRate,
      availability,
      serviceRadius,
      isAvailable,
      preferences,
      fullName,
      phone,
      email,
    } = req.body;

    const helper = await Helper.findByPk(helperId);

    if (!helper) {
      return res.status(404).json({
        success: false,
        message: "Helper not found",
      });
    }

    // Update helper profile
    const updateData = {};
    if (skills !== undefined) updateData.skills = skills;
    if (experience !== undefined) updateData.experience = experience;
    if (hourlyRate !== undefined) updateData.hourlyRate = hourlyRate;
    if (availability !== undefined) updateData.availability = availability;
    if (serviceRadius !== undefined) updateData.serviceRadius = serviceRadius;
    if (isAvailable !== undefined) updateData.isAvailable = isAvailable;
    if (preferences !== undefined) updateData.preferences = preferences;
    if (fullName !== undefined) updateData.fullName = fullName;
    if (phone !== undefined) updateData.phone = phone;
    if (email !== undefined) updateData.email = email;

    // Handle uploaded documents (certifications, ID, etc.)
    if (req.fileUrls && req.fileUrls.length > 0) {
      const existingDocuments = helper.documents || {};
      updateData.documents = { ...existingDocuments, ...req.fileUrls };
    }

    await helper.update(updateData);

    res.status(200).json({
      success: true,
      message: "Helper profile updated successfully",
      data: helper,
    });
  } catch (error) {
    console.error("Update helper profile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update helper profile",
      error: error.message,
    });
  }
};

// Get helper profile
const getHelperProfile = async (req, res) => {
  try {
    const { helperId } = req.params;

    const helper = await Helper.findByPk(helperId);

    if (!helper) {
      return res.status(404).json({
        success: false,
        message: "Helper profile not found",
      });
    }

    // Get recent ratings
    const ratings = await Rating.findAll({
      where: { revieweeId: helperId, revieweeType: 'helper', isVisible: true },
      limit: 10,
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json({
      success: true,
      data: {
        profile: helper,
        recentRatings: ratings,
      },
    });
  } catch (error) {
    console.error("Get helper profile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch helper profile",
      error: error.message,
    });
  }
};

// Get my helper profile
const getMyHelperProfile = async (req, res) => {
  try {
    const helperId = req.user.id;

    const helper = await Helper.findByPk(helperId);

    if (!helper) {
      return res.status(404).json({
        success: false,
        message: "Helper profile not found.",
      });
    }

    res.status(200).json({
      success: true,
      data: helper,
    });
  } catch (error) {
    console.error("Get my helper profile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch helper profile",
      error: error.message,
    });
  }
};

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

// Search helpers
const searchHelpers = async (req, res) => {
  try {
    const { skills, minRating, maxHourlyRate, serviceRadius, isAvailable } =
      req.query;

    let whereClause = {
      verificationStatus: "approved", // Only show approved helpers
    };

    if (isAvailable === "true") {
      whereClause.isAvailable = true;
    }

    if (minRating) {
      whereClause.averageRating = { [require("sequelize").Op.gte]: minRating };
    }

    if (maxHourlyRate) {
      whereClause.hourlyRate = { [require("sequelize").Op.lte]: maxHourlyRate };
    }

    if (serviceRadius) {
      whereClause.serviceRadius = { [require("sequelize").Op.gte]: serviceRadius };
    }

    const helpers = await Helper.findAll({
      where: whereClause,
      order: [
        ["averageRating", "DESC"],
        ["completedTasks", "DESC"],
      ],
    });

    // Filter by skills if provided
    let filteredHelpers = helpers;
    if (skills) {
      const skillsArray = skills.split(",").map((s) => s.trim().toLowerCase());
      filteredHelpers = helpers.filter((helper) => {
        if (!helper.skills || helper.skills.length === 0) return false;
        return skillsArray.some((skill) =>
          helper.skills.some((helperSkill) =>
            helperSkill.toLowerCase().includes(skill)
          )
        );
      });
    }

    res.status(200).json({
      success: true,
      data: filteredHelpers,
    });
  } catch (error) {
    console.error("Search helpers error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to search helpers",
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
  updateHelperProfile,
  getHelperProfile,
  getMyHelperProfile,
  toggleAvailability,
  searchHelpers,
  getHelperCompletedTasks,
  getHelperActiveTasks,
  getAvailableHelpersCount,
};
