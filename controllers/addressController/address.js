const Address = require("../../models/addressModel/addressModel");
const User = require("../../models/authModel/userModel");
const { Op } = require("sequelize");

const createAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const { 
      addressLine1, 
      addressLine2, 
      city, 
      state, 
      postalCode, 
      latitude, 
      longitude, 
      type, 
      isDefault 
    } = req.body;

    if (isDefault) {
      await Address.update(
        { isDefault: false },
        { where: { userId, isDefault: true } }
      );
    }

    const address = await Address.create({
      userId,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      latitude,
      longitude,
      type: type || "home",
      isDefault: isDefault || false
    });

    res.status(201).json({
      success: true,
      message: "Address created successfully",
      data: {
        address
      }
    });
  } catch (error) {
    console.error("Create address error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create address",
      error: error.message
    });
  }
};

const getUserAddresses = async (req, res) => {
  try {
    const userId = req.user.id;
    const { type } = req.query;

    let whereClause = { userId };
    if (type && ["home", "work", "other"].includes(type)) {
      whereClause.type = type;
    }

    const addresses = await Address.findAll({
      where: whereClause,
      order: [
        ["isDefault", "DESC"],
        ["createdAt", "DESC"]
      ]
    });

    res.status(200).json({
      success: true,
      message: "Addresses retrieved successfully",
      data: {
        addresses,
        count: addresses.length
      }
    });
  } catch (error) {
    console.error("Get addresses error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve addresses",
      error: error.message
    });
  }
};

const getAddressById = async (req, res) => {
  try {
    const { addressId } = req.params;
    const userId = req.user.id;

    const address = await Address.findOne({
      where: { 
        id: addressId,
        userId 
      }
    });

    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Address retrieved successfully",
      data: {
        address
      }
    });
  } catch (error) {
    console.error("Get address by ID error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve address",
      error: error.message
    });
  }
};

const updateAddress = async (req, res) => {
  try {
    const { addressId } = req.params;
    const userId = req.user.id;
    const { 
      addressLine1, 
      addressLine2, 
      city, 
      state, 
      postalCode, 
      latitude, 
      longitude, 
      type, 
      isDefault 
    } = req.body;

    const address = await Address.findOne({
      where: { 
        id: addressId,
        userId 
      }
    });

    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found"
      });
    }

    if (isDefault && !address.isDefault) {
      await Address.update(
        { isDefault: false },
        { where: { userId, isDefault: true } }
      );
    }

    const updatedAddress = await address.update({
      addressLine1: addressLine1 || address.addressLine1,
      addressLine2: addressLine2 !== undefined ? addressLine2 : address.addressLine2,
      city: city || address.city,
      state: state || address.state,
      postalCode: postalCode || address.postalCode,
      latitude: latitude !== undefined ? latitude : address.latitude,
      longitude: longitude !== undefined ? longitude : address.longitude,
      type: type || address.type,
      isDefault: isDefault !== undefined ? isDefault : address.isDefault
    });

    res.status(200).json({
      success: true,
      message: "Address updated successfully",
      data: {
        address: updatedAddress
      }
    });
  } catch (error) {
    console.error("Update address error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update address",
      error: error.message
    });
  }
};

const deleteAddress = async (req, res) => {
  try {
    const { addressId } = req.params;
    const userId = req.user.id;

    const address = await Address.findOne({
      where: { 
        id: addressId,
        userId 
      }
    });

    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found"
      });
    }

    await address.destroy();

    if (address.isDefault) {
      const nextAddress = await Address.findOne({
        where: { userId },
        order: [["createdAt", "ASC"]]
      });
      
      if (nextAddress) {
        await nextAddress.update({ isDefault: true });
      }
    }

    res.status(200).json({
      success: true,
      message: "Address deleted successfully"
    });
  } catch (error) {
    console.error("Delete address error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete address",
      error: error.message
    });
  }
};

const setDefaultAddress = async (req, res) => {
  try {
    const { addressId } = req.params;
    const userId = req.user.id;

    const address = await Address.findOne({
      where: { 
        id: addressId,
        userId 
      }
    });

    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found"
      });
    }

    await Address.update(
      { isDefault: false },
      { where: { userId } }
    );

    await address.update({ isDefault: true });

    res.status(200).json({
      success: true,
      message: "Default address updated successfully",
      data: {
        address
      }
    });
  } catch (error) {
    console.error("Set default address error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to set default address",
      error: error.message
    });
  }
};


const getDefaultAddress = async (req, res) => {
  try {
    const userId = req.user.id;

    const defaultAddress = await Address.findOne({
      where: { 
        userId,
        isDefault: true 
      }
    });

    if (!defaultAddress) {
      return res.status(404).json({
        success: false,
        message: "No default address found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Default address retrieved successfully",
      data: {
        address: defaultAddress
      }
    });
  } catch (error) {
    console.error("Get default address error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve default address",
      error: error.message
    });
  }
};

module.exports = {
  createAddress,
  getUserAddresses,
  getAddressById,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  getDefaultAddress
};
