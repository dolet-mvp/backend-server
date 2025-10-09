const express = require("express");
const supabaseUpload = require("../../config/uploadConfig/supabaseUpload");
const { handleGetProfile, handleUpdateProfile  } = require("../../controllers/profileController/profileController");

const router = express.Router();

router.get("/profile", handleGetProfile);
router.patch("/profile",supabaseUpload.single('profilePhoto'),handleUpdateProfile);

module.exports = router;