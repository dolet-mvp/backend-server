const { DataTypes } = require("sequelize");
const { sequelize } = require("../../dbConnection/dbConfig");

const Rating = sequelize.define(
  "Rating",
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
    reviewerId: {
      type: DataTypes.UUID,
      references: {
        model: "users",
        key: "id",
      },
      allowNull: false,
    },
    revieweeId: {
      type: DataTypes.UUID,
      references: {
        model: "users",
        key: "id",
      },
      allowNull: false,
    },
    rating: {
      type: DataTypes.DECIMAL(2, 1),
      allowNull: false,
      validate: {
        min: 1.0,
        max: 5.0
      }
    },
    review: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    type: {
      type: DataTypes.ENUM("helper_to_user", "user_to_helper"),
      allowNull: false,
    },
    tags: {
      type: DataTypes.JSON, // ["punctual", "quality_work", "communication", etc.]
      allowNull: true,
    },
    isVisible: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    }
  },
  {
    tableName: "ratings",
    timestamps: true,
  }
);

module.exports = Rating;