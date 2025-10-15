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

// Helper profile management
router.patch("/profile", supabaseUpload.array("documents", 10), updateHelperProfile);
router.get("/profile/me", getMyHelperProfile);
router.get("/profile/:userId", getHelperProfile);
router.patch("/availability", toggleAvailability);

// Helper search
router.get("/search", searchHelpers);
router.get("/available/count", getAvailableHelpersCount);

// Helper tasks
router.get("/tasks/active", getHelperActiveTasks);
router.get("/:userId/tasks/completed", getHelperCompletedTasks);

module.exports = router;
