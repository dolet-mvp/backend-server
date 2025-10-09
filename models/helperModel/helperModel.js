const { DataTypes } = require("sequelize");
const { sequelize } = require("../../dbConnection/dbConfig");

const HelperProfile = sequelize.define(
  "HelperProfile",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      references: {
        model: "users",
        key: "id",
      },
      allowNull: false,
    },
    skills: {
      type: DataTypes.JSON, // Array of skills
      allowNull: true,
    },
    experience: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    hourlyRate: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    availability: {
      type: DataTypes.JSON, // Schedule object
      allowNull: true,
    },
    serviceRadius: {
      type: DataTypes.INTEGER, // in kilometers
      defaultValue: 10,
    },
    isAvailable: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    completedTasks: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    averageRating: {
      type: DataTypes.DECIMAL(2, 1),
      defaultValue: 0.0,
    },
    totalEarnings: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0.00,
    },
    verificationStatus: {
      type: DataTypes.ENUM("pending", "verified", "rejected"),
      defaultValue: "pending",
    },
    documents: {
      type: DataTypes.JSON, // Array of document URLs
      allowNull: true,
    },
    preferences: {
      type: DataTypes.JSON, // Task preferences
      allowNull: true,
    }
  },
  {
    tableName: "helper_profiles",
    timestamps: true,
  }
);

module.exports = HelperProfile;