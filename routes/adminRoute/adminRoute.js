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
const { checkUnacceptedTasks } = require("../../services/taskSchedulerService");

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

// Manual trigger for checking unaccepted tasks
router.post(
  "/tasks/cleanup-unaccepted",
  checkForAuthenticationCookie(),
  checkUserType("admin"),
  async (req, res) => {
    try {
      console.log(`\n🔧 [MANUAL TRIGGER] Admin ${req.user.id} triggered unaccepted tasks cleanup`);
      await checkUnacceptedTasks();
      res.status(200).json({
        success: true,
        message: "Unaccepted tasks cleanup completed successfully",
      });
    } catch (error) {
      console.error("Error in manual unaccepted tasks cleanup:", error);
      res.status(500).json({
        success: false,
        message: "Failed to cleanup unaccepted tasks",
        error: error.message,
      });
    }
  }
);





module.exports = router;
