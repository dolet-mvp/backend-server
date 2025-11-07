const JWT = require("jsonwebtoken");


function createToken(user, userType) {
  try {
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is missing in environment variables");
    }

    if (!['helper', 'helpseeker', 'admin'].includes(userType)) {
      throw new Error("Invalid user type. Must be 'helper', 'helpseeker', or 'admin'");
    }

    const payload = {
      id: user.id,
      phone: user.phone,
      userType: userType,
    };


    return JWT.sign(payload, process.env.JWT_SECRET, { expiresIn: "30d" });
  } catch (error) {
    console.error("Error creating token:", error.message);
    return null;
  }
}

function validateToken(token) {
  try {
    const payload = JWT.verify(token, process.env.JWT_SECRET);
    return payload;
  } catch (error) {
    console.error("Error validating token:", error.message);
    return null; 
  }
}

module.exports = {
  createToken,
  validateToken,
};
