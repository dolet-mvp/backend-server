const express = require("express");
const router = express.Router();
const helpseekerRoutes = require("./helpseekerTaskRoute");
const helperRoutes = require("./helperTaskRoute");
const { checkForAuthenticationCookie, checkUserType } = require("../../middleware/authMiddleware");

const {
  getTaskById,
  getMostPopularJobsInArea,
} = require("../../controllers/taskController/commonTaskController");

const {
  acknowledgeTaskReceipt,
  getTaskDeliveryStatus,
} = require("../../controllers/taskController/taskDeliveryController");

router.get(
  "/popular-jobs",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  getMostPopularJobsInArea
);

router.use("/", helpseekerRoutes);
router.use("/", helperRoutes);

// Task delivery acknowledgment routes
router.post(
  "/:taskId/acknowledge",
  checkForAuthenticationCookie(),
  checkUserType(["helper"]),
  acknowledgeTaskReceipt
);

router.get(
  "/:taskId/delivery-status",
  checkForAuthenticationCookie(),
  checkUserType(["helper"]),
  getTaskDeliveryStatus
);

router.get(
  "/:taskId",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  getTaskById
);

module.exports = router;

