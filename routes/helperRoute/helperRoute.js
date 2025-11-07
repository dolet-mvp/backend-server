const express = require("express");
const router = express.Router();
const {
  toggleAvailability,
  getHelperCompletedTasks,
  getHelperActiveTasks,
  getAvailableHelpersCount,
} = require("../../controllers/helperController/helperController");
const { checkForAuthenticationCookie, checkUserType } = require("../../middleware/authMiddleware");




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
