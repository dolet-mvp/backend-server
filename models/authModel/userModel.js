const { DataTypes } = require("sequelize");
const { sequelize } = require("../../dbConnection/dbConfig");

const User = sequelize.define(
  "User",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    googleId: {
      type: DataTypes.STRING,
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
    profilePhoto: {
      type: DataTypes.STRING,
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },
    isVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    role: {
      type: DataTypes.ENUM("helpseeker", "helper", "admin"),
      defaultValue: "helpseeker",
    },
  },
  {
    tableName: "users",
    timestamps: true,
  }
);

module.exports = User;