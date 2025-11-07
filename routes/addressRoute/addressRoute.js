const express = require("express");
const router = express.Router();
const {
  createAddress,
  getUserAddresses,
  getAddressById,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  getDefaultAddress
} = require("../../controllers/addressController/address");
const { checkForAuthenticationCookie, checkUserType } = require("../../middleware/authMiddleware");

router.post(
  "/address/add",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  createAddress
);

router.get(
  "/address",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  getUserAddresses
);

router.get(
  "/address/default",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  getDefaultAddress
);

router.get(
  "/address/:addressId",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  getAddressById
);

router.put(
  "/address/:addressId",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  updateAddress
);

router.delete(
  "/address/:addressId",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  deleteAddress
);

router.patch(
  "/address/:addressId/default",
  checkForAuthenticationCookie(),
  checkUserType(["helper", "helpseeker"]),
  setDefaultAddress
);

module.exports = router;