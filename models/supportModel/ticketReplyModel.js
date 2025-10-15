const { DataTypes } = require("sequelize");
const { sequelize } = require("../../dbConnection/dbConfig");

const TicketReply = sequelize.define(
  "TicketReply",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    ticketId: {
      type: DataTypes.UUID,
      references: {
        model: "support_tickets",
        key: "id",
      },
      allowNull: false,
    },
    userId: {
      type: DataTypes.UUID,
      references: {
        model: "users",
        key: "id",
      },
      allowNull: false,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    attachments: {
      type: DataTypes.JSON, // Array of file URLs
      allowNull: true,
      defaultValue: [],
    },
    isAdminReply: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    isInternal: {
      type: DataTypes.BOOLEAN,
      defaultValue: false, // Internal notes only visible to admins
    },
  },
  {
    tableName: "ticket_replies",
    timestamps: true,
  }
);

module.exports = TicketReply;
