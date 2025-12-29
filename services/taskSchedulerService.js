const cron = require("node-cron");
const { Op } = require("sequelize");
const Task = require("../models/taskModel/taskModel");
const TaskQueue = require("../models/queueModel/queueModel");
const Helper = require("../models/authModel/helperModel");
const Notification = require("../models/notificationModel/notificationModel");
const redis = require("../config/redis/redis");

const publishScheduledTask = async (task) => {
  try {
    console.log(`\n📅 [SCHEDULER] Publishing scheduled task: ${task.id} - ${task.title}`);
    console.log(`   Current status: ${task.status}`);
    console.log(`   Scheduled for: ${task.scheduledPublishAt}`);

    // Update task status to in_queue
    task.status = "in_queue";
    task.isScheduled = false;
    task.publishedAt = new Date();
    await task.save();
    console.log(`   ✅ Task status updated to: in_queue`);

    const queueCount = await TaskQueue.count();
    console.log(`   Current queue count: ${queueCount}`);

    // Add to queue
    const queueEntry = await TaskQueue.create({
      taskId: task.id,
      queuePosition: queueCount + 1,
      priority: task.priority === "urgent" ? 10 : task.priority === "high" ? 5 : 0,
    });
    console.log(`   ✅ Added to queue at position: ${queueEntry.queuePosition}`);

    // Store the published job in Redis
    try {
      const jobData = {
        taskId: task.id,
        helpseekerId: task.helpseekerId,
        title: task.title,
        description: task.description,
        category: task.category,
        budget: task.budget,
        estimatedDuration: task.estimatedDuration,
        priority: task.priority,
        locationRequired: task.locationRequired,
        location: task.location,
        status: task.status,
        queuePosition: queueEntry.queuePosition,
        publishedAt: task.publishedAt.toISOString(),
        wasScheduled: true,
      };
      
      // Store in Redis with key format: job:taskId
      // Set expiration to 30 days (in seconds)
      await redis.set(`job:${task.id}`, jobData);
      await redis.expire(`job:${task.id}`, 2592000);
      
      // Also add to sorted set for easy retrieval of all jobs
      await redis.zadd('jobs:published', {
        score: Date.now(),
        member: `job:${task.id}`,
      });
      
      console.log(`   ✅ Job ${task.id} stored in Redis successfully`);
    } catch (redisError) {
      console.error(`   ⚠️ Failed to store job in Redis:`, redisError);
      // Continue execution even if Redis fails
    }

    // Notify available helpers
    const helpers = await Helper.findAll({
      where: { 
        verificationStatus: "approved",
       // isAvailable: true 
      },
    });
    console.log(`   Found ${helpers.length} approved helper(s) to notify`);

    const notifications = helpers.map((helper) => ({
      helperId: helper.id,
      userType: "helper",
      taskId: task.id,
      title: "New Task Available",
      message: `New task: ${task.title}`,
      type: "task_created",
      priority: task.priority,
    }));

    await Notification.bulkCreate(notifications);
    console.log(`   ✅ Sent ${notifications.length} notification(s) to helpers`);

    // Notify task creator (helpseeker)
    await Notification.create({
      helpseekerId: task.helpseekerId,
      userType: "helpseeker",
      taskId: task.id,
      title: "Task Published",
      message: `Your scheduled task "${task.title}" has been published successfully`,
      type: "task_created",
      priority: "high",
    });
    console.log(`   ✅ Notified helpseeker (${task.helpseekerId})`);

    console.log(`   ✅ Task ${task.id} published successfully!\n`);
  } catch (error) {
    console.error(`   ❌ Error publishing scheduled task ${task.id}:`, error);
  }
};


const checkScheduledTasks = async () => {
  try {
    const now = new Date();
    console.log(`\n🔍 [SCHEDULER] Checking for scheduled tasks...`);
    console.log(`   Current time:`);
    console.log(`      UTC: ${now.toISOString()}`);
    console.log(`      IST: ${now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);

    // Debug: Check all scheduled tasks first
    const allScheduledTasks = await Task.findAll({
      where: {
        status: "draft",
        isScheduled: true,
      },
      attributes: ['id', 'title', 'scheduledPublishAt'],
    });

    console.log(`   📋 Total scheduled tasks in DB: ${allScheduledTasks.length}`);
    if (allScheduledTasks.length > 0) {
      allScheduledTasks.forEach((task, index) => {
        const scheduledTime = new Date(task.scheduledPublishAt);
        const isPast = scheduledTime <= now;
        console.log(`      ${index + 1}. "${task.title}"`);
        console.log(`         Scheduled UTC: ${scheduledTime.toISOString()}`);
        console.log(`         Scheduled IST: ${scheduledTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
        console.log(`         Status: ${isPast ? '✅ (Ready to publish)' : '⏰ (Future)'}`);
      });
    }

    // Find all tasks scheduled to be published now or in the past
    const tasksToPublish = await Task.findAll({
      where: {
        status: "draft",
        isScheduled: true,
        scheduledPublishAt: {
          [Op.lte]: now, // Less than or equal to current time
        },
      },
    });

    if (tasksToPublish.length > 0) {
      console.log(`\n   ✅ Found ${tasksToPublish.length} scheduled task(s) ready to publish:`);
      
      tasksToPublish.forEach((task, index) => {
        console.log(`      ${index + 1}. "${task.title}" (ID: ${task.id})`);
      });

      for (const task of tasksToPublish) {
        await publishScheduledTask(task);
      }
    } else {
      console.log(`\n   ℹ️  No scheduled tasks ready to publish at this time`);
    }
  } catch (error) {
    console.error("   ❌ Error checking scheduled tasks:", error);
  }
};

// Check and delete unaccepted tasks after 13 minutes
const checkUnacceptedTasks = async () => {
  try {
    const now = new Date();
    const thirteenMinutesAgo = new Date(now.getTime() - 13 * 60 * 1000);

    console.log(`\n🕐 [AUTO-CLEANUP] Checking for unaccepted tasks older than 13 minutes...`);

    // Find tasks in queue/published status that haven't been accepted for 13+ minutes
    const unacceptedTasks = await Task.findAll({
      where: {
        status: "in_queue",
        assignedHelperId: null, // No helper assigned yet
        publishedAt: {
          [Op.lte]: thirteenMinutesAgo, // Published 13+ minutes ago
        },
      },
    });

    if (unacceptedTasks.length > 0) {
      console.log(`   🗑️ Found ${unacceptedTasks.length} unaccepted task(s) to auto-delete:`);

      for (const task of unacceptedTasks) {
        try {
          const taskAge = Math.floor((now - new Date(task.publishedAt)) / 60000);
          console.log(`      - Task "${task.title}" (ID: ${task.id}, Age: ${taskAge} min)`);

          // Update task status to cancelled
          task.status = "cancelled";
          await task.save();

          // Remove from TaskQueue
          await TaskQueue.destroy({ where: { taskId: task.id } });

          // Clean up Redis
          try {
            // Get associated helpers before cleanup
            const associatedHelpersData = await redis.get(`task:${task.id}:associated_helpers`);
            let associatedHelperIds = [];
            
            if (associatedHelpersData) {
              associatedHelperIds = typeof associatedHelpersData === 'string' 
                ? JSON.parse(associatedHelpersData) 
                : associatedHelpersData;
            }

            // Remove task from Redis
            await Promise.all([
              redis.del(`job:${task.id}`),
              redis.zrem('jobs:published', task.id),
              redis.del(`task:${task.id}:associated_helpers`),
              redis.del(`task:${task.id}:actions`),
            ]);

            // Remove task from each helper's associated tasks
            const cleanupPromises = associatedHelperIds.map(async (helperId) => {
              const helperTasksKey = `helper:${helperId}:associated_tasks`;
              const tasksData = await redis.get(helperTasksKey);
              if (tasksData) {
                const tasks = typeof tasksData === 'string' ? JSON.parse(tasksData) : tasksData;
                const updatedTasks = tasks.filter(id => id !== task.id);
                if (updatedTasks.length > 0) {
                  await redis.setex(helperTasksKey, 43200, JSON.stringify(updatedTasks));
                } else {
                  await redis.del(helperTasksKey);
                }
              }
            });
            await Promise.all(cleanupPromises);

            console.log(`         ✅ Removed from Redis and TaskQueue`);
          } catch (redisError) {
            console.warn(`         ⚠️ Redis cleanup failed:`, redisError.message);
          }

          // Notify helpseeker
          try {
            await Notification.create({
              helpseekerId: task.helpseekerId,
              userType: "helpseeker",
              taskId: task.id,
              title: "Task Auto-Cancelled",
              message: `Your task "${task.title}" was automatically cancelled as no helper accepted it within 13 minutes`,
              type: "general",
              priority: "medium",
            });
            console.log(`         ✅ Notified helpseeker`);
          } catch (notifyError) {
            console.warn(`         ⚠️ Notification failed:`, notifyError.message);
          }
        } catch (taskError) {
          console.error(`      ❌ Failed to delete task ${task.id}:`, taskError.message);
        }
      }
    } else {
      console.log(`   ✅ No unaccepted tasks found older than 13 minutes`);
    }
  } catch (error) {
    console.error("   ❌ Error checking unaccepted tasks:", error);
  }
};


const initTaskScheduler = () => {
  console.log("\n⏰ [SCHEDULER] Initializing task scheduler...");
  console.log("   Schedule: Every minute (*/1 * * * *)");
  console.log("   Purpose: Auto-publish scheduled tasks & auto-cleanup unaccepted tasks");
  
  // Run every minute: '* * * * *'
  cron.schedule("* * * * *", async () => {
    await checkScheduledTasks();
    await checkUnacceptedTasks();
  });

  console.log("   ✅ Task scheduler is now active and running!\n");
};


const getUpcomingScheduledTasksCount = async () => {
  try {
    const count = await Task.count({
      where: {
        status: "draft",
        isScheduled: true,
        scheduledPublishAt: {
          [Op.gt]: new Date(),
        },
      },
    });
    return count;
  } catch (error) {
    console.error("Error getting scheduled tasks count:", error);
    return 0;
  }
};

module.exports = {
  initTaskScheduler,
  checkScheduledTasks,
  checkUnacceptedTasks,
  getUpcomingScheduledTasksCount,
};
