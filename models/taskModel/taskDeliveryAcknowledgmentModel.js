const { DataTypes } = require("sequelize");
const { sequelize } = require("../../dbConnection/dbConfig");

/**
 * TaskDeliveryAcknowledgment Model
 * Tracks task delivery attempts and acknowledgments to ensure helpers reliably receive tasks
 */
const TaskDeliveryAcknowledgment = sequelize.define(
  "TaskDeliveryAcknowledgment",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    taskId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "tasks",
        key: "id",
      },
      onDelete: "CASCADE",
    },
    helperId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "helpers",
        key: "id",
      },
      onDelete: "CASCADE",
    },
    // Delivery status: pending, delivered, acknowledged, failed
    deliveryStatus: {
      type: DataTypes.ENUM("pending", "delivered", "acknowledged", "failed"),
      defaultValue: "pending",
      allowNull: false,
    },
    // Number of delivery attempts made
    attemptCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false,
    },
    // Last attempt timestamp
    lastAttemptAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // When helper acknowledged receiving the task
    acknowledgedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // Next retry scheduled time (for exponential backoff)
    nextRetryAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // Delivery method: socket, push_notification, both
    deliveryMethod: {
      type: DataTypes.ENUM("socket", "push_notification", "both"),
      defaultValue: "both",
      allowNull: false,
    },
    // Error message if delivery failed
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // Additional metadata (socket ID, device info, etc.)
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  },
  {
    tableName: "task_delivery_acknowledgments",
    timestamps: true,
    indexes: [
      {
        fields: ["taskId", "helperId"],
        unique: true,
      },
      {
        fields: ["deliveryStatus"],
      },
      {
        fields: ["nextRetryAt"],
      },
      {
        fields: ["taskId"],
      },
      {
        fields: ["helperId"],
      },
    ],
  }
);

module.exports = TaskDeliveryAcknowledgment;
