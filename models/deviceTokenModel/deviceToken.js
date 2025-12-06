const { DataTypes } = require("sequelize");
const { sequelize } = require("../../dbConnection/dbConfig");

const DeviceToken = sequelize.define(
  "DeviceToken",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // Polymorphic association - can belong to helper or helpseeker
    helperId: {
      type: DataTypes.UUID,
      references: {
        model: "helpers",
        key: "id",
      },
      allowNull: true,
      onDelete: "CASCADE",
    },
    helpseekerId: {
      type: DataTypes.UUID,
      references: {
        model: "helpseekers",
        key: "id",
      },
      allowNull: true,
      onDelete: "CASCADE",
    },
    userType: {
      type: DataTypes.ENUM("helper", "helpseeker"),
      allowNull: false,
    },
    token: {
      type: DataTypes.TEXT,
      allowNull: false,
      unique: true,
    },
    platform: {
      type: DataTypes.ENUM("android", "ios", "web"),
      allowNull: false,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    lastUsed: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    deviceInfo: {
      type: DataTypes.JSONB,
      allowNull: true,
      comment: "Additional device information like model, OS version, etc.",
    },
  },
  {
    tableName: "device_tokens",
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ["token"],
      },
      {
        fields: ["helperId"],
      },
      {
        fields: ["helpseekerId"],
      },
      {
        fields: ["isActive"],
      },
    ],
  }
);

module.exports = DeviceToken;
