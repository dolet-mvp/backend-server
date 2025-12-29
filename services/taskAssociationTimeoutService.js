const redis = require("../config/redis/redis");
const Task = require("../models/taskModel/taskModel");
const Helper = require("../models/authModel/helperModel");
const Address = require("../models/addressModel/addressModel");
const { attemptTaskDelivery } = require("./taskDeliveryService");
const axios = require("axios");

const ASSOCIATION_TIMEOUT = 50000; // 50 seconds in milliseconds

/**
 * Store association timeout for a task-helper pair
 * @param {string} taskId - Task ID
 * @param {string} helperId - Helper ID
 * @param {number} timeoutSeconds - Timeout duration in seconds (default 50)
 */
const setAssociationTimeout = async (taskId, helperId, timeoutSeconds = 50) => {
  try {
    const expiryTime = Date.now() + (timeoutSeconds * 1000);
    
    // Store association timeout in Redis sorted set
    await redis.zadd("task:association:timeouts", {
      score: expiryTime,
      member: JSON.stringify({ taskId, helperId, createdAt: new Date().toISOString() }),
    });

    console.log(`⏰ [ASSOCIATION] Set ${timeoutSeconds}s timeout for task ${taskId} -> helper ${helperId}`);
    console.log(`   Expires at: ${new Date(expiryTime).toISOString()}`);

    return { success: true, expiryTime };
  } catch (error) {
    console.error(`❌ [ASSOCIATION] Error setting timeout:`, error);
    throw error;
  }
};

/**
 * Remove association timeout (called when helper accepts or rejects)
 * @param {string} taskId - Task ID
 * @param {string} helperId - Helper ID
 */
const clearAssociationTimeout = async (taskId, helperId) => {
  try {
    // Remove from timeout queue
    const members = await redis.zrange("task:association:timeouts", 0, -1);
    let removedCount = 0;

    for (const member of members) {
      try {
        const data = typeof member === 'string' ? JSON.parse(member) : member;
        if (data.taskId === taskId && data.helperId === helperId) {
          const memberStr = typeof member === 'string' ? member : JSON.stringify(member);
          await redis.zrem("task:association:timeouts", memberStr);
          removedCount++;
          console.log(`🗑️ [ASSOCIATION] Cleared timeout for task ${taskId} -> helper ${helperId}`);
        }
      } catch (parseError) {
        console.warn(`⚠️ [ASSOCIATION] Failed to parse timeout member:`, parseError.message);
      }
    }

    return { success: true, removedCount };
  } catch (error) {
    console.error(`❌ [ASSOCIATION] Error clearing timeout:`, error);
    throw error;
  }
};

/**
 * Calculate distance between two coordinates using Haversine formula
 */
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

/**
 * Find next nearest helper for a task
 * @param {string} taskId - Task ID
 * @param {Array} excludeHelperIds - Helper IDs to exclude
 * @returns {Object} Next nearest helper info or null
 */
const findNextNearestHelper = async (taskId, excludeHelperIds = []) => {
  try {
    console.log(`🔍 [ASSOCIATION] Finding next nearest helper for task ${taskId}...`);
    console.log(`   Excluding helpers: ${excludeHelperIds.join(', ')}`);

    // Get task details
    const task = await Task.findByPk(taskId);
    if (!task) {
      console.warn(`⚠️ [ASSOCIATION] Task ${taskId} not found`);
      return null;
    }

    // Check if task is still in queue
    if (task.status !== "in_queue") {
      console.warn(`⚠️ [ASSOCIATION] Task ${taskId} is no longer in queue (status: ${task.status})`);
      return null;
    }

    // Get task location
    const taskLocation = task.location;
    if (!taskLocation || !taskLocation.lat || !taskLocation.lng) {
      console.warn(`⚠️ [ASSOCIATION] Task ${taskId} has no valid location`);
      return null;
    }

    const taskLat = parseFloat(taskLocation.lat);
    const taskLng = parseFloat(taskLocation.lng);

    // Get online helpers from Redis
    const onlineHelperIds = await redis.zrange('helpers:available', 0, -1);
    console.log(`   Found ${onlineHelperIds.length} online helpers`);

    if (onlineHelperIds.length === 0) {
      console.log(`   ❌ No online helpers available`);
      return null;
    }

    // Get helper details with addresses
    const helpers = [];
    for (const helperId of onlineHelperIds) {
      // Skip excluded helpers
      if (excludeHelperIds.includes(helperId)) {
        console.log(`   ⏭️ Skipping excluded helper ${helperId}`);
        continue;
      }

      // Check if helper already has associated tasks
      const helperTasksKey = `helper:${helperId}:associated_tasks`;
      const helperTasksData = await redis.get(helperTasksKey);
      
      if (helperTasksData) {
        const tasks = typeof helperTasksData === 'string' ? JSON.parse(helperTasksData) : helperTasksData;
        if (Array.isArray(tasks) && tasks.length > 0) {
          console.log(`   ⏭️ Helper ${helperId} already has ${tasks.length} associated task(s), skipping`);
          continue;
        }
      }

      // Check if helper has already acted on this task
      const actionsData = await redis.get(`task:${taskId}:actions`);
      if (actionsData) {
        const actions = typeof actionsData === 'string' ? JSON.parse(actionsData) : actionsData;
        if (actions.some(action => action.helperId === helperId)) {
          console.log(`   ⏭️ Helper ${helperId} already acted on this task, skipping`);
          continue;
        }
      }

      // Get helper data from Redis
      const helperData = await redis.get(`helper:online:${helperId}`);
      if (!helperData) {
        console.log(`   ⏭️ Helper ${helperId} not found in Redis, skipping`);
        continue;
      }

      const helper = typeof helperData === 'string' ? JSON.parse(helperData) : helperData;
      
      // Get helper's default address
      const helperAddress = helper.addresses?.find(addr => addr.isDefault) || helper.addresses?.[0];
      
      if (helperAddress && helperAddress.latitude && helperAddress.longitude) {
        helpers.push({
          helperId: helper.id,
          latitude: helperAddress.latitude,
          longitude: helperAddress.longitude,
        });
      }
    }

    console.log(`   ${helpers.length} eligible helpers after filtering`);

    if (helpers.length === 0) {
      console.log(`   ❌ No eligible helpers available`);
      return null;
    }

    // Calculate distances using Google Maps API if available
    const helpersWithDistance = [];
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;

    if (apiKey) {
      // Process in batches of 25 (Google API limit)
      const batchSize = 25;
      for (let i = 0; i < helpers.length; i += batchSize) {
        const batch = helpers.slice(i, i + batchSize);
        const originsStr = batch.map(h => `${h.latitude},${h.longitude}`).join('|');

        try {
          const response = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
            params: {
              origins: originsStr,
              destinations: `${taskLat},${taskLng}`,
              key: apiKey,
              units: 'metric',
            },
            timeout: 5000,
          });

          if (response.data.status === 'OK') {
            response.data.rows.forEach((row, index) => {
              if (row.elements[0] && row.elements[0].status === 'OK') {
                const distanceInKm = row.elements[0].distance.value / 1000;
                if (distanceInKm <= 50) {
                  helpersWithDistance.push({
                    helperId: batch[index].helperId,
                    distance: distanceInKm,
                  });
                }
              }
            });
          }
        } catch (error) {
          console.warn(`   ⚠️ Distance calculation failed:`, error.message);
          // Fallback to Haversine formula
          batch.forEach(helper => {
            const distance = calculateDistance(taskLat, taskLng, helper.latitude, helper.longitude);
            if (distance <= 50) {
              helpersWithDistance.push({
                helperId: helper.helperId,
                distance,
              });
            }
          });
        }
      }
    } else {
      // Use Haversine formula
      helpers.forEach(helper => {
        const distance = calculateDistance(taskLat, taskLng, helper.latitude, helper.longitude);
        if (distance <= 50) {
          helpersWithDistance.push({
            helperId: helper.helperId,
            distance,
          });
        }
      });
    }

    console.log(`   ${helpersWithDistance.length} helpers within 50km range`);

    if (helpersWithDistance.length === 0) {
      console.log(`   ❌ No helpers within 50km range`);
      return null;
    }

    // Sort by distance and return closest
    helpersWithDistance.sort((a, b) => a.distance - b.distance);
    const nextHelper = helpersWithDistance[0];

    console.log(`   ✅ Found next nearest helper: ${nextHelper.helperId} (${nextHelper.distance.toFixed(2)}km)`);

    return nextHelper;
  } catch (error) {
    console.error(`❌ [ASSOCIATION] Error finding next helper:`, error);
    throw error;
  }
};

/**
 * Reassociate task with next nearest helper
 * @param {string} taskId - Task ID
 * @param {string} previousHelperId - Previous helper ID
 */
const reassociateTask = async (taskId, previousHelperId) => {
  try {
    console.log(`\n🔄 [ASSOCIATION] Reassociating task ${taskId} (previous: ${previousHelperId})...`);

    // Get current associated helpers to build exclusion list
    const currentAssociatedData = await redis.get(`task:${taskId}:associated_helpers`);
    const excludeHelperIds = currentAssociatedData 
      ? (typeof currentAssociatedData === 'string' ? JSON.parse(currentAssociatedData) : currentAssociatedData)
      : [previousHelperId];

    // Find next nearest helper
    const nextHelper = await findNextNearestHelper(taskId, excludeHelperIds);

    if (!nextHelper) {
      console.warn(`⚠️ [ASSOCIATION] No next helper found for task ${taskId}`);
      // Task will remain in queue but without association
      // Remove old association
      await redis.del(`task:${taskId}:associated_helpers`);
      
      // Remove task from previous helper's list
      const helperTasksKey = `helper:${previousHelperId}:associated_tasks`;
      const tasksData = await redis.get(helperTasksKey);
      if (tasksData) {
        const tasks = typeof tasksData === 'string' ? JSON.parse(tasksData) : tasksData;
        const updatedTasks = tasks.filter(id => id !== taskId);
        if (updatedTasks.length > 0) {
          await redis.setex(helperTasksKey, 43200, JSON.stringify(updatedTasks));
        } else {
          await redis.del(helperTasksKey);
        }
      }
      
      return { success: false, reason: "no_helper_found" };
    }

    // Update association in Redis
    await redis.setex(
      `task:${taskId}:associated_helpers`,
      780, // 13 minutes
      JSON.stringify([nextHelper.helperId])
    );

    // Remove task from previous helper's list
    const prevHelperTasksKey = `helper:${previousHelperId}:associated_tasks`;
    const prevTasksData = await redis.get(prevHelperTasksKey);
    if (prevTasksData) {
      const tasks = typeof prevTasksData === 'string' ? JSON.parse(prevTasksData) : prevTasksData;
      const updatedTasks = tasks.filter(id => id !== taskId);
      if (updatedTasks.length > 0) {
        await redis.setex(prevHelperTasksKey, 43200, JSON.stringify(updatedTasks));
      } else {
        await redis.del(prevHelperTasksKey);
      }
    }

    // Add to new helper's associated tasks
    const newHelperTasksKey = `helper:${nextHelper.helperId}:associated_tasks`;
    const existingTasks = await redis.get(newHelperTasksKey);
    let taskIds = existingTasks 
      ? (typeof existingTasks === 'string' ? JSON.parse(existingTasks) : existingTasks)
      : [];
    
    if (!taskIds.includes(taskId)) {
      taskIds.push(taskId);
      await redis.setex(newHelperTasksKey, 43200, JSON.stringify(taskIds));
    }

    console.log(`✅ [ASSOCIATION] Task ${taskId} reassociated with helper ${nextHelper.helperId}`);

    // Set new timeout for this association
    await setAssociationTimeout(taskId, nextHelper.helperId, 50);

    // Get task data from Redis for delivery
    const taskDataStr = await redis.get(`job:${taskId}`);
    if (!taskDataStr) {
      console.warn(`⚠️ [ASSOCIATION] Task ${taskId} not found in Redis for delivery`);
      return { success: true, helper: nextHelper, delivered: false };
    }

    const taskData = typeof taskDataStr === 'string' ? JSON.parse(taskDataStr) : taskDataStr;

    // Deliver task to new helper
    console.log(`📡 [ASSOCIATION] Delivering task to new helper ${nextHelper.helperId}...`);
    try {
      const deliveryResult = await attemptTaskDelivery(
        taskId,
        nextHelper.helperId,
        taskData,
        1
      );

      if (deliveryResult.success) {
        console.log(`✅ [ASSOCIATION] Task delivered to helper ${nextHelper.helperId}`);
      } else {
        console.warn(`⚠️ [ASSOCIATION] Task delivery failed, will retry automatically`);
      }

      return {
        success: true,
        helper: nextHelper,
        delivered: deliveryResult.success,
        deliveryResult,
      };
    } catch (deliveryError) {
      console.error(`❌ [ASSOCIATION] Failed to deliver task:`, deliveryError.message);
      return {
        success: true,
        helper: nextHelper,
        delivered: false,
        error: deliveryError.message,
      };
    }
  } catch (error) {
    console.error(`❌ [ASSOCIATION] Error reassociating task:`, error);
    throw error;
  }
};

/**
 * Process expired association timeouts
 */
const processAssociationTimeouts = async () => {
  try {
    const now = Date.now();

    // Get expired associations
    const expiredAssociations = await redis.zrange("task:association:timeouts", 0, now, { byScore: true });

    if (!expiredAssociations || expiredAssociations.length === 0) {
      return { processed: 0 };
    }

    console.log(`\n⏰ [ASSOCIATION] Processing ${expiredAssociations.length} expired association(s)...`);

    let successCount = 0;
    let failCount = 0;

    for (const member of expiredAssociations) {
      try {
        const data = typeof member === 'string' ? JSON.parse(member) : member;
        const { taskId, helperId } = data;

        console.log(`   Processing timeout: task ${taskId} -> helper ${helperId}`);

        // Check if task still exists and is in queue
        const task = await Task.findByPk(taskId);
        if (!task || task.status !== "in_queue") {
          console.log(`   ⏭️ Task ${taskId} no longer in queue, skipping`);
          await redis.zrem("task:association:timeouts", member);
          continue;
        }

        // Check if task was already accepted by this helper
        if (task.assignedHelperId === helperId) {
          console.log(`   ✅ Task ${taskId} already accepted by helper ${helperId}, skipping`);
          await redis.zrem("task:association:timeouts", member);
          continue;
        }

        // Reassociate with next nearest helper
        const result = await reassociateTask(taskId, helperId);

        if (result.success) {
          successCount++;
          console.log(`   ✅ Task ${taskId} reassociated successfully`);
        } else {
          failCount++;
          console.log(`   ⚠️ Task ${taskId} could not be reassociated: ${result.reason}`);
        }

        // Remove from timeout queue
        await redis.zrem("task:association:timeouts", member);

      } catch (itemError) {
        console.error(`   ❌ Error processing timeout item:`, itemError);
        failCount++;
      }
    }

    console.log(`✅ [ASSOCIATION] Timeout processing complete: ${successCount} success, ${failCount} failed\n`);

    return {
      processed: expiredAssociations.length,
      success: successCount,
      failed: failCount,
    };
  } catch (error) {
    console.error(`❌ [ASSOCIATION] Error processing timeouts:`, error);
    throw error;
  }
};

module.exports = {
  setAssociationTimeout,
  clearAssociationTimeout,
  reassociateTask,
  findNextNearestHelper,
  processAssociationTimeouts,
  ASSOCIATION_TIMEOUT,
};
