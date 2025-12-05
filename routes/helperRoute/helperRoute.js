const express = require("express");
const router = express.Router();
const {
  getAvailabilityStatus,
  toggleAvailability,
  getHelperCompletedTasks,
  getHelperActiveTasks,
  getAvailableHelpersCount,
} = require("../../controllers/helperController/helperController");
const { checkForAuthenticationCookie, checkUserType } = require("../../middleware/authMiddleware");


// Get availability status
router.get(
  "/availability",
  checkForAuthenticationCookie(),
  checkUserType(["helper"]),
  getAvailabilityStatus
);

// Toggle availability
router.patch(
  "/availability",
  checkForAuthenticationCookie(),
  checkUserType(["helper"]),
  toggleAvailability
);


router.get(
  "/available/count",
  checkForAuthenticationCookie(),
  checkUserType(["helpseeker", "admin"]),
  getAvailableHelpersCount
);

// Helper tasks
router.get(
  "/tasks/active",
  checkForAuthenticationCookie(),
  checkUserType(["helper"]),
  getHelperActiveTasks
);

router.get(
  "/:userId/tasks/completed",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker", "admin"]),
  getHelperCompletedTasks
);

module.exports = router;
