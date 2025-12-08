const { DataTypes } = require("sequelize");
const {sequelize} = require("../../dbConnection/dbConfig");

const Report = sequelize.define(
  "Report",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    reporterId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    reporterType: {
      type: DataTypes.ENUM("helper", "helpseeker"),
      allowNull: false,
    },
    reportedUserId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    reportedUserType: {
      type: DataTypes.ENUM("helper", "helpseeker"),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    category: {
      type: DataTypes.ENUM(
        "inappropriate_behavior",
        "fraud",
        "harassment",
        "violence_threat",
        "spam",
        "fake_profile",
        "payment_issue",
        "poor_service",
        "other"
      ),
      allowNull: false,
      defaultValue: "other",
    },
    taskId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("pending", "under_review", "resolved", "dismissed"),
      defaultValue: "pending",
      allowNull: false,
    },
    adminNotes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    actionTaken: {
      type: DataTypes.ENUM(
        "none",
        "warning_issued",
        "account_suspended",
        "account_banned",
        "no_action_needed"
      ),
      allowNull: true,
    },
    reviewedBy: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    reviewedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "reports",
    timestamps: true,

  }
);

module.exports = Report;
