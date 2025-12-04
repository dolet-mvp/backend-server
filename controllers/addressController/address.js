const Address = require("../../models/addressModel/addressModel");
const { Op } = require("sequelize");


const createAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const userType = req.user.userType; 
    
    const { 
      addressLine1, 
      addressLine2, 
      city, 
      state, 
      postalCode, 
      latitude, 
      longitude, 
      type, 
      isDefault,
      tag
    } = req.body;

    if (!['helper', 'helpseeker'].includes(userType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user type"
      });
    }

    // Build where clause for polymorphic relationship
    const whereClause = {
      userType,
      isDefault: true
    };
    
    if (userType === 'helper') {
      whereClause.helperId = userId;
    } else {
      whereClause.helpseekerId = userId;
    }

    // If setting as default, unset other default addresses
    if (isDefault) {
      await Address.update(
        { isDefault: false },
        { where: whereClause }
      );
    }


    const addressData = {
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      latitude,
      longitude,
      type: type || "home",
      isDefault: isDefault || false,
      userType,
      tag
    };

    // Set the appropriate foreign key
    if (userType === 'helper') {
      addressData.helperId = userId;
    } else {
      addressData.helpseekerId = userId;
    }

    const address = await Address.create(addressData);

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
    const userType = req.user.userType;


    // Build where clause for polymorphic relationship
    let whereClause = { userType };
    
    if (userType === 'helper') {
      whereClause.helperId = userId;
    } else if (userType === 'helpseeker') {
      whereClause.helpseekerId = userId;
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid user type"
      });
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
    const userType = req.user.userType;

    // Build where clause
    const whereClause = { 
      id: addressId,
      userType
    };
    
    if (userType === 'helper') {
      whereClause.helperId = userId;
    } else if (userType === 'helpseeker') {
      whereClause.helpseekerId = userId;
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid user type"
      });
    }

    const address = await Address.findOne({
      where: whereClause
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
    const userType = req.user.userType;
    const { 
      addressLine1, 
      addressLine2, 
      city, 
      state, 
      postalCode, 
      latitude, 
      longitude, 
      type, 
      isDefault,
      tag
    } = req.body;

    // Build where clause
    const whereClause = { 
      id: addressId,
      userType
    };
    
    if (userType === 'helper') {
      whereClause.helperId = userId;
    } else if (userType === 'helpseeker') {
      whereClause.helpseekerId = userId;
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid user type"
      });
    }

    const address = await Address.findOne({
      where: whereClause
    });

    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found"
      });
    }

    // If setting as default, unset other defaults
    if (isDefault && !address.isDefault) {
      const updateWhere = {
        userType,
        isDefault: true
      };
      
      if (userType === 'helper') {
        updateWhere.helperId = userId;
      } else {
        updateWhere.helpseekerId = userId;
      }

      await Address.update(
        { isDefault: false },
        { where: updateWhere }
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
      isDefault: isDefault !== undefined ? isDefault : address.isDefault,
      tag: tag !== undefined ? tag : address.tag
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
    const userType = req.user.userType;

    // Build where clause
    const whereClause = { 
      id: addressId,
      userType
    };
    
    if (userType === 'helper') {
      whereClause.helperId = userId;
    } else if (userType === 'helpseeker') {
      whereClause.helpseekerId = userId;
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid user type"
      });
    }

    const address = await Address.findOne({
      where: whereClause
    });

    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found"
      });
    }

    await address.destroy();

    // If deleted address was default, set another as default
    if (address.isDefault) {
      const nextWhereClause = { userType };
      
      if (userType === 'helper') {
        nextWhereClause.helperId = userId;
      } else {
        nextWhereClause.helpseekerId = userId;
      }

      const nextAddress = await Address.findOne({
        where: nextWhereClause,
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
    const userType = req.user.userType;

    // Build where clause for polymorphic relationship
    const whereClause = {
      id: addressId,
      userType
    };
    
    if (userType === 'helper') {
      whereClause.helperId = userId;
    } else {
      whereClause.helpseekerId = userId;
    }

    const address = await Address.findOne({
      where: whereClause
    });

    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found"
      });
    }

    // Unset all default addresses for this user
    const updateWhereClause = { userType };
    if (userType === 'helper') {
      updateWhereClause.helperId = userId;
    } else {
      updateWhereClause.helpseekerId = userId;
    }

    await Address.update(
      { isDefault: false },
      { where: updateWhereClause }
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
    const userType = req.user.userType;

    // Build where clause for polymorphic relationship
    const whereClause = {
      userType,
      isDefault: true
    };
    
    if (userType === 'helper') {
      whereClause.helperId = userId;
    } else {
      whereClause.helpseekerId = userId;
    }

    const defaultAddress = await Address.findOne({
      where: whereClause
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
