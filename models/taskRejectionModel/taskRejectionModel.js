const { DataTypes } = require("sequelize");
const { sequelize } = require("../../dbConnection/dbConfig");

const TaskRejection = sequelize.define(
  "TaskRejection",
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
        model: "helpers",
        key: "id",
      },
      allowNull: false,
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: "No reason provided",
    },
    reasonCategory: {
      type: DataTypes.ENUM("price", "distance", "availability", "skills", "other"),
      allowNull: true,
      defaultValue: "other",
    },
    minPrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      comment: "Minimum price suggested by helper if rejecting due to low budget",
    },
    rejectedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      allowNull: false,
    },
  },
  {
    tableName: "task_rejections",
    timestamps: true,
  }
);

module.exports = TaskRejection;
