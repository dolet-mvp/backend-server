const express = require("express");
const router = express.Router();
const {
  blockUser,
  unblockUser,
  getAllBlockedUsers,
  getUserBlockHistory,
  checkUserBlockStatus,
} = require("../../controllers/blockController/blockController");
const {
  checkForAuthenticationCookie,
  checkUserType,
} = require("../../middleware/authMiddleware");

router.post(
  "/block",
  checkForAuthenticationCookie(),
  checkUserType(["admin"]),
  blockUser
);

router.post(
  "/unblock",
  checkForAuthenticationCookie(),
  checkUserType(["admin"]),
  unblockUser
);

router.get(
  "/users",
  checkForAuthenticationCookie(),
  checkUserType(["admin"]),
  getAllBlockedUsers
);

router.get(
  "/users/:userId/history",
  checkForAuthenticationCookie(),
  checkUserType(["admin"]),
  getUserBlockHistory
);


router.get(
  "/users/:userId/status",
  checkForAuthenticationCookie(),
  checkUserType(["admin"]),
  checkUserBlockStatus
);

module.exports = router;
