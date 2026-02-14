const express = require("express");
const router = express.Router();
const {
  getNearbyOnlineHelpers,
  updateHelperLocation,
  getMyLocationAndNearbyHelpers,
} = require("../../controllers/locationController/locationController");
const { checkForAuthenticationCookie, checkUserType } = require("../../middleware/authMiddleware");

// Get nearby online helpers (for helpseekers)
router.post(
  "/nearby-helpers",
  checkForAuthenticationCookie(),
  checkUserType(["helpseeker"]),
  getNearbyOnlineHelpers
);

// Update helper's current location
router.patch(
  "/update",
  checkForAuthenticationCookie(),
  checkUserType(["helper"]),
  updateHelperLocation
);

// Get my location and find nearby helpers
router.post(
  "/my-location/nearby",
  checkForAuthenticationCookie(),
  checkUserType(["helpseeker"]),
  getMyLocationAndNearbyHelpers
);

module.exports = router;
