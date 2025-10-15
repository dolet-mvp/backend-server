const { DataTypes } = require("sequelize");
const { sequelize } = require("../../dbConnection/dbConfig");

const Task = sequelize.define(
  "Task",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      references: {
        model: "users",
        key: "id",
      },
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    category: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    skillsRequired: {
      type: DataTypes.JSON, 
      allowNull: true,
    },
    budget: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    estimatedDuration: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    dueDate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    priority: {
      type: DataTypes.ENUM("low", "medium", "high", "urgent"),
      defaultValue: "medium",
    },
    status: {
      type: DataTypes.ENUM(
        "draft",
        "published",
        "in_queue",
        "assigned",
        "in_progress", 
        "completed",
        "cancelled",
        "disputed"
      ),
      defaultValue: "draft",
    },
    locationRequired: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    location: {
      type: DataTypes.JSON, // {address, lat, lng, city, state}
      allowNull: true,
    },
    attachments: {
      type: DataTypes.JSON, // Array of file URLs
      allowNull: true,
    },
    requirements: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    assignedHelperId: {
      type: DataTypes.UUID,
      references: {
        model: "users",
        key: "id",
      },
      allowNull: true,
    },
    pendingHelperId: {
      type: DataTypes.UUID,
      references: {
        model: "users",
        key: "id",
      },
      allowNull: true,
    },
    acceptedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    startedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    isUrgent: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    verificationOtp: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    otpGeneratedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    otpVerifiedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    isOtpVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    allowDirectAcceptance: {
      type: DataTypes.BOOLEAN,
      defaultValue: true, // Allow helpers to accept directly without bidding
    }
  },
  {
    tableName: "tasks",
    timestamps: true,
  }
);

module.exports = Task;