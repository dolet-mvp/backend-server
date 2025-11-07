const { validateToken } = require("../services/authServices");


function checkForAuthenticationCookie() {
  return (req, res, next) => {
    try {
      let token;

      // Extract token from Authorization header
      if (req.headers.authorization) {
        const authHeader = req.headers.authorization;
        if (authHeader.startsWith("Bearer ")) {
          token = authHeader.split(" ")[1];
        }
      }

      if (!token) {
        return res.status(401).json({ 
          success: false,
          error: "No token found. Please login." 
        });
      }

      const userPayload = validateToken(token);
      if (!userPayload) {
        return res.status(401).json({ 
          success: false,
          error: "Invalid or expired token." 
        });
      }

      req.user = userPayload;
      next();
    } catch (error) {
      console.error("Auth error:", error.message);
      return res.status(500).json({ 
        success: false,
        error: "Authentication failed." 
      });
    }
  };
}


function checkUserType(allowedTypes) {
  return (req, res, next) => {
    const types = Array.isArray(allowedTypes) ? allowedTypes : [allowedTypes];
    
    if (!req.user || !req.user.userType) {
      return res.status(401).json({
        success: false,
        error: "Authentication required"
      });
    }

    if (!types.includes(req.user.userType)) {
      return res.status(403).json({
        success: false,
        error: `Access denied. Required user type: ${types.join(' or ')}`
      });
    }

    next();
  };
}

// Export both functions
module.exports = {
  checkForAuthenticationCookie,
  checkUserType
};
