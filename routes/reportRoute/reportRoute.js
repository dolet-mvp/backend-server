const express = require("express");
const router = express.Router();
const {
  createReport,
  getMyReports,
  getAllReports,
  getReportById,
  updateReport,
  getReportStats,
} = require("../../controllers/reportController/reportController");

const { checkForAuthenticationCookie, checkUserType } = require("../../middleware/authMiddleware");

// User routes (Helper & Helpseeker)
// Create a new report
router.post(
  "/create",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  createReport
);

// Get my submitted reports
router.get(
  "/my-reports",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  getMyReports
);

// Admin routes
// Get all reports with optional filters
router.get(
  "/admin/all",
  checkForAuthenticationCookie(),
  checkUserType(["admin"]),
  getAllReports
);

// Get report statistics
router.get(
  "/admin/stats",
  checkForAuthenticationCookie(),
  checkUserType(["admin"]),
  getReportStats
);

// Get specific report by ID
router.get(
  "/admin/:reportId",
  checkForAuthenticationCookie(),
  checkUserType(["admin"]),
  getReportById
);

// Update report (review and take action)
router.patch(
  "/admin/:reportId",
  checkForAuthenticationCookie(),
  checkUserType(["admin"]),
  updateReport
);

module.exports = router;
