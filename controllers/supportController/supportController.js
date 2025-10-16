const SupportTicket = require("../../models/supportModel/supportTicketModel");
const TicketReply = require("../../models/supportModel/ticketReplyModel");
const User = require("../../models/authModel/userModel");
const Notification = require("../../models/notificationModel/notificationModel");

// Generate unique ticket ID
const generateTicketId = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `TKT-${timestamp}-${random}`;
};

const createTicket = async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, subject, description, priority, category } = req.body;

    // Validation
    if (!title || !subject || !description) {
      return res.status(400).json({
        success: false,
        message: "Title, subject, and description are required",
      });
    }

    // Generate unique ticket ID
    const ticketId = generateTicketId();

    // Handle attachments from Supabase upload
    const attachments = req.fileUrls || [];

    // Create ticket
    const ticket = await SupportTicket.create({
      ticketId,
      userId,
      title,
      subject,
      description,
      attachments,
      priority: priority || "medium",
      category,
      status: "open",
    });

    // Create notification for user (without email)
    await Notification.create({
      userId,
      title: "Support Ticket Created",
      message: `Your support ticket ${ticketId} has been created successfully. Our team will respond soon.`,
      type: "general",
      priority: "medium",
    });

    res.status(201).json({
      success: true,
      message: "Support ticket created successfully",
      data: {
        ticket,
        ticketId,
      },
    });
  } catch (error) {
    console.error("Create ticket error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create support ticket",
      error: error.message,
    });
  }
};

// Get user's tickets
const getMyTickets = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, subject} = req.query;

    const where = { userId };

    if (status) {
      where.status = status;
    }

    if (subject) {
      where.subject = subject;
    }


    const tickets = await SupportTicket.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: "assignedAdmin",
          attributes: ["id", "fullName", "email"],
        },
        {
          model: TicketReply,
          as: "replies",
          limit: 1,
          order: [["createdAt", "DESC"]],
          include: [
            {
              model: User,
              as: "user",
              attributes: ["id", "fullName", "profilePhoto"],
            },
          ],
        },
      ],
      order: [["createdAt", "DESC"]],

    });

    res.status(200).json({
      success: true,
      data: {
        tickets,
      },
    });
  } catch (error) {
    console.error("Get my tickets error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch tickets",
      error: error.message,
    });
  }
};

// Get single ticket details
const getTicketDetails = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check if ticketId is UUID (database id) or generated ticketId (TKT-XXXXX)
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ticketId);
    
    const ticket = await SupportTicket.findOne({
      where: isUUID ? { id: ticketId } : { ticketId },
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "fullName", "email", "profilePhoto", "role"],
        },
        {
          model: User,
          as: "assignedAdmin",
          attributes: ["id", "fullName", "email", "profilePhoto"],
        },
        {
          model: TicketReply,
          as: "replies",
          where:
            userRole === "admin"
              ? {} // Admin can see all replies including internal
              : { isInternal: false }, // Users can't see internal notes
          required: false,
          include: [
            {
              model: User,
              as: "user",
              attributes: ["id", "fullName", "email", "profilePhoto", "role"],
            },
          ],
          order: [["createdAt", "ASC"]],
        },
      ],
    });

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    // Check authorization (user can only see their own tickets, admin can see all)
    if (userRole !== "admin" && ticket.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to view this ticket",
      });
    }

    res.status(200).json({
      success: true,
      data: ticket,
    });
  } catch (error) {
    console.error("Get ticket details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch ticket details",
      error: error.message,
    });
  }
};

// Reply to a ticket
const replyToTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;
    const { message, isInternal } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        message: "Message is required",
      });
    }

    const ticket = await SupportTicket.findOne({
      where: { ticketId },
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "fullName", "email"],
        },
      ],
    });

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    // Check authorization
    if (userRole !== "admin" && ticket.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to reply to this ticket",
      });
    }

    // Only admins can create internal notes
    const isInternalNote = userRole === "admin" && isInternal === true;

    // Handle attachments
    const attachments = req.fileUrls || [];

    // Create reply
    const reply = await TicketReply.create({
      ticketId: ticket.id,
      userId,
      message,
      attachments,
      isAdminReply: userRole === "admin",
      isInternal: isInternalNote,
    });

    // Update ticket's last response time
    ticket.lastResponseAt = new Date();

    // If admin replied, update status
    if (userRole === "admin") {
      if (ticket.status === "open") {
        ticket.status = "in_progress";
      } else if (ticket.status === "waiting_for_response") {
        ticket.status = "in_progress";
      }
    } else {
      // If user replied to an in_progress ticket
      if (ticket.status === "in_progress") {
        ticket.status = "waiting_for_response";
      }
    }

    await ticket.save();

    // Get reply with user details
    const replyWithUser = await TicketReply.findByPk(reply.id, {
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "fullName", "email", "profilePhoto", "role"],
        },
      ],
    });

    // Create notification (only for non-internal replies, no email)
    if (!isInternalNote) {
      if (userRole === "admin") {
        // Notify ticket creator
        await Notification.create({
          userId: ticket.userId,
          title: "New Support Response",
          message: `Your ticket ${ticketId} has received a new response from support team.`,
          type: "general",
          priority: "medium",
        });
      }
    }

    res.status(201).json({
      success: true,
      message: "Reply added successfully",
      data: replyWithUser,
    });
  } catch (error) {
    console.error("Reply to ticket error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reply to ticket",
      error: error.message,
    });
  }
};

// Get all tickets (Admin only)
const getAllTickets = async (req, res) => {
  try {
    const {
      status,
      subject,
      priority,
      search,
      page = 1,
      limit = 10,
    } = req.query;

    const where = {};

    if (status) {
      where.status = status;
    }

    if (subject) {
      where.subject = subject;
    }

    if (priority) {
      where.priority = priority;
    }

    if (search) {
      where[require("sequelize").Op.or] = [
        { ticketId: { [require("sequelize").Op.iLike]: `%${search}%` } },
        { title: { [require("sequelize").Op.iLike]: `%${search}%` } },
        { description: { [require("sequelize").Op.iLike]: `%${search}%` } },
      ];
    }

    const offset = (page - 1) * limit;

    const { count, rows: tickets } = await SupportTicket.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "fullName", "email", "profilePhoto", "role"],
        },
        {
          model: User,
          as: "assignedAdmin",
          attributes: ["id", "fullName", "email"],
        },
        {
          model: TicketReply,
          as: "replies",
          limit: 1,
          order: [["createdAt", "DESC"]],
        },
      ],
      order: [
        ["priority", "DESC"], // urgent first
        ["createdAt", "DESC"],
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    // Get statistics
    const stats = {
      total: count,
      open: await SupportTicket.count({ where: { status: "open" } }),
      inProgress: await SupportTicket.count({ where: { status: "in_progress" } }),
      waitingForResponse: await SupportTicket.count({
        where: { status: "waiting_for_response" },
      }),
      resolved: await SupportTicket.count({ where: { status: "resolved" } }),
      closed: await SupportTicket.count({ where: { status: "closed" } }),
    };

    res.status(200).json({
      success: true,
      data: {
        tickets,
        stats,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count / limit),
        },
      },
    });
  } catch (error) {
    console.error("Get all tickets error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch tickets",
      error: error.message,
    });
  }
};

// Update ticket status (Admin only)
const updateTicketStatus = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { status, priority, assignedAdminId } = req.body;

    const ticket = await SupportTicket.findOne({
      where: { ticketId },
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "fullName", "email"],
        },
      ],
    });

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    const updates = {};

    if (status) {
      updates.status = status;

      if (status === "resolved") {
        updates.resolvedAt = new Date();
      } else if (status === "closed") {
        updates.closedAt = new Date();
      }
    }

    if (priority) {
      updates.priority = priority;
    }

    if (assignedAdminId !== undefined) {
      updates.assignedAdminId = assignedAdminId;
    }

    await ticket.update(updates);

    // Create notification to user about status change
    if (status) {
      await Notification.create({
        userId: ticket.userId,
        title: "Ticket Status Updated",
        message: `Your ticket ${ticketId} status has been updated to: ${status}`,
        type: "support_ticket",
        priority: "medium",
      });
    }

    res.status(200).json({
      success: true,
      message: "Ticket updated successfully",
      data: ticket,
    });
  } catch (error) {
    console.error("Update ticket status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update ticket",
      error: error.message,
    });
  }
};



// Get ticket statistics (Admin only)
const getTicketStatistics = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const where = {};
    if (startDate && endDate) {
      where.createdAt = {
        [require("sequelize").Op.between]: [new Date(startDate), new Date(endDate)],
      };
    }

    const stats = {
      total: await SupportTicket.count({ where }),
      byStatus: {
        open: await SupportTicket.count({ where: { ...where, status: "open" } }),
        inProgress: await SupportTicket.count({
          where: { ...where, status: "in_progress" },
        }),
        waitingForResponse: await SupportTicket.count({
          where: { ...where, status: "waiting_for_response" },
        }),
        resolved: await SupportTicket.count({
          where: { ...where, status: "resolved" },
        }),
        closed: await SupportTicket.count({ where: { ...where, status: "closed" } }),
        reopened: await SupportTicket.count({
          where: { ...where, status: "reopened" },
        }),
      },
      byPriority: {
        low: await SupportTicket.count({ where: { ...where, priority: "low" } }),
        medium: await SupportTicket.count({ where: { ...where, priority: "medium" } }),
        high: await SupportTicket.count({ where: { ...where, priority: "high" } }),
        urgent: await SupportTicket.count({ where: { ...where, priority: "urgent" } }),
      },
      bySubject: {},
      averageRating: await SupportTicket.findOne({
        attributes: [
          [
            require("sequelize").fn("AVG", require("sequelize").col("rating")),
            "avgRating",
          ],
        ],
        where: {
          ...where,
          rating: { [require("sequelize").Op.ne]: null },
        },
        raw: true,
      }),
    };

    // Get count by subject
    const subjects = [
      "technical_issue",
      "payment_issue",
      "account_issue",
      "task_issue",
      "feature_request",
      "bug_report",
      "general_inquiry",
      "other",
    ];

    for (const subject of subjects) {
      stats.bySubject[subject] = await SupportTicket.count({
        where: { ...where, subject },
      });
    }

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Get ticket statistics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch statistics",
      error: error.message,
    });
  }
};

module.exports = {
  createTicket,
  getMyTickets,
  getTicketDetails,
  replyToTicket,
  getAllTickets,
  updateTicketStatus,
  getTicketStatistics,
};
