const HelperProfile = require("../../models/helperModel/helperModel");
const User = require("../../models/authModel/userModel");
const Task = require("../../models/taskModel/taskModel");
const Rating = require("../../models/ratingModel/ratingModel");

// Create or update helper profile
const updateHelperProfile = async (req, res) => {
  try {
    const userId = req.user.id;


    const {
      skills,
      experience,
      hourlyRate,
      availability,
      serviceRadius,
      isAvailable,
      preferences,
    } = req.body;

    let helperProfile = await HelperProfile.findOne({ where: { userId } });

    if (helperProfile) {
      // Update existing profile
      const updateData = {
        skills: skills || helperProfile.skills,
        experience: experience || helperProfile.experience,
        hourlyRate: hourlyRate || helperProfile.hourlyRate,
        availability: availability || helperProfile.availability,
        serviceRadius: serviceRadius || helperProfile.serviceRadius,
        isAvailable:
          isAvailable !== undefined ? isAvailable : helperProfile.isAvailable,
        preferences: preferences || helperProfile.preferences,
      };

      // Handle uploaded documents (certifications, ID, etc.)
      if (req.fileUrls && req.fileUrls.length > 0) {
        const existingDocuments = helperProfile.documents || [];
        updateData.documents = [...existingDocuments, ...req.fileUrls];
      }

      await helperProfile.update(updateData);

      res.status(200).json({
        success: true,
        message: "Helper profile updated successfully",
        data: helperProfile,
      });
    } else {
      // Create new profile
      const createData = {
        userId,
        skills: skills || [],
        experience,
        hourlyRate,
        availability: availability || {},
        serviceRadius: serviceRadius || 10,
        isAvailable: isAvailable !== undefined ? isAvailable : true,
        preferences: preferences || {},
      };

      // Handle uploaded documents for new profile
      if (req.fileUrls && req.fileUrls.length > 0) {
        createData.documents = req.fileUrls;
      }

      helperProfile = await HelperProfile.create(createData);

      res.status(201).json({
        success: true,
        message: "Helper profile created successfully",
        data: helperProfile,
      });
    }
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
    const { userId } = req.params;

    const helperProfile = await HelperProfile.findOne({
      where: { userId },
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "fullName", "email", "phone", "profilePhoto"],
        },
      ],
    });

    if (!helperProfile) {
      return res.status(404).json({
        success: false,
        message: "Helper profile not found",
      });
    }

    // Get recent ratings
    const ratings = await Rating.findAll({
      where: { revieweeId: userId, type: "user_to_helper", isVisible: true },
      include: [
        {
          model: User,
          as: "reviewer",
          attributes: ["id", "fullName", "profilePhoto"],
        },
      ],
      limit: 10,
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json({
      success: true,
      data: {
        profile: helperProfile,
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
    const userId = req.user.id;

    const helperProfile = await HelperProfile.findOne({
      where: { userId },
    });

    if (!helperProfile) {
      return res.status(404).json({
        success: false,
        message: "Helper profile not found. Please create one first.",
      });
    }

    res.status(200).json({
      success: true,
      data: helperProfile,
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

// Toggle helper availability (creates profile if not exists)
const toggleAvailability = async (req, res) => {
  try {
    const userId = req.user.id;

    let helperProfile = await HelperProfile.findOne({ where: { userId } });

    if (!helperProfile) {
      // Create new helper profile with default values if not exists
      helperProfile = await HelperProfile.create({
        userId,
        skills: [],
        experience: null,
        hourlyRate: null,
        availability: {},
        serviceRadius: 10,
        isAvailable: true, // Set to available when profile is created
        preferences: {},
        documents: [],
      });

      return res.status(201).json({
        success: true,
        message: "You are now online and available for tasks",
        data: {
          isAvailable: helperProfile.isAvailable,
          profile: helperProfile,
        },
      });
    }

    // Toggle availability for existing profile
    helperProfile.isAvailable = !helperProfile.isAvailable;
    await helperProfile.save();

    res.status(200).json({
      success: true,
      message: `You are now ${
        helperProfile.isAvailable ? "online" : "offline"
      }`,
      data: {
        isAvailable: helperProfile.isAvailable,
        profile: helperProfile,
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

    let whereClause = {};

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

    const helpers = await HelperProfile.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "fullName", "profilePhoto"],
          where: { isVerified: true, role: "helper" },
        },
      ],
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
    const { userId } = req.params;

    const tasks = await Task.findAll({
      where: {
        assignedHelperId: userId,
        status: "completed",
      },
      include: [
        {
          model: User,
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
    const userId = req.user.id;

    const tasks = await Task.findAll({
      where: {
        assignedHelperId: userId,
        status: ["assigned", "in_progress"],
      },
      include: [
        {
          model: User,
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
    const count = await HelperProfile.count({
      where: {
        isAvailable: true,
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
