const express = require("express");
const router = express.Router();

const {
  getAvailableTasks,
  requestToAcceptTask,
  verifyOTPAndStartTask,
  cancelAcceptanceRequest,
} = require("../../controllers/taskController/helperTaskController");

const { authorizeRoles } = require("../../middleware/roleMiddleware");



router.get(
  "/available",
  authorizeRoles(["helper","helpseeker"]),
  getAvailableTasks
);

// Request to accept a task (Step 1 of approval process)
router.post(
  "/:taskId/request-accept",
  authorizeRoles(["helper","helpseeker"]),
  requestToAcceptTask
);

// Verify OTP and start task (Step 3 of approval process)
router.post(
  "/:taskId/verify-otp",
  authorizeRoles(["helper","helpseeker"]),
  verifyOTPAndStartTask
);

// Cancel acceptance request
router.delete(
  "/:taskId/cancel-request",
  authorizeRoles(["helper","helpseeker"]),
  cancelAcceptanceRequest
);

module.exports = router;
