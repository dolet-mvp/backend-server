const express = require("express");
const router = express.Router();
const supabaseUpload = require("../../config/uploadConfig/supabaseUpload");
const {
  updateHelperProfile,
  getHelperProfile,
  getMyHelperProfile,
  toggleAvailability,
  searchHelpers,
  getHelperCompletedTasks,
  getHelperActiveTasks,
  getAvailableHelpersCount,
} = require("../../controllers/helperController/helperController");
const { checkForAuthenticationCookie, checkUserType } = require("../../middleware/authMiddleware");

// Helper profile management
router.patch(
  "/profile",
  checkForAuthenticationCookie(),
  checkUserType(["helper"]),
  supabaseUpload.array("documents", 10),
  updateHelperProfile
);

router.get(
  "/profile/me",
  checkForAuthenticationCookie(),
  checkUserType(["helper"]),
  getMyHelperProfile
);

router.get(
  "/profile/:userId",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker", "admin"]),
  getHelperProfile
);

router.patch(
  "/availability",
  checkForAuthenticationCookie(),
  checkUserType(["helper"]),
  toggleAvailability
);

// Helper search
router.get(
  "/search",
  checkForAuthenticationCookie(),
  checkUserType(["helpseeker", "admin"]),
  searchHelpers
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
