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
  getHelperDetails,
  getHelperTasks,
  getAllHelpseekers,
  getHelpseekerDetails,
  getHelpseekerTasks,
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
    { name: "selfie", maxCount: 1 },
    { name: "panCard", maxCount: 1 },
    { name: "addressProof", maxCount: 1 }
  ]),
  handleHelperUploadDocument
);
router.post("/helper/registerOrlogin", handleHelperRegisterOrLogin);

//HELPSEEKER ROUTES
router.post("/helpseeker/register", handleHelpseekerRegister);

//ADMIN ROUTES
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
router.get(
  "/admin/helpers/:helperId",
  checkForAuthenticationCookie(),
  checkUserType("admin"),
  getHelperDetails
);
router.get(
  "/admin/helpseekers",
  checkForAuthenticationCookie(),
  checkUserType("admin"),
  getAllHelpseekers
);
router.get(
  "/admin/helpseekers/:helpseekerId",
  checkForAuthenticationCookie(),
  checkUserType("admin"),
  getHelpseekerDetails
);
router.post(
  "/admin/register",
  handleAdminSignup
);

module.exports = router;
