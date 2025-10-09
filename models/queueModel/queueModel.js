const { DataTypes } = require("sequelize");
const { sequelize } = require("../../dbConnection/dbConfig");

const TaskQueue = sequelize.define(
  "TaskQueue",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    taskId: {
      type: DataTypes.UUID,
      references: {
        model: "tasks",
        key: "id",
      },
      allowNull: false,
    },
    queuePosition: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    priority: {
      type: DataTypes.INTEGER,
      defaultValue: 0, // Higher number = higher priority
    },
    addedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    estimatedWaitTime: {
      type: DataTypes.INTEGER, // in minutes
      allowNull: true,
    },
    notificationsSent: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    lastNotificationAt: {
      type: DataTypes.DATE,
      allowNull: true,
    }
  },
  {
    tableName: "task_queue",
    timestamps: true,
  }
);

module.exports = TaskQueue;