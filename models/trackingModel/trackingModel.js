const { DataTypes } = require("sequelize");
const { sequelize } = require("../../dbConnection/dbConfig");

const TaskTracking = sequelize.define(
  "TaskTracking",
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
    helperId: {
      type: DataTypes.UUID,
      references: {
        model: "users",
        key: "id",
      },
      allowNull: false,
    },
    currentLocation: {
      type: DataTypes.JSON, // {lat, lng, address, timestamp}
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM(
        "on_the_way",
        "arrived",
        "work_started", 
        "work_paused",
        "work_resumed",
        "work_completed"
      ),
      allowNull: false,
    },
    estimatedArrival: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    actualArrival: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    workStartTime: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    workEndTime: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    totalWorkDuration: {
      type: DataTypes.INTEGER, // in minutes
      defaultValue: 0,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    photos: {
      type: DataTypes.JSON, // Array of photo URLs
      allowNull: true,
    }
  },
  {
    tableName: "task_tracking",
    timestamps: true,
  }
);

module.exports = TaskTracking;