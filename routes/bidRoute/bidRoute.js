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

// Helper routes
router.post("/task/:taskId/place", placeBid);
router.get("/my-bids", getMyBids);
router.delete("/:bidId/withdraw", withdrawBid);

// Helpseeker routes
router.get("/task/:taskId", getTaskBids);
router.patch("/:bidId/accept", acceptBid);
router.patch("/:bidId/reject", rejectBid);

module.exports = router;
