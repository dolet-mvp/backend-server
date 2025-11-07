const express = require("express");
const router = express.Router();
const {
  placeBid,
  getTaskBids,
  getMyBids,
  acceptBid,
  rejectBid,
  withdrawBid,
} = require("../../controllers/bidController/bidController");
const { checkForAuthenticationCookie, checkUserType } = require("../../middleware/authMiddleware");

// Helper routes
router.post(
  "/task/:taskId/place",
  checkForAuthenticationCookie(),
  checkUserType(["helper"]),
  placeBid
);

router.get(
  "/my-bids",
  checkForAuthenticationCookie(),
  checkUserType(["helper"]),
  getMyBids
);

router.delete(
  "/:bidId/withdraw",
  checkForAuthenticationCookie(),
  checkUserType(["helper"]),
  withdrawBid
);

// Helpseeker routes
router.get(
  "/task/:taskId",
  checkForAuthenticationCookie(),
  checkUserType(["helpseeker"]),
  getTaskBids
);

router.patch(
  "/:bidId/accept",
  checkForAuthenticationCookie(),
  checkUserType(["helpseeker"]),
  acceptBid
);

router.patch(
  "/:bidId/reject",
  checkForAuthenticationCookie(),
  checkUserType(["helpseeker"]),
  rejectBid
);

module.exports = router;
