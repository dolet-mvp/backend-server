const express = require("express");
const router = express.Router();
const { generateTaskJson, enrichStepsWithLocations, getEnrichedTask } = require("../../controllers/aiController/gemniController");
const { checkForAuthenticationCookie, checkUserType } = require("../../middleware/authMiddleware");

router.post(
  "/generate-task-json",
  checkForAuthenticationCookie(),
  generateTaskJson
);

router.get(
  "/task/:taskId",
  checkForAuthenticationCookie(),
  getEnrichedTask
);

module.exports = router;