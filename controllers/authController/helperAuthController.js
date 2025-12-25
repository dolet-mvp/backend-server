const Helper = require("../../models/authModel/helperModel");
const { createToken } = require("../../services/authServices");
const { encryptDocuments } = require("../../services/encryptionService");
const bcrypt = require("bcryptjs");

const handleHelperRegisterOrLogin = async (req, res) => {
  try {
    const { phone,fullName } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    let helper = await Helper.findOne({ where: { phone } });


    if (helper) {
      if (helper.verificationStatus === "pending") {
         const token = createToken(helper, "helper");
        return res.status(403).json({
          success: true,
          token,
          helper,
          userType: "helper",
          message: "Your account is pending , Please upload the required documents to proceed.",
          verificationStatus: "pending",
        });
      }

      if (helper.verificationStatus === "submitted") {
       const token = createToken(helper, "helper");
        return res.status(403).json({
          success: true,
          token,
            helper,
        userType: "helper",
          message: "Please wait your document is being reviewed, Will inform you once verified via mail or your phone number.",
          verificationStatus: "submitted",
        });
      }

      if (helper.verificationStatus === "rejected") {
      const token = createToken(helper, "helper");
        return res.status(403).json({
          success: true,
          token,
          helper,
          userType: "helper",
          message:"Your account has been rejected. Please contact support.",
          verificationStatus: "rejected",
          rejectionReason: helper.rejectionReason,
        });
      }

      const token = createToken(helper, "helper");

      return res.json({
        success: true,
        message: "Login successful",
        token,
        helper,
        userType: "helper",
      });
    }

    helper = await Helper.create({
      phone,
      fullName: fullName || null,
      verificationStatus: "pending",
      isApproved: false,
    });

    const token = createToken(helper, "helper");

    return res.status(201).json({
      success: true,
      message: "Registration successful. Awaiting admin approval.",
      token,
      helper,
      userType: "helper",
    });
  } catch (error) {
    console.error("Helper registration/login error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during registration/login",
      error: error.message,
    });
  }
};


const handleHelperUploadDocument = async (req, res) => {
  const helperId = req.user.id;

  try {
    const { accountNumber, ifscCode, accountHolderName } = req.body;
    const helper = await Helper.findByPk(helperId);

    if (!helper) {
      return res.status(404).json({
        success: false,
        message: "Helper not found",
      });
    }

    const documents = req.fileUrls || {};

    if (!documents.aadharCard || !documents.addressProof) {
      return res.status(400).json({
        success: false,
        message: "Aadhar card and address proof documents are required",
      });
    }

    // Encrypt document URLs before storing
    const encryptedDocs = encryptDocuments({
      aadharCard: documents.aadharCard,
      addressProof: documents.addressProof,
      drivingLicense: documents.drivingLicense
    });

    await helper.update({
      accountNumber,
      ifscCode,
      accountHolderName,
      aadharCardDocument: encryptedDocs.aadharCard,
      addressProofDocument: encryptedDocs.addressProof,
      drivingLicenseDocument: encryptedDocs.drivingLicense,
      verificationStatus: "submitted",
      isApproved: false,
    });

    res.status(200).json({
      success: true,
      message: "Documents uploaded successfully. Waiting for admin approval.",
      data: helper,
    });
  } catch (error) {
    console.error("Helper upload document error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during document upload",
      error: error.message,
    });
  }
};

const getHelperProfile = async (req, res) => {
  try {
    const helperId = req.user.id;
    
    const helper = await Helper.findByPk(helperId, {
      attributes: { exclude: ["password"] },
    });

    if (!helper) {
      return res.status(404).json({
        success: false,
        message: "Helper not found",
      });
    }

    res.json({
      success: true,
      helper,
    });
  } catch (error) {
    console.error("Get helper profile error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};


const updateHelperProfile = async (req, res) => {
  try {
    const helperId = req.user.id;
    const {
      fullName,
      email,
    } = req.body;

    const helper = await Helper.findByPk(helperId);
    if (!helper) {
      return res.status(404).json({
        success: false,
        message: "Helper not found",
      });
    }

    Object.assign(helper, {
      fullName,
      email,

    });

    if (req.fileUrl) helper.profilePhoto = req.fileUrl;

    await helper.save();

    res.json({
      success: true,
      message: "Profile updated successfully",
      helper,
    });
  } catch (error) {
    console.error("Update helper profile error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
  handleHelperRegisterOrLogin,
  handleHelperUploadDocument,
  getHelperProfile,
  updateHelperProfile,
};
