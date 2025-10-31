const express = require("express");
const router = express.Router();

const {
  getAvailableTasks,
  acceptTask,
  rejectTask,
  verifyOTPAndStartTask,
} = require("../../controllers/taskController/helperTaskController");

const { authorizeRoles } = require("../../middleware/roleMiddleware");

// Get available tasks for helper
router.get(
  "/available",
  authorizeRoles(["helper","helpseeker"]),
  getAvailableTasks
);

// Accept task directly (generates OTP and assigns to helper)
router.post(
  "/:taskId/accept",
  authorizeRoles(["helper","helpseeker"]),
  acceptTask
);

// Reject task with reason
router.post(
  "/:taskId/reject",
  authorizeRoles(["helper","helpseeker"]),
  rejectTask
);

// Verify OTP and start task
router.post(
  "/:taskId/verify-otp",
  authorizeRoles(["helper","helpseeker"]),
  verifyOTPAndStartTask
);

module.exports = router;
