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
      references: {
        model: "users",
        key: "id",
      },
      onDelete: "CASCADE",
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
