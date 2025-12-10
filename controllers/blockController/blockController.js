const BlockedUser = require("../../models/blockedUserModel/blockedUserModel");
const Helper = require("../../models/authModel/helperModel");
const Helpseeker = require("../../models/authModel/helpseekerModel");
const Admin = require("../../models/authModel/adminModel");
const { Op } = require("sequelize");


const blockUser = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { userId,userType, blockType, reason, durationHours } = req.body;

    // Validate required fields
    if (!userId || !userType || !blockType || !reason) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: userId, userType, blockType, reason",
      });
    }

    // Validate userType
    if (!["helper", "helpseeker", "admin"].includes(userType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid userType. Must be: helper, helpseeker, or admin",
      });
    }

    // Validate blockType
    if (!["temporary", "permanent"].includes(blockType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid blockType. Must be: temporary or permanent",
      });
    }

    // Validate durationHours for temporary blocks
    if (blockType === "temporary" && !durationHours) {
      return res.status(400).json({
        success: false,
        message: "durationHours is required for temporary blocks",
      });
    }

    if (blockType === "temporary" && (durationHours < 1 || durationHours > 8760)) {
      return res.status(400).json({
        success: false,
        message: "durationHours must be between 1 and 8760 (1 year)",
      });
    }

    // Verify user exists
    let user = null;
    if (userType === "helper") {
      user = await Helper.findByPk(userId);
    } else if (userType === "helpseeker") {
      user = await Helpseeker.findByPk(userId);
    } else if (userType === "admin") {
      user = await Admin.findByPk(userId);
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: `${userType} not found`,
      });
    }

    // Prevent admin from blocking themselves
    if (userId === adminId) {
      return res.status(400).json({
        success: false,
        message: "You cannot block yourself",
      });
    }

    // Check if user already has an active block
    const existingBlock = await BlockedUser.findOne({
      where: {
        userId: userId,
        userType: userType,
        isActive: true,
        [Op.or]: [
          { blockType: "permanent" },
          {
            blockType: "temporary",
            expiresAt: { [Op.gt]: new Date() },
          },
        ],
      },
    });

    if (existingBlock) {
      return res.status(409).json({
        success: false,
        message: "User is already blocked",
        existingBlock: {
          id: existingBlock.id,
          blockType: existingBlock.blockType,
          reason: existingBlock.reason,
          blockedAt: existingBlock.blockedAt,
          expiresAt: existingBlock.expiresAt,
        },
      });
    }

    // Calculate expiry time for temporary blocks
    let expiresAt = null;
    if (blockType === "temporary") {
      expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + parseInt(durationHours));
    }

    // Create block record
    const blockedUser = await BlockedUser.create({
      userId: userId,
      userType: userType,
      blockType: blockType,
      reason: reason,
      blockedBy: adminId,
      blockedAt: new Date(),
      expiresAt: expiresAt,
      isActive: true,
    });

    console.log(`🚫 Admin ${adminId} blocked ${userType} ${userId} (${blockType})`);

    res.status(201).json({
      success: true,
      message: `User blocked successfully (${blockType})`,
      block: {
        id: blockedUser.id,
        userId: blockedUser.userId,
        userType: blockedUser.userType,
        blockType: blockedUser.blockType,
        reason: blockedUser.reason,
        blockedBy: blockedUser.blockedBy,
        blockedAt: blockedUser.blockedAt,
        expiresAt: blockedUser.expiresAt,
      },
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
      },
    });
  } catch (error) {
    console.error("❌ Error blocking user:", error);
    res.status(500).json({
      success: false,
      message: "Failed to block user",
      error: error.message,
    });
  }
};


const unblockUser = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { userId,userType, unblockReason } = req.body;

    // Validate required fields
    if (!userId || !userType) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: userId, userType",
      });
    }

    // Validate userType
    if (!["helper", "helpseeker", "admin"].includes(userType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid userType. Must be: helper, helpseeker, or admin",
      });
    }

    // Find active block
    const activeBlock = await BlockedUser.findOne({
      where: {
        userId: userId,
        userType: userType,
        isActive: true,
      },
      order: [["blockedAt", "DESC"]],
    });

    if (!activeBlock) {
      return res.status(404).json({
        success: false,
        message: "No active block found for this user",
      });
    }

    // Update block record to inactive
    activeBlock.isActive = false;
    activeBlock.unblockedBy = adminId;
    activeBlock.unblockedAt = new Date();
    activeBlock.unblockReason = unblockReason || "Unblocked by admin";
    await activeBlock.save();

    console.log(` Admin ${adminId} unblocked ${userType} ${userId}`);

    res.status(200).json({
      success: true,
      message: "User unblocked successfully",
      block: {
        id: activeBlock.id,
        userId: activeBlock.userId,
        userType: activeBlock.userType,
        blockType: activeBlock.blockType,
        blockedAt: activeBlock.blockedAt,
        unblockedAt: activeBlock.unblockedAt,
        unblockedBy: activeBlock.unblockedBy,
        unblockReason: activeBlock.unblockReason,
      },
    });
  } catch (error) {
    console.error("❌ Error unblocking user:", error);
    res.status(500).json({
      success: false,
      message: "Failed to unblock user",
      error: error.message,
    });
  }
};


const getAllBlockedUsers = async (req, res) => {
  try {
    
    const { status = "active", userType, blockType, page = 1, limit = 20 } = req.query;

    // Build where clause
    const whereClause = {};

    // Filter by active/inactive/all
    if (status === "active") {
      whereClause.isActive = true;
      whereClause[Op.or] = [
        { blockType: "permanent" },
        {
          blockType: "temporary",
          expiresAt: { [Op.gt]: new Date() },
        },
      ];
    } else if (status === "inactive") {
      whereClause.isActive = false;
    }
    // 'all' means no isActive filter

    // Filter by userType
    if (userType && ["helper", "helpseeker", "admin"].includes(userType)) {
      whereClause.userType = userType;
    }

    // Filter by blockType
    if (blockType && ["temporary", "permanent"].includes(blockType)) {
      whereClause.blockType = blockType;
    }

    // Pagination
    const offset = (page - 1) * limit;

    const { count, rows: blockedUsers } = await BlockedUser.findAndCountAll({
      where: whereClause,
      order: [["blockedAt", "DESC"]],
      limit: parseInt(limit),
      offset: offset,
    });

    // Fetch user details for each blocked user
    const blockedUsersWithDetails = await Promise.all(
      blockedUsers.map(async (block) => {
        let user = null;
        if (block.userType === "helper") {
          user = await Helper.findByPk(block.userId, {
            attributes: ["id", "fullName", "email", "phone", "profilePhoto"],
          });
        } else if (block.userType === "helpseeker") {
          user = await Helpseeker.findByPk(block.userId, {
            attributes: ["id", "fullName", "email", "phone", "profilePhoto"],
          });
        } else if (block.userType === "admin") {
          user = await Admin.findByPk(block.userId, {
            attributes: ["id", "fullName", "email", "phone"],
          });
        }

        return {
          id: block.id,
          userId: block.userId,
          userType: block.userType,
          blockType: block.blockType,
          reason: block.reason,
          blockedBy: block.blockedBy,
          blockedAt: block.blockedAt,
          expiresAt: block.expiresAt,
          isActive: block.isActive,
          unblockedBy: block.unblockedBy,
          unblockedAt: block.unblockedAt,
          unblockReason: block.unblockReason,
          user: user,
        };
      })
    );

    res.status(200).json({
      success: true,
      message: "Blocked users retrieved successfully",
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit),
      },
      blockedUsers: blockedUsersWithDetails,
    });
  } catch (error) {
    console.error("❌ Error getting blocked users:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get blocked users",
      error: error.message,
    });
  }
};

/**
 * Get block history for a specific user
 * Admin only
 */
const getUserBlockHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const { userType } = req.query;

    if (!userType || !["helper", "helpseeker", "admin"].includes(userType)) {
      return res.status(400).json({
        success: false,
        message: "Valid userType query parameter required (helper, helpseeker, admin)",
      });
    }

    // Get all blocks for this user
    const blocks = await BlockedUser.findAll({
      where: {
        userId: userId,
        userType: userType,
      },
      order: [["blockedAt", "DESC"]],
    });

    // Get user details
    let user = null;
    if (userType === "helper") {
      user = await Helper.findByPk(userId, {
        attributes: ["id", "fullName", "email", "phone", "profilePhoto"],
      });
    } else if (userType === "helpseeker") {
      user = await Helpseeker.findByPk(userId, {
        attributes: ["id", "fullName", "email", "phone", "profilePhoto"],
      });
    } else if (userType === "admin") {
      user = await Admin.findByPk(userId, {
        attributes: ["id", "fullName", "email", "phone"],
      });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: `${userType} not found`,
      });
    }

    res.status(200).json({
      success: true,
      message: "Block history retrieved successfully",
      user: user,
      blockHistory: blocks,
      totalBlocks: blocks.length,
      activeBlocks: blocks.filter((b) => b.isActive).length,
    });
  } catch (error) {
    console.error("❌ Error getting user block history:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get block history",
      error: error.message,
    });
  }
};

/**
 * Check if a user is currently blocked
 * Admin only
 */
const checkUserBlockStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { userType } = req.query;

    if (!userType || !["helper", "helpseeker", "admin"].includes(userType)) {
      return res.status(400).json({
        success: false,
        message: "Valid userType query parameter required (helper, helpseeker, admin)",
      });
    }

    // Check for active block
    const activeBlock = await BlockedUser.findOne({
      where: {
        userId: userId,
        userType: userType,
        isActive: true,
        [Op.or]: [
          { blockType: "permanent" },
          {
            blockType: "temporary",
            expiresAt: { [Op.gt]: new Date() },
          },
        ],
      },
      order: [["blockedAt", "DESC"]],
    });

    const isBlocked = !!activeBlock;

    res.status(200).json({
      success: true,
      isBlocked: isBlocked,
      blockDetails: activeBlock || null,
    });
  } catch (error) {
    console.error("❌ Error checking block status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check block status",
      error: error.message,
    });
  }
};

module.exports = {
  blockUser,
  unblockUser,
  getAllBlockedUsers,
  getUserBlockHistory,
  checkUserBlockStatus,
};
