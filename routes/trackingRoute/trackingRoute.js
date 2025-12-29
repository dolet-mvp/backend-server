const express = require("express");
const router = express.Router();
const supabaseUpload = require("../../config/uploadConfig/supabaseUpload");
const {
  updateOnTheWay,
  markArrived,
  completeWork,
  getTaskTracking,
  updateLocation,
  getHelperLocation,
  abortTask,
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

// Common route for aborting/cancelling task (both helper and helpseeker)
router.post(
  "/task/:taskId/abort",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  abortTask
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

router.get(
  "/task/:taskId/location",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  getHelperLocation
);

module.exports = router;
