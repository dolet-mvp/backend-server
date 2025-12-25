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
  getSupportAnalytics,
} = require("../../controllers/supportController/supportController");
const { checkForAuthenticationCookie, checkUserType } = require("../../middleware/authMiddleware");
const supabaseUpload = require("../../config/uploadConfig/supabaseUpload");

// User Routes
router.post(
  "/create",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  supabaseUpload.array("attachments", 5),
  createTicket
);

router.get(
  "/my-tickets",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  getMyTickets
);

router.get(
  "/ticket/:ticketId",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker", "admin"]),
  getTicketDetails
);

router.post(
  "/ticket/:ticketId/reply",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker", "admin"]),
  supabaseUpload.array("attachments", 3),
  replyToTicket
);

// Admin Routes
router.get(
  "/admin/analytics",
  checkForAuthenticationCookie(),
  checkUserType(["admin"]),
  getSupportAnalytics
);

router.get(
  "/admin/tickets",
  checkForAuthenticationCookie(),
  checkUserType(["admin"]),
  getAllTickets
);

router.patch(
  "/admin/ticket/:ticketId/update",
  checkForAuthenticationCookie(),
  checkUserType(["admin"]),
  updateTicketStatus
);

router.get(
  "/admin/statistics",
  checkForAuthenticationCookie(),
  checkUserType(["admin"]),
  getTicketStatistics
);

module.exports = router;
