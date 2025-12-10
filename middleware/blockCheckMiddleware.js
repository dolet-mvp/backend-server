const BlockedUser = require("../models/blockedUserModel/blockedUserModel");
const { Op } = require("sequelize");


const checkUserBlocked = async (req, res, next) => {
  try {
    // Skip if user is not authenticated
    if (!req.user || !req.user.id) {
      return next();
    }

    const userId = req.user.id;
    const userType = req.user.userType; // 'helper', 'helpseeker', or 'admin'

    // Check if user has an active block
    const activeBlock = await BlockedUser.findOne({
      where: {
        userId: userId,
        userType: userType,
        isActive: true,
        [Op.or]: [
          // Permanent block
          {
            blockType: "permanent",
          },
          // Temporary block that hasn't expired
          {
            blockType: "temporary",
            expiresAt: {
              [Op.gt]: new Date(),
            },
          },
        ],
      },
      order: [["blockedAt", "DESC"]],
    });

    if (activeBlock) {
      console.log(`🚫 Blocked user ${userId} (${userType}) attempted to access: ${req.method} ${req.path}`);
      
      // Determine block message
      let message = "Your account has been blocked.";
      let expiryInfo = null;

      if (activeBlock.blockType === "permanent") {
        message = "Your account has been permanently blocked.";
      } else if (activeBlock.blockType === "temporary") {
        const expiresAt = new Date(activeBlock.expiresAt);
        const now = new Date();
        const hoursRemaining = Math.ceil((expiresAt - now) / (1000 * 60 * 60));
        
        message = `Your account is temporarily blocked.`;
        expiryInfo = {
          expiresAt: expiresAt.toISOString(),
          hoursRemaining: hoursRemaining,
        };
      }

      return res.status(403).json({
        success: false,
        error: "ACCOUNT_BLOCKED",
        message: message,
        blockDetails: {
          blockType: activeBlock.blockType,
          reason: activeBlock.reason,
          blockedAt: activeBlock.blockedAt,
          expiresAt: activeBlock.expiresAt,
          ...expiryInfo,
        },
      });
    }

    // Auto-deactivate expired temporary blocks
    await BlockedUser.update(
      { isActive: false },
      {
        where: {
          userId: userId,
          userType: userType,
          isActive: true,
          blockType: "temporary",
          expiresAt: {
            [Op.lte]: new Date(),
          },
        },
      }
    );

    // User is not blocked, proceed
    next();
  } catch (error) {
    console.error("❌ Error in block check middleware:", error);
    // Don't block the request if there's an error checking
    // Log the error and continue
    next();
  }
};

module.exports = { checkUserBlocked };
