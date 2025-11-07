const { DataTypes } = require("sequelize");
const { sequelize } = require("../../dbConnection/dbConfig");

const Notification = sequelize.define(
  "Notification",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // Polymorphic association - can belong to helper or helpseeker
    helperId: {
      type: DataTypes.UUID,
      references: {
        model: "helpers",
        key: "id",
      },
      allowNull: true,
    },
    helpseekerId: {
      type: DataTypes.UUID,
      references: {
        model: "helpseekers",
        key: "id",
      },
      allowNull: true,
    },
    userType: {
      type: DataTypes.ENUM("helper", "helpseeker"),
      allowNull: false,
    },
    taskId: {
      type: DataTypes.UUID,
      references: {
        model: "tasks",
        key: "id",
      },
      allowNull: true,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM(
        "task_created",
        "bid_received", 
        "bid_accepted",
        "bid_rejected",
        "task_assigned",
        "task_started",
        "task_completed",
        "payment_received",
        "payment_sent",
        "payment_requested",
        "payment_request_sent",
        "rating_received",
        "helper_request",
        "request_sent",
        "request_approved",
        "helper_approved",
        "request_rejected",
        "request_cancelled",
        "otp_regenerated",
        "general",
        "reminder"
      ),
      allowNull: false,
    },
    isRead: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    actionUrl: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    priority: {
      type: DataTypes.ENUM("low", "medium", "high"),
      defaultValue: "medium",
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
    }
  },
  {
    tableName: "notifications",
    timestamps: true,
  }
);

module.exports = Notification;