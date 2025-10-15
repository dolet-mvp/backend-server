const express = require("express");
const router = express.Router();
const supabaseUpload = require("../../config/uploadConfig/supabaseUpload");
const {
  updateOnTheWay,
  markArrived,
  startWork,
  completeWork,
  getTaskTracking,
  updateLocation,
} = require("../../controllers/trackingController/trackingController");

// Helper routes
router.post("/task/:taskId/on-the-way", updateOnTheWay);
router.post("/task/:taskId/arrived", markArrived);
router.post("/task/:taskId/start-work", startWork);
router.post(
  "/task/:taskId/complete-work",
  supabaseUpload.array("photos", 10),
  completeWork
);
router.patch("/task/:taskId/location", updateLocation);

// Common routes (both helper and helpseeker)
router.get("/task/:taskId", getTaskTracking);

module.exports = router;
