
const authorizeRoles = (userTypes) => {
    return (req, res, next) => {
   try {
   const types = Array.isArray(userTypes) ? userTypes : [userTypes];
   
   if(!req.user || !req.user.userType){
     return res.status(401).json({
       success: false,
       message: "Authentication required"
     });
   }
   
   if(!types.includes(req.user.userType)){
     console.log(`Unauthorized access attempt. User type: ${req.user.userType}, Required: ${types.join(' or ')}`);
     return res.status(403).json({
       success: false,
       message: `Unauthorized Access! Required user type: ${types.join(' or ')}`
     });
   } 
   next();
   } catch (error) {
    console.log("Authorization error:", error);
    return res.status(500).json({
      success: false,
      message: "Authorization failed"
    });
   }
    };
  };
  
  module.exports = { authorizeRoles };
  