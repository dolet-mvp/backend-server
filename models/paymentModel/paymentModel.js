const { DataTypes } = require("sequelize");
const { sequelize } = require("../../dbConnection/dbConfig");

const Payment = sequelize.define(
  "Payment",
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
    // Payer is always helpseeker
    payerId: {
      type: DataTypes.UUID,
      references: {
        model: "helpseekers",
        key: "id",
      },
      allowNull: false,
    },
    // Receiver is always helper
    receiverId: {
      type: DataTypes.UUID,
      references: {
        model: "helpers",
        key: "id",
      },
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    platformFee: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0.00,
    },
    netAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    paymentMethod: {
      type: DataTypes.ENUM("card", "bank_transfer", "digital_wallet", "cash"),
      allowNull: false,
    },
    paymentGateway: {
      type: DataTypes.STRING,
      allowNull: true, // stripe, razorpay, etc.
    },
    transactionId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM(
        "pending",
        "processing", 
        "completed",
        "failed",
        "refunded",
        "disputed"
      ),
      defaultValue: "pending",
    },
    type: {
      type: DataTypes.ENUM("task_payment", "bonus", "refund", "penalty"),
      defaultValue: "task_payment",
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    processedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    failureReason: {
      type: DataTypes.TEXT,
      allowNull: true,
    }
  },
  {
    tableName: "payments",
    timestamps: true,
  }
);

module.exports = Payment;