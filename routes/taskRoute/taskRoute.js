const express = require("express");
const router = express.Router();
const helpseekerRoutes = require("./helpseekerTaskRoute");
const helperRoutes = require("./helperTaskRoute");

const {
  getTaskById,
  getMostPopularJobsInArea,
} = require("../../controllers/taskController/commonTaskController");

// Define specific routes first before dynamic routes
router.get("/popular-jobs", getMostPopularJobsInArea);

// Mount sub-routers for specific paths
router.use("/", helpseekerRoutes);
router.use("/", helperRoutes);

// Dynamic route should be last to avoid catching specific paths
router.get("/:taskId", getTaskById);
module.exports = router;

