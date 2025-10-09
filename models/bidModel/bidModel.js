const { DataTypes } = require("sequelize");
const { sequelize } = require("../../dbConnection/dbConfig");

const Bid = sequelize.define(
  "Bid",
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
    bidAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    estimatedDuration: {
      type: DataTypes.INTEGER, // in hours
      allowNull: true,
    },
    proposedStartDate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("pending", "accepted", "rejected", "withdrawn"),
      defaultValue: "pending",
    },
    isCounterOffer: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    originalBidId: {
      type: DataTypes.UUID,
      references: {
        model: "bids",
        key: "id",
      },
      allowNull: true,
    }
  },
  {
    tableName: "bids",
    timestamps: true,
  }
);

module.exports = Bid;