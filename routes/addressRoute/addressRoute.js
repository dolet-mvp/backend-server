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

router.post("/address/add",  createAddress);
router.get("/address", getUserAddresses);
router.get("/address/default", getDefaultAddress);
router.get("/address/:addressId",  getAddressById);
router.put("/address/:addressId", updateAddress);
router.delete("/address/:addressId",  deleteAddress);
router.patch("/address/:addressId/default",  setDefaultAddress);

module.exports = router;