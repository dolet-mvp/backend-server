const express = require("express");
const {
  handleHelperUploadDocument,
  handleHelperRegisterOrLogin,
} = require("../../controllers/authController/helperAuthController");
const {
  handleHelpseekerRegister,

} = require("../../controllers/authController/helpseekerAuthController");
const {
  handleAdminLogin,
  getPendingHelpers,
  approveHelper,
  rejectHelper,
  getAllHelpers,
  handleAdminSignup,
} = require("../../controllers/authController/adminAuthController");
const { checkForAuthenticationCookie, checkUserType } = require("../../middleware/authMiddleware");
const supabaseUpload = require("../../config/uploadConfig/supabaseUpload");

const router = express.Router();

// HELPER ROUTES

router.post(
  "/helper/upload",
  checkForAuthenticationCookie(),
  supabaseUpload.fields([
    { name: "aadharCard", maxCount: 1 },
    { name: "addressProof", maxCount: 1 },
    { name: "drivingLicense", maxCount: 1 }
  ]),
  handleHelperUploadDocument
);
router.post("/helper/registerOrlogin", handleHelperRegisterOrLogin);

// HELPSEEKER ROUTES
router.post("/helpseeker/register", handleHelpseekerRegister);

// ADMIN ROUTES
router.post("/admin/login", handleAdminLogin);
router.get(
  "/admin/helpers/pending",
  checkForAuthenticationCookie(),
  checkUserType("admin"),
  getPendingHelpers
);
router.put(
  "/admin/helpers/:helperId/approve",
  checkForAuthenticationCookie(),
  checkUserType("admin"),
  approveHelper
);
router.put(
  "/admin/helpers/:helperId/reject",
  checkForAuthenticationCookie(),
  checkUserType("admin"),
  rejectHelper
);
router.get(
  "/admin/helpers",
  checkForAuthenticationCookie(),
  checkUserType("admin"),
  getAllHelpers
);
router.post(
  "/admin/register",
  checkForAuthenticationCookie(),
  handleAdminSignup
);

module.exports = router;
