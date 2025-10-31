const express = require("express");
const router = express.Router();
const supabaseUpload = require("../../config/uploadConfig/supabaseUpload");

const {
  createTask,
  publishTask,
  scheduleTaskPublish,
  cancelScheduledPublish,
  getMyTasks,
  getNearbyHelpers,
  updateTask,
  cancelTask,
  increaseReward,
  regenerateOTP,
} = require("../../controllers/taskController/helpseekerTaskController");

const { authorizeRoles } = require("../../middleware/roleMiddleware");


// Create a new task
router.post(
  "/create",
  authorizeRoles(["helpseeker","helper"]),
  supabaseUpload.array("attachments", 5),
  createTask
);

// Update a draft task
router.put(
  "/:taskId",
  authorizeRoles(["helpseeker","helper"]),
  supabaseUpload.array("attachments", 5),
  updateTask
);

// Publish a task to the queue
router.post(
  "/:taskId/publish",
  authorizeRoles(["helpseeker","helper"]),
  publishTask
);

// Schedule a task to be published at specific date/time
router.post(
  "/:taskId/schedule-publish",
  authorizeRoles(["helpseeker","helper"]),
  scheduleTaskPublish
);

// Cancel scheduled publish
router.delete(
  "/:taskId/cancel-schedule",
  authorizeRoles(["helpseeker","helper"]),
  cancelScheduledPublish
);

// Get all tasks created by the helpseeker
router.get(
  "/my-tasks",
  authorizeRoles(["helpseeker","helper"]),
  getMyTasks
);

// Get nearby helpers within radius
router.get(
  "/nearby-helpers",
  authorizeRoles(["helpseeker","helper"]),
  getNearbyHelpers
);

// Note: /:taskId route is defined in taskRoute.js (commonTaskController)
// to avoid routing conflicts with specific routes like /available

// Cancel a task
router.delete(
  "/:taskId/cancel",
  authorizeRoles(["helpseeker","helper"
  ]),
  cancelTask
);

// Increase task reward/budget
router.patch(
  "/:taskId/increase-reward",
  authorizeRoles(["helpseeker","helper"]),
  increaseReward
);


// Regenerate OTP for assigned task
router.post(
  "/:taskId/regenerate-otp",
  authorizeRoles(["helpseeker"]),
  regenerateOTP
);

// Note: Helper approval/rejection routes removed - helpers now accept tasks directly
// OTP is automatically generated when helper accepts the task

module.exports = router;
