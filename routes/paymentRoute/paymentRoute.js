const express = require("express");
const router = express.Router();
const {
  requestPayment,
  verifyPayment,
  getPaymentRequest,
  getPaymentHistory,
  requestRefund,
} = require("../../controllers/paymentController/paymentController");
const { authorizeRoles } = require("../../middleware/roleMiddleware");

// Helper routes - Request payment after completing task
router.post(
  "/task/:taskId/request",
  authorizeRoles(["helper"]),
  requestPayment
);

// Helpseeker routes - Verify and complete payment
router.post("/verify", verifyPayment);
router.get(
  "/task/:taskId/request",
  authorizeRoles(["helpseeker"]),
  getPaymentRequest
);

router.post("/:paymentId/refund", requestRefund);

router.get("/history", getPaymentHistory);

module.exports = router;
