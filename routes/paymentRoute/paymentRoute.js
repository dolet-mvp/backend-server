const express = require("express");
const router = express.Router();
const {
  requestPayment,
  verifyPayment,
  getPaymentRequest,
  getPaymentHistory,
  requestRefund,
} = require("../../controllers/paymentController/paymentController");
const { checkForAuthenticationCookie, checkUserType } = require("../../middleware/authMiddleware");

// Helper routes - Request payment after completing task
router.post(
  "/task/:taskId/request",
  checkForAuthenticationCookie(),
  checkUserType(["helper"]),
  requestPayment
);

// Helpseeker routes - Verify and complete payment
router.post(
  "/verify",
  checkForAuthenticationCookie(),
  checkUserType(["helpseeker"]),
  verifyPayment
);

router.get(
  "/task/:taskId/request",
  checkForAuthenticationCookie(),
  checkUserType(["helpseeker"]),
  getPaymentRequest
);

router.post(
  "/:paymentId/refund",
  checkForAuthenticationCookie(),
  checkUserType(["helpseeker", "admin"]),
  requestRefund
);

router.get(
  "/history",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  getPaymentHistory
);

module.exports = router;
