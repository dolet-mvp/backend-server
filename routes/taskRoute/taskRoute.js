const express = require("express");
const router = express.Router();
const helpseekerRoutes = require("./helpseekerTaskRoute");
const helperRoutes = require("./helperTaskRoute");
const { checkForAuthenticationCookie, checkUserType } = require("../../middleware/authMiddleware");

const {
  getTaskById,
  getMostPopularJobsInArea,
} = require("../../controllers/taskController/commonTaskController");

router.get(
  "/popular-jobs",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  getMostPopularJobsInArea
);

router.use("/", helpseekerRoutes);
router.use("/", helperRoutes);

router.get(
  "/:taskId",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  getTaskById
);

module.exports = router;

