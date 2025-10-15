const express = require("express");
const router = express.Router();
const {
  createTicket,
  getMyTickets,
  getTicketDetails,
  replyToTicket,
  getAllTickets,
  updateTicketStatus,
  getTicketStatistics,
} = require("../../controllers/supportController/supportController");
const {authorizeRoles} = require("../../middleware/roleMiddleware");
const supabaseUpload = require("../../config/uploadConfig/supabaseUpload");

// User Routes
router.post(
  "/create",
  supabaseUpload.array("attachments", 5),
  createTicket
);
router.get("/my-tickets", getMyTickets);
router.get("/ticket/:ticketId",  getTicketDetails);
router.post(
  "/ticket/:ticketId/reply",
  supabaseUpload.array("attachments", 3),
  replyToTicket
);
// Admin Routes
router.get(
  "/admin/tickets",
  authorizeRoles("admin"),
  getAllTickets
);
router.patch(
  "/admin/ticket/:ticketId/update",
  authorizeRoles("admin"),
  updateTicketStatus
);
router.get(
  "/admin/statistics",
  authorizeRoles("admin"),
  getTicketStatistics
);

module.exports = router;
