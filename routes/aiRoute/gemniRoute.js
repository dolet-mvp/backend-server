const express = require("express");
const router = express.Router();
const { generateTaskJson } = require("../../controllers/aiController/gemniController");

router.post("/generate-task-json", generateTaskJson);

module.exports = router;