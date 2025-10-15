const express = require("express");
const router = express.Router();
const helpseekerRoutes = require("./helpseekerTaskRoute");
const helperRoutes = require("./helperTaskRoute");

const {
  getTaskById,
  getMostPopularJobsInArea,
} = require("../../controllers/taskController/commonTaskController");

router.use("/", helpseekerRoutes);
router.use("/", helperRoutes);

router.get("/popular-jobs", getMostPopularJobsInArea);
router.get("/:taskId", getTaskById);
module.exports = router;

