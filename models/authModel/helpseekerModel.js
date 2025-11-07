const { DataTypes } = require("sequelize");
const { sequelize } = require("../../dbConnection/dbConfig");

const Helpseeker = sequelize.define(
  "Helpseeker",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    fullName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },
    password: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    profilePhoto: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    isVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    totalTasksPosted: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    totalTasksCompleted: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    totalSpent: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0.00,
    },
    averageRating: {
      type: DataTypes.DECIMAL(2, 1),
      defaultValue: 0.0,
    },
  },
  {
    tableName: "helpseekers",
    timestamps: true,
  }
);

module.exports = Helpseeker;
