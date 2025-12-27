const express = require("express");
const router = express.Router();
const { checkForAuthenticationCookie, checkUserType } = require("../../middleware/authMiddleware");
const { 
  getHelperTasks, 
  getHelpseekerTasks,
  updateAdminProfile,
  changeAdminPassword,
  generateTwoFactorSecret,
  enableTwoFactor,
  disableTwoFactor,
  getHelperAnalytics,
  getHelpseekerAnalytics
} = require("../../controllers/authController/adminAuthController");
const { getAllPendingDeliveries } = require("../../controllers/taskController/taskDeliveryController");

// Update admin profile
router.put(
  "/profile/update",
  checkForAuthenticationCookie(),
  checkUserType("admin"),
  updateAdminProfile
);

// Change admin password
router.put(
  "/profile/change-password",
  checkForAuthenticationCookie(),
  checkUserType("admin"),
  changeAdminPassword
);

// Generate 2FA secret
router.post(
  "/2fa/generate",
  checkForAuthenticationCookie(),
  checkUserType("admin"),
  generateTwoFactorSecret
);

// Enable 2FA
router.post(
  "/2fa/enable",
  checkForAuthenticationCookie(),
  checkUserType("admin"),
  enableTwoFactor
);

// Disable 2FA
router.post(
  "/2fa/disable",
  checkForAuthenticationCookie(),
  checkUserType("admin"),
  disableTwoFactor
);

// Get pending task deliveries (monitoring)
router.get(
  "/tasks/pending-deliveries",
  checkForAuthenticationCookie(),
  checkUserType("admin"),
  getAllPendingDeliveries
);

// Get helper analytics
router.get(
  "/helpers/analytics",
  checkForAuthenticationCookie(),
  checkUserType("admin"),
  getHelperAnalytics
);

// Get helpseeker analytics
router.get(
  "/helpseekers/analytics",
  checkForAuthenticationCookie(),
  checkUserType("admin"),
  getHelpseekerAnalytics
);

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
