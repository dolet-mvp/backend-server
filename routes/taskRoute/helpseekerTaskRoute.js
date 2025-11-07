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

const { checkUserType,checkForAuthenticationCookie } = require("../../middleware/authMiddleware");


// Create a new task
router.post(
  "/create",
  checkForAuthenticationCookie(),
  checkUserType(["helpseeker", "helper"]),
  supabaseUpload.array("attachments", 5),
  createTask
);

// Update a draft task
router.put(
  "/:taskId",
  checkForAuthenticationCookie(),
  checkUserType(["helpseeker", "helper"]),
  supabaseUpload.array("attachments", 5),
  updateTask
);

// Publish a task to the queue
router.post(
  "/:taskId/publish",
  checkForAuthenticationCookie(),
  checkUserType(["helpseeker", "helper"]),
  publishTask
);

// Schedule a task to be published at specific date/time
router.post(
  "/:taskId/schedule-publish",
  checkForAuthenticationCookie(),
  checkUserType(["helpseeker", "helper"]),
  scheduleTaskPublish
);

// Cancel scheduled publish
router.delete(
  "/:taskId/cancel-schedule",
  checkForAuthenticationCookie(),
  checkUserType(["helpseeker", "helper"]),
  cancelScheduledPublish
);

// Get all tasks created by the helpseeker
router.get(
  "/my-tasks",
  checkForAuthenticationCookie(),
  checkUserType(["helpseeker", "helper"]),
  getMyTasks
);

// Get nearby helpers within radius
router.get(
  "/nearby-helpers",
  checkForAuthenticationCookie(),
  checkUserType(["helpseeker", "helper"]),
  getNearbyHelpers
);


// Cancel a task
router.delete(
  "/:taskId/cancel",
  checkForAuthenticationCookie(),
  checkUserType(["helpseeker", "helper"]),
  cancelTask
);

// Increase task reward/budget
router.patch(
  "/:taskId/increase-reward",
  checkForAuthenticationCookie(),
  checkUserType(["helpseeker", "helper"]),
  increaseReward
);

// Regenerate OTP for assigned task
router.post(
  "/:taskId/regenerate-otp",
  checkForAuthenticationCookie(),
  checkUserType(["helpseeker"]),
  regenerateOTP
);

module.exports = router;
