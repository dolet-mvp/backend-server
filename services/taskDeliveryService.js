const TaskDeliveryAcknowledgment = require("../models/taskModel/taskDeliveryAcknowledgmentModel");
const { sendToUser } = require("./pushNotificationService");
const { emitToUser, isUserConnected } = require("./socketService");
const redis = require("../config/redis/redis");


const RETRY_DELAYS = [2000, 5000, 8000, 15000, 30000]; // in milliseconds
const MAX_RETRY_ATTEMPTS = RETRY_DELAYS.length;
/**
 * Create initial delivery tracking record for a task-helper pair
 */
const createDeliveryRecord = async (taskId, helperId, deliveryMethod = "both") => {
  try {
    const [record, created] = await TaskDeliveryAcknowledgment.findOrCreate({
      where: { taskId, helperId },
      defaults: {
        deliveryStatus: "pending",
        attemptCount: 0,
        deliveryMethod,
        nextRetryAt: new Date(Date.now() + RETRY_DELAYS[0]),
      },
    });

    console.log(`📝 [DELIVERY] ${created ? 'Created' : 'Found existing'} delivery record for task ${taskId} -> helper ${helperId}`);
    return record;
  } catch (error) {
    console.error(`❌ [DELIVERY] Error creating delivery record:`, error);
    throw error;
  }
};

/**
 * Attempt to deliver task to helper via socket and/or push notification
 */
const attemptTaskDelivery = async (taskId, helperId, taskData, attemptNumber = 0) => {
  try {
    console.log(`🚀 [DELIVERY] Attempt #${attemptNumber + 1} to deliver task ${taskId} to helper ${helperId}`);

    // Get delivery record
    let deliveryRecord = await TaskDeliveryAcknowledgment.findOne({
      where: { taskId, helperId },
    });

    if (!deliveryRecord) {
      deliveryRecord = await createDeliveryRecord(taskId, helperId);
    }

    // Check if already acknowledged
    if (deliveryRecord.deliveryStatus === "acknowledged") {
      console.log(`✅ [DELIVERY] Task ${taskId} already acknowledged by helper ${helperId}`);
      return { success: true, acknowledged: true };
    }

    // Check if max retries exceeded
    if (deliveryRecord.attemptCount >= MAX_RETRY_ATTEMPTS) {
      console.warn(`⚠️ [DELIVERY] Max retry attempts (${MAX_RETRY_ATTEMPTS}) exceeded for task ${taskId} -> helper ${helperId}`);
      await deliveryRecord.update({
        deliveryStatus: "failed",
        errorMessage: `Maximum retry attempts (${MAX_RETRY_ATTEMPTS}) exceeded`,
      });
      return { success: false, maxRetriesExceeded: true };
    }

    const deliveryResults = {
      socket: false,
      push: false,
    };

    // Update attempt count and timestamp
    await deliveryRecord.update({
      attemptCount: deliveryRecord.attemptCount + 1,
      lastAttemptAt: new Date(),
    });

    // Try socket delivery if helper is connected
    try {
      const isConnected = isUserConnected(helperId);
      console.log(`🔌 [DELIVERY] Helper ${helperId} connection status: ${isConnected ? 'CONNECTED' : 'NOT CONNECTED'}`);

      if (isConnected) {
        console.log(`📡 [DELIVERY] Sending task via socket to helper ${helperId}...`);
        
        // Add acknowledgment request to payload
        const socketPayload = {
          ...taskData,
          requiresAcknowledgment: true,
          deliveryAttempt: deliveryRecord.attemptCount,
          deliveryRecordId: deliveryRecord.id,
        };

        emitToUser(helperId, "helper", "newJobAvailable", socketPayload);
        deliveryResults.socket = true;
        console.log(`✅ [DELIVERY] Socket delivery sent to helper ${helperId}`);
      } else {
        console.log(`⚠️ [DELIVERY] Helper ${helperId} not connected via socket`);
      }
    } catch (socketError) {
      console.error(`❌ [DELIVERY] Socket delivery failed:`, socketError.message);
      deliveryResults.socket = false;
    }

    // Only send push notification if socket delivery failed
    if (!deliveryResults.socket) {
      try {
        console.log(`📲 [DELIVERY] Sending push notification to helper ${helperId} (socket failed)...`);
        await sendToUser(
          helperId,
          "helper",
          {
            title: "New Task Available Near You!",
            body: `${taskData.title} - ₹${taskData.budget}`,
          },
          {
            type: "task_available",
            taskId: taskId.toString(),
            requiresAcknowledgment: "true",
            deliveryAttempt: deliveryRecord.attemptCount.toString(),
            deliveryRecordId: deliveryRecord.id.toString(),
          }
        );
        deliveryResults.push = true;
        console.log(`✅ [DELIVERY] Push notification sent to helper ${helperId}`);
      } catch (pushError) {
        console.error(`❌ [DELIVERY] Push notification failed:`, pushError.message);
        deliveryResults.push = false;
      }
    } else {
      console.log(`⏭️ [DELIVERY] Skipping push notification (socket delivery succeeded)`);
      deliveryResults.push = false;
    }

    // Update delivery status
    if (deliveryResults.socket || deliveryResults.push) {
      await deliveryRecord.update({
        deliveryStatus: "delivered",
        metadata: {
          ...deliveryRecord.metadata,
          lastDeliveryMethods: deliveryResults,
          attemptTimestamp: new Date().toISOString(),
        },
      });

      // Schedule next retry with exponential backoff
      const nextDelayIndex = Math.min(deliveryRecord.attemptCount, RETRY_DELAYS.length - 1);
      const nextRetryDelay = RETRY_DELAYS[nextDelayIndex];
      const nextRetryAt = new Date(Date.now() + nextRetryDelay);

      await deliveryRecord.update({
        nextRetryAt,
      });

      // Store retry info in Redis for background processing
      await redis.zadd("task:delivery:retry_queue", {
        score: nextRetryAt.getTime(),
        member: JSON.stringify({ taskId, helperId, attemptNumber: deliveryRecord.attemptCount }),
      });

      console.log(`⏰ [DELIVERY] Next retry scheduled at ${nextRetryAt.toISOString()} (${nextRetryDelay / 1000}s from now)`);

      return { success: true, deliveryResults, nextRetryAt };
    } else {
      await deliveryRecord.update({
        deliveryStatus: "pending",
        errorMessage: "All delivery methods failed",
      });

      console.error(`❌ [DELIVERY] All delivery methods failed for task ${taskId} -> helper ${helperId}`);
      return { success: false, deliveryResults };
    }
  } catch (error) {
    console.error(`❌ [DELIVERY] Error during task delivery attempt:`, error);
    throw error;
  }
};

/**
 * Process acknowledgment from helper
 */
const acknowledgeTaskDelivery = async (taskId, helperId, metadata = {}) => {
  try {
    console.log(`✅ [DELIVERY] Processing acknowledgment for task ${taskId} from helper ${helperId}`);

    const deliveryRecord = await TaskDeliveryAcknowledgment.findOne({
      where: { taskId, helperId },
    });

    if (!deliveryRecord) {
      console.warn(`⚠️ [DELIVERY] No delivery record found for task ${taskId} -> helper ${helperId}`);
      return { success: false, message: "No delivery record found" };
    }

    if (deliveryRecord.deliveryStatus === "acknowledged") {
      console.log(`ℹ️ [DELIVERY] Task ${taskId} already acknowledged by helper ${helperId}`);
      return { success: true, message: "Already acknowledged", alreadyAcknowledged: true };
    }

    // Update delivery record to acknowledged
    await deliveryRecord.update({
      deliveryStatus: "acknowledged",
      acknowledgedAt: new Date(),
      metadata: {
        ...deliveryRecord.metadata,
        acknowledgmentMetadata: metadata,
      },
    });

    // Remove from retry queue
    try {
      const retryQueueMembers = await redis.zrange("task:delivery:retry_queue", 0, -1);
      for (const member of retryQueueMembers) {
        try {
          const data = typeof member === 'string' ? JSON.parse(member) : member;
          if (data.taskId === taskId && data.helperId === helperId) {
            await redis.zrem("task:delivery:retry_queue", typeof member === 'string' ? member : JSON.stringify(member));
            console.log(`🗑️ [DELIVERY] Removed from retry queue: task ${taskId} -> helper ${helperId}`);
            break;
          }
        } catch (parseError) {
          console.warn(`⚠️ [DELIVERY] Failed to parse retry queue member:`, parseError.message);
        }
      }
    } catch (redisError) {
      console.error(`⚠️ [DELIVERY] Failed to remove from retry queue:`, redisError.message);
    }

    console.log(`✅ [DELIVERY] Task ${taskId} acknowledged by helper ${helperId} after ${deliveryRecord.attemptCount} attempt(s)`);

    return {
      success: true,
      message: "Acknowledgment recorded",
      attemptCount: deliveryRecord.attemptCount,
      acknowledgedAt: deliveryRecord.acknowledgedAt,
    };
  } catch (error) {
    console.error(`❌ [DELIVERY] Error processing acknowledgment:`, error);
    throw error;
  }
};


const processRetryQueue = async () => {
  try {
    const now = Date.now();
    
    // Get tasks that are due for retry (Upstash Redis REST API compatible)
    const dueRetries = await redis.zrange("task:delivery:retry_queue", 0, now, { byScore: true });

    if (!dueRetries || dueRetries.length === 0) {
      return { processed: 0 };
    }

    console.log(`🔄 [DELIVERY] Processing ${dueRetries.length} due retries...`);

    let successCount = 0;
    let failCount = 0;

    for (const member of dueRetries) {
      try {
        // Handle both string and object from Upstash Redis
        const memberData = typeof member === 'string' ? JSON.parse(member) : member;
        const { taskId, helperId, attemptNumber } = memberData;

        // Check if still needs retry (not acknowledged)
        const deliveryRecord = await TaskDeliveryAcknowledgment.findOne({
          where: { taskId, helperId },
        });

        if (!deliveryRecord || deliveryRecord.deliveryStatus === "acknowledged") {
          // Already acknowledged, remove from queue
          await redis.zrem("task:delivery:retry_queue", member);
          console.log(`✅ [DELIVERY] Skipping retry - already acknowledged: task ${taskId} -> helper ${helperId}`);
          continue;
        }

        // Get task data from Redis
        const taskDataStr = await redis.get(`job:${taskId}`);
        if (!taskDataStr) {
          console.warn(`⚠️ [DELIVERY] Task ${taskId} not found in Redis, removing from retry queue`);
          await redis.zrem("task:delivery:retry_queue", member);
          await deliveryRecord.update({
            deliveryStatus: "failed",
            errorMessage: "Task data not found in Redis",
          });
          failCount++;
          continue;
        }

        const taskData = typeof taskDataStr === 'string' ? JSON.parse(taskDataStr) : taskDataStr;

        // Attempt delivery
        const result = await attemptTaskDelivery(taskId, helperId, taskData, attemptNumber);

        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }

        // Remove current retry from queue (new retry will be scheduled if needed)
        await redis.zrem("task:delivery:retry_queue", member);

      } catch (itemError) {
        console.error(`❌ [DELIVERY] Error processing retry item:`, itemError);
        failCount++;
      }
    }

    console.log(`✅ [DELIVERY] Retry processing complete: ${successCount} success, ${failCount} failed`);

    return {
      processed: dueRetries.length,
      success: successCount,
      failed: failCount,
    };
  } catch (error) {
    console.error(`❌ [DELIVERY] Error processing retry queue:`, error);
    throw error;
  }
};

/**
 * Get delivery status for a task-helper pair
 */
const getDeliveryStatus = async (taskId, helperId) => {
  try {
    const deliveryRecord = await TaskDeliveryAcknowledgment.findOne({
      where: { taskId, helperId },
    });

    if (!deliveryRecord) {
      return {
        found: false,
        message: "No delivery record found",
      };
    }

    return {
      found: true,
      status: deliveryRecord.deliveryStatus,
      attemptCount: deliveryRecord.attemptCount,
      lastAttemptAt: deliveryRecord.lastAttemptAt,
      acknowledgedAt: deliveryRecord.acknowledgedAt,
      nextRetryAt: deliveryRecord.nextRetryAt,
      metadata: deliveryRecord.metadata,
    };
  } catch (error) {
    console.error(`❌ [DELIVERY] Error getting delivery status:`, error);
    throw error;
  }
};

/**
 * Get all pending deliveries for monitoring
 */
const getPendingDeliveries = async () => {
  try {
    const pendingDeliveries = await TaskDeliveryAcknowledgment.findAll({
      where: {
        deliveryStatus: ["pending", "delivered"],
      },
      order: [["nextRetryAt", "ASC"]],
    });

    return pendingDeliveries;
  } catch (error) {
    console.error(`❌ [DELIVERY] Error getting pending deliveries:`, error);
    throw error;
  }
};

module.exports = {
  createDeliveryRecord,
  attemptTaskDelivery,
  acknowledgeTaskDelivery,
  processRetryQueue,
  getDeliveryStatus,
  getPendingDeliveries,
  RETRY_DELAYS,
  MAX_RETRY_ATTEMPTS,
};
