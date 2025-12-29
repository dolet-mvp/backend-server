const Helper = require("../models/authModel/helperModel");
const Notification = require("../models/notificationModel/notificationModel");
const { Op } = require("sequelize");
const { attemptTaskDelivery } = require("./taskDeliveryService");
const redis = require("../config/redis/redis");


const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Radius of Earth in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};


const startJobMatching = async (taskData) => {
  try {
    const {
      taskId,
      userId,
      title,
      description,
      budget,
      category,
      latitude,
      longitude,
    } = taskData;

    // Find all approved and verified helpers
    const helpers = await Helper.findAll({
      where: {
        verificationStatus: "approved",
        isApproved: true,
      },
    });

    if (!helpers || helpers.length === 0) {
      console.log(`No approved helpers found for task ${taskId}`);
      return;
    }

    // Maximum distance for matching (in kilometers)
    const MAX_DISTANCE_KM = 50;

    // Filter helpers by distance and create notifications
    const matchingHelpers = [];
    
    for (const helper of helpers) {
      // Skip if helper doesn't have location
      if (!helper.location || !helper.location.lat || !helper.location.lng) {
        continue;
      }

      // Calculate distance between task and helper
      const distance = calculateDistance(
        latitude,
        longitude,
        helper.location.lat,
        helper.location.lng
      );

      // Only notify helpers within the maximum distance
      if (distance <= MAX_DISTANCE_KM) {
        matchingHelpers.push({
          helper,
          distance: Math.round(distance * 10) / 10, // Round to 1 decimal place
        });
      }
    }

    // Sort by distance (closest first)
    matchingHelpers.sort((a, b) => a.distance - b.distance);

    console.log(`📍 [JOB MATCHING] Found ${matchingHelpers.length} helpers within ${MAX_DISTANCE_KM}km for task ${taskId}`);

    // Create notifications for matching helpers
    const notificationPromises = matchingHelpers.map(({ helper, distance }) => {
      return Notification.create({
        userId: helper.id,
        type: "new_task",
        title: "New Task Available Nearby",
        message: `A new task "${title}" is available ${distance}km away from you. Budget: $${budget}`,
        data: {
          taskId,
          helpseekerId: userId,
          category,
          distance,
        },
      });
    });

    await Promise.all(notificationPromises);

    // Get task data from Redis for delivery
    let redisTaskData;
    try {
      const taskDataStr = await redis.get(`job:${taskId}`);
      redisTaskData = taskDataStr ? (typeof taskDataStr === 'string' ? JSON.parse(taskDataStr) : taskDataStr) : null;
    } catch (redisErr) {
      console.error(`❌ [JOB MATCHING] Failed to get task ${taskId} from Redis:`, redisErr);
    }

    // Send real-time socket notifications to all matching helpers using delivery service
    if (redisTaskData) {
      console.log(`📤 [JOB MATCHING] Delivering task ${taskId} to ${matchingHelpers.length} helpers...`);
      
      const deliveryPromises = matchingHelpers.map(({ helper, distance }) => {
        return attemptTaskDelivery(taskId, helper.id, redisTaskData, 1).catch(err => {
          console.error(`❌ [JOB MATCHING] Failed to deliver task ${taskId} to helper ${helper.id}:`, err);
        });
      });

      await Promise.all(deliveryPromises);
      console.log(`✅ [JOB MATCHING] Task delivery initiated for ${matchingHelpers.length} helpers`);
    } else {
      console.warn(`⚠️ [JOB MATCHING] Task ${taskId} not found in Redis, skipping real-time delivery`);
    }

    console.log(
      `✅ [JOB MATCHING] Job matching completed for task ${taskId}: ${matchingHelpers.length} helpers notified`
    );

    return {
      success: true,
      matchedHelpers: matchingHelpers.length,
    };
  } catch (error) {
    console.error("Error in job matching service:", error);
    throw error;
  }
};

module.exports = {
  startJobMatching,
  calculateDistance,
};
