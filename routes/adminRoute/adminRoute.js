const express = require("express");
const router = express.Router();
const { checkForAuthenticationCookie, checkUserType } = require("../../middleware/authMiddleware");
const { getHelperTasks, getHelpseekerTasks } = require("../../controllers/authController/adminAuthController");

// Get all tasks for a specific helper
router.get(
  "/helpers/:helperId/tasks",
  checkForAuthenticationCookie(),
  checkUserType("admin"),
  getHelperTasks
);

// Get all tasks for a specific helpseeker
router.get(
  "/helpseekers/:helpseekerId/tasks",
  checkForAuthenticationCookie(),
  checkUserType("admin"),
  getHelpseekerTasks
);

module.exports = router;
