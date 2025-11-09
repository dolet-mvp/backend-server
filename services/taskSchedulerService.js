const cron = require("node-cron");
const { Op } = require("sequelize");
const Task = require("../models/taskModel/taskModel");
const TaskQueue = require("../models/queueModel/queueModel");
const Helper = require("../models/authModel/helperModel");
const Notification = require("../models/notificationModel/notificationModel");

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
    console.log(`    Added to queue at position: ${queueEntry.queuePosition}`);

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
    console.log(`    Sent ${notifications.length} notification(s) to helpers`);

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
    console.log(`    Notified helpseeker (${task.helpseekerId})`);

    console.log(`    Task ${task.id} published successfully!\n`);
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


const initTaskScheduler = () => {
  console.log("\n⏰ [SCHEDULER] Initializing task scheduler...");
  console.log("   Schedule: Every minute (*/1 * * * *)");
  console.log("   Purpose: Auto-publish scheduled tasks");
  
  // Run every minute: '* * * * *'
  cron.schedule("* * * * *", async () => {
    await checkScheduledTasks();
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
  getUpcomingScheduledTasksCount,
};
