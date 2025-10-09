const { validateToken } = require("../services/authServices");
const { parse } = require("cookie");


function checkForAuthenticationCookie() {
  return (req, res, next) => {
    try {
      let token;

      if (req.headers.authorization) {
        const authHeader = req.headers.authorization;
        if (authHeader.startsWith("Bearer ")) {
          token = authHeader.split(" ")[1];
        }
      }
      if (!token) {
        return res.status(401).json({ error: "No token found. Please login." });
      }

      const userPayload = validateToken(token);
      if (!userPayload) {
        return res.status(401).json({ error: "Invalid or expired token." });
      }

      req.user = userPayload;
      next();
    } catch (error) {
      console.error("Auth error:", error.message);
      return res.status(500).json({ error: "Authentication failed." });
    }
  };
}

module.exports = checkForAuthenticationCookie;
