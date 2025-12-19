const express = require("express");
const supabaseUpload = require("../../config/uploadConfig/supabaseUpload");

const { checkForAuthenticationCookie, checkUserType } = require("../../middleware/authMiddleware");
const { getHelperProfile, updateHelperProfile } = require("../../controllers/authController/helperAuthController");
const { getHelpseekerProfile, updateHelpseekerProfile } = require("../../controllers/authController/helpseekerAuthController");

const router = express.Router();


// Helper Routes
router.get(
  "/helper/profile",
  checkForAuthenticationCookie(),
  checkUserType("helper"),
  getHelperProfile
);

router.put(
  "/helper/profile",
  checkForAuthenticationCookie(),
  checkUserType("helper"),
  updateHelperProfile
);
//HELPSEEKER ROUTES
router.get(
  "/helpseeker/profile",
  checkForAuthenticationCookie(),
  checkUserType("helpseeker"),
  getHelpseekerProfile
);
router.put(
  "/helpseeker/profile",
  checkForAuthenticationCookie(),
  checkUserType("helpseeker"),
  updateHelpseekerProfile
);

module.exports = router;