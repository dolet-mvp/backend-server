const { DataTypes } = require("sequelize");
const { sequelize } = require("../../dbConnection/dbConfig");

const SupportTicket = sequelize.define(
  "SupportTicket",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    ticketId: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
    },
    // Polymorphic - can be helper or helpseeker
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    userType: {
      type: DataTypes.ENUM("helper", "helpseeker"),
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    subject: {
      type: DataTypes.ENUM(
        "technical_issue",
        "payment_issue",
        "account_issue",
        "task_issue",
        "feature_request",
        "bug_report",
        "general_inquiry",
        "other"
      ),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    attachments: {
      type: DataTypes.JSON, // Array of file URLs
      allowNull: true,
      defaultValue: [],
    },
    status: {
      type: DataTypes.ENUM(
        "open",
        "in_progress",
        "waiting_for_response",
        "resolved",
        "closed",
        "reopened"
      ),
      defaultValue: "open",
    },
    priority: {
      type: DataTypes.ENUM("low", "medium", "high", "urgent"),
      defaultValue: "medium",
    },
    category: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    assignedAdminId: {
      type: DataTypes.UUID,
      references: {
        model: "admins",
        key: "id",
      },
      allowNull: true,
    },
    resolvedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    closedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    lastResponseAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    rating: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        min: 1,
        max: 5,
      },
    },
    feedback: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "support_tickets",
    timestamps: true,
  }
);

module.exports = SupportTicket;
