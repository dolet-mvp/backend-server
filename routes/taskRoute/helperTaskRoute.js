const express = require("express");
const router = express.Router();

const {
  getAvailableTasks,
  acceptTask,
  rejectTask,
  updateRejectionReason,
  passTask,
  verifyOTPAndStartTask,
  getMyAcceptedTasks,
  getMyTaskDetails,
} = require("../../controllers/taskController/helperTaskController");

const { checkForAuthenticationCookie, checkUserType } = require("../../middleware/authMiddleware");

// Get available tasks for helper
router.get(
  "/available",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  getAvailableTasks
);

// Accept task directly (generates OTP and assigns to helper)
router.post(
  "/:taskId/accept",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  acceptTask
);

// Reject task immediately (reason is optional, can be added later)
router.post(
  "/:taskId/reject",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  rejectTask
);

// Update rejection reason later
router.patch(
  "/:taskId/reject/reason",
  checkForAuthenticationCookie(),
  checkUserType(["helper"]),
  updateRejectionReason
);

// Pass on a task (skip without explicit rejection)
router.post(
  "/:taskId/pass",
  checkForAuthenticationCookie(),
  checkUserType(["helper"]),
  passTask
);

// Verify OTP and start task
router.post(
  "/:taskId/verify-otp",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  verifyOTPAndStartTask
);

router.get(
  "/helper/my-tasks",
  checkForAuthenticationCookie(),
  checkUserType(["helper"]),
  getMyAcceptedTasks
);


router.get(
  "/helper/my-tasks/:taskId",
  checkForAuthenticationCookie(),
  checkUserType(["helper"]),
  getMyTaskDetails
);

module.exports = router;
