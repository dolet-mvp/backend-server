const Helper = require("../../models/authModel/helperModel");
const Helpseeker = require("../../models/authModel/helpseekerModel");
const Task = require("../../models/taskModel/taskModel");
const Rating = require("../../models/ratingModel/ratingModel");
const Address = require("../../models/addressModel/addressModel");
const redis = require("../../config/redis/redis");


// Get helper availability status
const getAvailabilityStatus = async (req, res) => {
  try {
    const helperId = req.user.id;

    // Check Redis first for online status
    const cachedHelper = await redis.get(`helper:online:${helperId}`);
    
    if (cachedHelper) {
      // Upstash Redis returns objects directly, no need to parse
      const helperData = typeof cachedHelper === 'string' ? JSON.parse(cachedHelper) : cachedHelper;
      return res.status(200).json({
        success: true,
        message: "Availability status retrieved successfully",
        data: {
          isAvailable: true,
          status: "online",
          onlineAt: helperData.onlineAt,
        },
      });
    }

    // If not in Redis, check database
    const helper = await Helper.findByPk(helperId, {
      attributes: ["id", "fullName", "isAvailable"],
    });

    if (!helper) {
      return res.status(404).json({
        success: false,
        message: "Helper not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Availability status retrieved successfully",
      data: {
        isAvailable: helper.isAvailable,
        status: helper.isAvailable ? "online" : "offline",
      },
    });
  } catch (error) {
    console.error("Get availability status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get availability status",
      error: error.message,
    });
  }
};

// Toggle helper availability
const toggleAvailability = async (req, res) => {
  try {
    const helperId = req.user.id;

    const helper = await Helper.findByPk(helperId, {
      include: [
        {
          model: Address,
          as: "addresses",
          attributes: ["id", "street", "city", "state", "latitude", "longitude", "isDefault"],
        },
      ],
    });

    if (!helper) {
      return res.status(404).json({
        success: false,
        message: "Helper not found",
      });
    }

    // Toggle availability
    helper.isAvailable = !helper.isAvailable;
    await helper.save();

    // If helper goes online, store in Redis
    if (helper.isAvailable) {
      const helperData = {
        id: helper.id,
        fullName: helper.fullName,
        email: helper.email,
        phone: helper.phone,
        profilePhoto: helper.profilePhoto,
        isAvailable: helper.isAvailable,
        averageRating: helper.averageRating,
        completedTasks: helper.completedTasks,
        addresses: helper.addresses,
        onlineAt: new Date().toISOString(),
      };

      // Upstash Redis automatically handles JSON serialization
      await redis.set(`helper:online:${helper.id}`, helperData);
      // Optional: Set expiration (e.g., 12 hours = 43200 seconds)
      await redis.expire(`helper:online:${helper.id}`, 43200);
      
      // Add to sorted set for counting available helpers
      // Using timestamp as score for ordering
      await redis.zadd('helpers:available', {
        score: Date.now(),
        member: helper.id,
      });
      
      console.log(`✅ Helper ${helper.id} marked as available in Redis`);
    } else {
      // If helper goes offline, remove from Redis
      await redis.del(`helper:online:${helper.id}`);
      
      // Remove from available helpers sorted set
      await redis.zrem('helpers:available', helper.id);
      
      console.log(`✅ Helper ${helper.id} marked as offline in Redis`);
    }

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
    // Get count from Redis sorted set
    const count = await redis.zcard('helpers:available');
    
    console.log(`📊 Available helpers count from Redis: ${count}`);

    res.status(200).json({
      success: true,
      message: "Available helpers count retrieved successfully from Redis",
      data: {
        availableHelpers: count,
        source: "redis",
      },
    });
  } catch (error) {
    console.error("Get available helpers count error:", error);
    
    // Fallback to database if Redis fails
    try {
      const count = await Helper.count({
        where: {
          isAvailable: true,
          verificationStatus: "approved",
        },
      });
      
      console.log(`📊 Fallback: Available helpers count from database: ${count}`);
      
      res.status(200).json({
        success: true,
        message: "Available helpers count retrieved successfully (database fallback)",
        data: {
          availableHelpers: count,
          source: "database",
        },
      });
    } catch (dbError) {
      console.error("Database fallback also failed:", dbError);
      res.status(500).json({
        success: false,
        message: "Failed to fetch available helpers count",
        error: error.message,
      });
    }
  }
};

module.exports = {
  getAvailabilityStatus,
  toggleAvailability,
  getHelperCompletedTasks,
  getHelperActiveTasks,
  getAvailableHelpersCount,
};
