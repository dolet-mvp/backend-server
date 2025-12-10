const { DataTypes } = require("sequelize");
const {sequelize} = require("../../dbConnection/dbConfig");

const BlockedUser = sequelize.define(
  "BlockedUser",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: "ID of the blocked user (helper, helpseeker, or admin)",
    },
    userType: {
      type: DataTypes.ENUM("helper", "helpseeker", "admin"),
      allowNull: false,
      comment: "Type of user being blocked",
    },
    blockType: {
      type: DataTypes.ENUM("temporary", "permanent"),
      allowNull: false,
      defaultValue: "temporary",
      comment: "Type of block - temporary or permanent",
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: "Reason for blocking the user",
    },
    blockedBy: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: "Admin ID who blocked this user",
    },
    blockedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: "Timestamp when user was blocked",
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "Expiry time for temporary blocks (null for permanent)",
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: "Whether the block is currently active",
    },
    unblockedBy: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: "Admin ID who unblocked this user",
    },
    unblockedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "Timestamp when user was unblocked",
    },
    unblockReason: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "Reason for unblocking the user",
    },
  },
  {
    tableName: "blocked_users",
    timestamps: true,
    indexes: [
      {
        unique: false,
        fields: ["userId"],
      },
      {
        unique: false,
        fields: ["isActive"],
      },
      {
        unique: false,
        fields: ["userType"],
      },
      {
        unique: false,
        fields: ["blockType"],
      },
    ],
  }
);

module.exports = BlockedUser;
