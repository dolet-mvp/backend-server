const express = require("express");
const router = express.Router();
const supabaseUpload = require("../../config/uploadConfig/supabaseUpload");

const {
  createTask,
  publishTask,
  scheduleTaskPublish,
  cancelScheduledPublish,
  getMyTasks,
  getTaskById,
  getNearbyHelpers,
  updateTask,
  cancelTask,
  increaseReward,
  approveHelperRequest,
  rejectHelperRequest,
  regenerateOTP,
  getTasksWithPendingHelpers,
  getPendingHelperForTask,
} = require("../../controllers/taskController/helpseekerTaskController");

const { authorizeRoles } = require("../../middleware/roleMiddleware");


// Create a new task
router.post(
  "/create",
  authorizeRoles(["helpseeker"]),
  supabaseUpload.array("attachments", 5),
  createTask
);

// Update a draft task
router.put(
  "/:taskId",
  authorizeRoles(["helpseeker"]),
  supabaseUpload.array("attachments", 5),
  updateTask
);

// Publish a task to the queue
router.post(
  "/:taskId/publish",
  authorizeRoles(["helpseeker"]),
  publishTask
);

// Schedule a task to be published at specific date/time
router.post(
  "/:taskId/schedule-publish",
  authorizeRoles(["helpseeker"]),
  scheduleTaskPublish
);

// Cancel scheduled publish
router.delete(
  "/:taskId/cancel-schedule",
  authorizeRoles(["helpseeker"]),
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


// Get tasks with pending helper requests
router.get(
  "/pending-helpers",
  authorizeRoles(["helpseeker","helper"]),
  getTasksWithPendingHelpers
);

// Get pending helper for a specific task
router.get(
  "/:taskId/pending-helper",
  authorizeRoles(["helpseeker"]),
  getPendingHelperForTask
);


// Approve helper's request to accept task (generates OTP)
router.post(
  "/:taskId/approve-helper",
  authorizeRoles(["helpseeker"]),
  approveHelperRequest
);

// Reject helper's request to accept task
router.post(
  "/:taskId/reject-helper",
  authorizeRoles(["helpseeker"]),
  rejectHelperRequest
);

// Regenerate OTP for assigned task
router.post(
  "/:taskId/regenerate-otp",
  authorizeRoles(["helpseeker"]),
  regenerateOTP
);

module.exports = router;
