const cron = require("node-cron");
const { Op } = require("sequelize");
const Task = require("../models/taskModel/taskModel");
const TaskQueue = require("../models/queueModel/queueModel");
const Helper = require("../models/authModel/helperModel");
const Notification = require("../models/notificationModel/notificationModel");

const publishScheduledTask = async (task) => {
  try {
    console.log(`Publishing scheduled task: ${task.id} - ${task.title}`);

    // Update task status to in_queue
    task.status = "in_queue";
    task.isScheduled = false;
    task.publishedAt = new Date();
    await task.save();

    const queueCount = await TaskQueue.count();

    // Add to queue
    const queueEntry = await TaskQueue.create({
      taskId: task.id,
      queuePosition: queueCount + 1,
      priority: task.priority === "urgent" ? 10 : task.priority === "high" ? 5 : 0,
    });

    // Notify available helpers
    const helpers = await Helper.findAll({
      where: { 
        verificationStatus: "approved",
        isAvailable: true 
      },
    });

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

    // Notify task creator (helpseeker)
    await Notification.create({
      helpseekerId: task.helpseekerId,
      userType: "helpseeker",
      taskId: task.id,
      title: "Task Published",
      message: `Your scheduled task "${task.title}" has been published successfully`,
      type: "task_update",
      priority: "high",
    });

    console.log(` Task ${task.id} published successfully. Queue position: ${queueEntry.queuePosition}`);
  } catch (error) {
    console.error(` Error publishing scheduled task ${task.id}:`, error);
  }
};


const checkScheduledTasks = async () => {
  try {
    const now = new Date();

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
      console.log(` Found ${tasksToPublish.length} scheduled task(s) to publish`);

      for (const task of tasksToPublish) {
        await publishScheduledTask(task);
      }
    }
  } catch (error) {
    console.error(" Error checking scheduled tasks:", error);
  }
};


const initTaskScheduler = () => {
  // Run every minute: '* * * * *'
  cron.schedule("* * * * *", async () => {
    await checkScheduledTasks();
  });

  console.log(" Task scheduler initialized - checking every minute");
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
