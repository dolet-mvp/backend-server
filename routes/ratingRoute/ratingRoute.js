const express = require("express");
const router = express.Router();
const {
  submitRating,
  getUserRatings,
  getTaskRating,
  getMyRatings,
  toggleRatingVisibility,
} = require("../../controllers/ratingController/ratingController");

// Submit rating (both helpseeker and helper)
router.post("/task/:taskId", submitRating);

// Get ratings
router.get("/user/:userId", getUserRatings);
router.get("/task/:taskId", getTaskRating);
router.get("/my-ratings", getMyRatings);

// Manage ratings
router.patch("/:ratingId/visibility", toggleRatingVisibility);

module.exports = router;
