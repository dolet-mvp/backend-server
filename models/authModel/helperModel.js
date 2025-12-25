const { DataTypes } = require("sequelize");
const { sequelize } = require("../../dbConnection/dbConfig");

const Helper = sequelize.define(
  "Helper",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    fullName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },
    password: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },
    profilePhoto: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    isAvailable: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    // Helper specific fields
    accountNumber: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    ifscCode: {
      type: DataTypes.STRING,
      allowNull: true,
    },
        accountHolderName: {
      type: DataTypes.STRING, 
      allowNull: true,
    },
    aadharCardDocument: {
      type: DataTypes.TEXT, // URL to uploaded Aadhar card (TEXT for encrypted URLs)
      allowNull: true,
    },
    addressProofDocument: {
      type: DataTypes.TEXT, // URL to uploaded address proof (TEXT for encrypted URLs)
      allowNull: true,
    },
    drivingLicenseDocument: {
      type: DataTypes.TEXT, // URL to uploaded driving license (TEXT for encrypted URLs)
      allowNull: true,
    },
    isApproved: {
      type: DataTypes.BOOLEAN,
      defaultValue: false, // False until admin approves
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
      type: DataTypes.ENUM("pending","submitted", "approved", "rejected"),
      defaultValue: "pending",
    },
    rejectionReason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    approvedBy: {
      type: DataTypes.UUID, // Admin who approved
      allowNull: true,
    },
    approvedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "helpers",
    timestamps: true,
  }
);

module.exports = Helper;
