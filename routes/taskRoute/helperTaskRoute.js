const express = require("express");
const router = express.Router();

const {
  getAvailableTasks,
  acceptTask,
  rejectTask,
  verifyOTPAndStartTask,
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

// Reject task with reason
router.post(
  "/:taskId/reject",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  rejectTask
);

// Verify OTP and start task
router.post(
  "/:taskId/verify-otp",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  verifyOTPAndStartTask
);

module.exports = router;
