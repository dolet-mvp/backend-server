const { DataTypes } = require("sequelize");
const { sequelize } = require("../../dbConnection/dbConfig");

const TaskMessage = sequelize.define(
  "TaskMessage",
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
    senderId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    senderType: {
      type: DataTypes.ENUM("helper", "helpseeker"),
      allowNull: false,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    attachments: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
      comment: "Array of file URLs or attachment objects",
    },
    status: {
      type: DataTypes.ENUM("sending", "sent", "delivered", "read"),
      allowNull: false,
      defaultValue: "sent",
      comment: "Message delivery status",
    },
    deliveredAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "When message was delivered to recipient",
    },
    readAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "When message was read by recipient",
    },
  },
  {
    tableName: "task_messages",
    timestamps: true,
    indexes: [
      {
        fields: ["taskId"],
      },
      {
        fields: ["senderId"],
      },
      {
        fields: ["createdAt"],
      },
    ],
  }
);

module.exports = TaskMessage;
