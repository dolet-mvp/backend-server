const express = require("express");
const router = express.Router();
const {
  submitRating,
  getUserRatings,
  getTaskRating,
  getMyRatings,
  toggleRatingVisibility,
} = require("../../controllers/ratingController/ratingController");
const { checkForAuthenticationCookie, checkUserType } = require("../../middleware/authMiddleware");

// Submit rating (both helpseeker and helper)
router.post(
  "/task/:taskId",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  submitRating
);

// Get ratings
router.get(
  "/user/:userId",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker", "admin"]),
  getUserRatings
);

router.get(
  "/task/:taskId",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  getTaskRating
);

router.get(
  "/my-ratings",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  getMyRatings
);

// Manage ratings
router.patch(
  "/:ratingId/visibility",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  toggleRatingVisibility
);

module.exports = router;
