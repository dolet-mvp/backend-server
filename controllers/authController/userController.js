const User = require("../../models/authModel/userModel");
const { createToken } = require("../../services/authServices");

const handleRegister = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone)
      return res
        .status(400)
        .json({ success: false, message: "Phone required" });

    let user = await User.findOne({ where: { phone } });

    if (!user) {
      user = await User.create({
        phone,
        isVerified: true,
      });
    } else {
      await user.save();
    }

    const token = createToken(user);

    res.json({
      success: true,
      token,
      user,
      message: "Register successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error });
  }
};

module.exports = {
  handleRegister,
};
