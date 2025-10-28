const User = require("../../models/authModel/userModel");
const Address = require("../../models/addressModel/addressModel");
const { createToken } = require("../../services/authServices");

const handleGetProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findByPk(userId, {
      attributes: { exclude: ["password", "verificationCode", "verificationCodeExpiresAt"] },
      include: [
        {
          model: Address,
          as: "addresses", 
          attributes: [
            "id",
            "addressLine1",
            "addressLine2",
            "city",
            "state",
            "postalCode",
            "latitude",
            "longitude",
            "type",
            "isDefault",
          ],
        },
      ],
    });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    res.json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message || error,
    });
  }
};


const handleUpdateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { fullName, email,role  } = req.body;

    //testing

    const user = await User.findByPk(userId);
    if (!user) {
      console.error("User not found:", userId);
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (fullName) user.fullName = fullName;
    if (email) user.email = email;
    if (role) user.role = role;

    if (req.fileUrl) {
      user.profilePhoto = req.fileUrl;
    }

    await user.save();

    const token = createToken(user);

    const { password, ...userData } = user.toJSON();

    console.log("Updated User Data:", userData);

    res.json({
      success: true,
      message: "Profile updated successfully",
      user: userData,
      token
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message || error,
    });
  }
};


module.exports = {
    handleGetProfile,
    handleUpdateProfile,
}