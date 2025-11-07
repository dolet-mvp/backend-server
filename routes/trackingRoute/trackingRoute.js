const express = require("express");
const router = express.Router();
const supabaseUpload = require("../../config/uploadConfig/supabaseUpload");
const {
  updateOnTheWay,
  markArrived,
  completeWork,
  getTaskTracking,
  updateLocation,
} = require("../../controllers/trackingController/trackingController");
const { checkUserType,checkForAuthenticationCookie } = require("../../middleware/authMiddleware");

// Helper routes
router.post(
  "/task/:taskId/on-the-way",
  checkForAuthenticationCookie(),
  checkUserType(["helper"]),
  updateOnTheWay
);

router.post(
  "/task/:taskId/arrived",
  checkForAuthenticationCookie(),
  checkUserType(["helper"]),
  markArrived
);

router.post(
  "/task/:taskId/complete-work",
  checkForAuthenticationCookie(),
  checkUserType(["helper"]),
  supabaseUpload.array("photos", 10),
  completeWork
);

router.patch(
  "/task/:taskId/location",
  checkForAuthenticationCookie(),
  checkUserType(["helper"]),
  updateLocation
);

// Common routes (both helper and helpseeker)
router.get(
  "/task/:taskId",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  getTaskTracking
);

module.exports = router;
