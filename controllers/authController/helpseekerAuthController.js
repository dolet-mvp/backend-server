const Helpseeker = require("../../models/authModel/helpseekerModel");
const { createToken } = require("../../services/authServices");


const handleHelpseekerRegister = async (req, res) => {
  try {
    const { phone} = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    // Check if helpseeker already exists
    let helpseeker = await Helpseeker.findOne({ where: { phone } });

    if (helpseeker) {
      // Generate token for existing user
      const token = createToken(helpseeker, "helpseeker");

      const helpseekerData = helpseeker.toJSON();

      return res.json({
        success: true,
        message: "Login successful",
        token,
        helpseeker: helpseekerData,
        userType: "helpseeker",
      });
    }
    helpseeker = await Helpseeker.create({
      phone,
      isVerified: true, 
    });

    // Generate token
    const token = createToken(helpseeker, "helpseeker");

    const helpseekerData = helpseeker.toJSON();

    res.status(201).json({
      success: true,
      message: "Registration successful",
      token,
      helpseeker: helpseekerData,
      userType: "helpseeker",
    });
  } catch (error) {
    console.error("Helpseeker registration error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during registration",
      error: error.message,
    });
  }
};


const getHelpseekerProfile = async (req, res) => {
  try {
    const helpseekerId = req.user.id;

    const helpseeker = await Helpseeker.findByPk(helpseekerId);

    if (!helpseeker) {
      return res.status(404).json({
        success: false,
        message: "Helpseeker not found",
      });
    }

    res.json({
      success: true,
      helpseeker,
    });
  } catch (error) {
    console.error("Get helpseeker profile error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};


const updateHelpseekerProfile = async (req, res) => {
  try {
    const helpseekerId = req.user.id;
    const { fullName, email } = req.body || {};

    const helpseeker = await Helpseeker.findByPk(helpseekerId);

    if (!helpseeker) {
      return res.status(404).json({
        success: false,
        message: "Helpseeker not found",
      });
    }

    // Update allowed fields
    if (fullName) helpseeker.fullName = fullName;
    if (email) helpseeker.email = email;

    // Handle profile photo upload
    if (req.fileUrl) {
      helpseeker.profilePhoto = req.fileUrl;
    }

    await helpseeker.save();

    const helpseekerData = helpseeker.toJSON();

    res.json({
      success: true,
      message: "Profile updated successfully",
      helpseeker: helpseekerData,
    });
  } catch (error) {
    console.error("Update helpseeker profile error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
  handleHelpseekerRegister,
  getHelpseekerProfile,
  updateHelpseekerProfile,
};
