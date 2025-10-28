const express = require("express");
const router = express.Router();
const { generateTaskJson, enrichStepsWithLocations, getEnrichedTask } = require("../../controllers/aiController/gemniController");

router.post("/generate-task-json", generateTaskJson);

router.get("/task/:taskId", getEnrichedTask);

module.exports = router;