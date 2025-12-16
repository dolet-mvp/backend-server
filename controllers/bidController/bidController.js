const Bid = require("../../models/bidModel/bidModel");
const Task = require("../../models/taskModel/taskModel");
const TaskQueue = require("../../models/queueModel/queueModel");
const Notification = require("../../models/notificationModel/notificationModel");
const Helper = require("../../models/authModel/helperModel");
const Helpseeker = require("../../models/authModel/helpseekerModel");
const { sendToUser } = require("../../services/pushNotificationService");

// Helper function to parse date from multiple formats
const parseDate = (dateString) => {
  if (!dateString) return null;

  // If it's already a valid Date object or ISO string
  const isoDate = new Date(dateString);
  if (!isNaN(isoDate.getTime()) && dateString.includes('-') && dateString.length > 10) {
    return isoDate;
  }

  // Try DD-MM-YYYY format
  const ddmmyyyyRegex = /^(\d{2})-(\d{2})-(\d{4})$/;
  const ddmmyyyyMatch = dateString.match(ddmmyyyyRegex);
  if (ddmmyyyyMatch) {
    const [, day, month, year] = ddmmyyyyMatch;
    const date = new Date(year, month - 1, day, 23, 59, 59, 999);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  // Try YYYY-MM-DD format
  const yyyymmddRegex = /^(\d{4})-(\d{2})-(\d{2})$/;
  const yyyymmddMatch = dateString.match(yyyymmddRegex);
  if (yyyymmddMatch) {
    const [, year, month, day] = yyyymmddMatch;
    const date = new Date(year, month - 1, day, 23, 59, 59, 999);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  throw new Error('Invalid date format. Please use DD-MM-YYYY, YYYY-MM-DD, or ISO format');
};

// Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Helper places a bid on a task
const placeBid = async (req, res) => {
  try {
    const helperId = req.user.id;
    const { taskId } = req.params;
    const { bidAmount, estimatedDuration, proposedStartDate, message } = req.body;

    // Parse the proposed start date
    let parsedStartDate = null;
    if (proposedStartDate) {
      try {
        parsedStartDate = parseDate(proposedStartDate);
      } catch (dateError) {
        return res.status(400).json({
          success: false,
          message: dateError.message,
        });
      }
    }



    const task = await Task.findByPk(taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (task.status !== "in_queue") {
      return res.status(400).json({
        success: false,
        message: "Task is not available for bidding",
      });
    }

    // Check if helper already bid on this task
    const existingBid = await Bid.findOne({
      where: { taskId, helperId, status: "pending" },
    });

    if (existingBid) {
      return res.status(400).json({
        success: false,
        message: "You have already placed a bid on this task",
      });
    }

    const bid = await Bid.create({
      taskId,
      helperId,
      bidAmount,
      estimatedDuration,
      proposedStartDate: parsedStartDate,
      message,
      status: "pending",
    });

    // Notify task creator (helpseeker)
    await Notification.create({
      helpseekerId: task.helpseekerId,
      userType: 'helpseeker',
      taskId: task.id,
      title: "New Bid Received",
      message: `You received a bid of $${bidAmount} for your task "${task.title}"`,
      type: "bid_received",
      priority: "medium",
    });

    res.status(201).json({
      success: true,
      message: "Bid placed successfully",
      data: bid,
    });
  } catch (error) {
    console.error("Place bid error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to place bid",
      error: error.message,
    });
  }
};

// Get all bids for a task (Helpseeker)
const getTaskBids = async (req, res) => {
  try {
    const { taskId } = req.params;
    const helpseekerId = req.user.id;

    // Verify task ownership
    const task = await Task.findOne({ where: { id: taskId, helpseekerId } });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found or unauthorized",
      });
    }

    const bids = await Bid.findAll({
      where: { taskId },
      include: [
        {
          model: Helper,
          as: "helper",
          attributes: ["id", "fullName", "profilePhoto", "phone"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json({
      success: true,
      data: bids,
    });
  } catch (error) {
    console.error("Get task bids error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch bids",
      error: error.message,
    });
  }
};

// Get helper's own bids
const getMyBids = async (req, res) => {
  try {
    const helperId = req.user.id;
    const { status } = req.query;

    const whereClause = { helperId };
    if (status) {
      whereClause.status = status;
    }

    const bids = await Bid.findAll({
      where: whereClause,
      include: [
        {
          model: Task,
          as: "task",
          include: [
            {
              model: Helpseeker,
              as: "creator",
              attributes: ["id", "fullName", "profilePhoto"],
            },
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json({
      success: true,
      data: bids,
    });
  } catch (error) {
    console.error("Get my bids error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch bids",
      error: error.message,
    });
  }
};

// Accept a bid (Helpseeker) - Generates OTP for verification
const acceptBid = async (req, res) => {
  try {
    const { bidId } = req.params;
    const helpseekerId = req.user.id;

    const bid = await Bid.findByPk(bidId, {
      include: [
        {
          model: Task,
          as: "task",
          include: [
            {
              model: Helpseeker,
              as: "creator",
              attributes: ["id", "fullName"],
            },
          ],
        },
        {
          model: Helper,
          as: "helper",
          attributes: ["id", "fullName", "email", "phone", "profilePhoto"],
        },
      ],
    });

    if (!bid) {
      return res.status(404).json({
        success: false,
        message: "Bid not found",
      });
    }

    // Verify task ownership
    if (bid.task.helpseekerId !== helpseekerId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to accept this bid",
      });
    }

    if (bid.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "Bid is not in pending status",
      });
    }

    // Generate OTP for task verification
    const otp = generateOTP();

    // Update bid status
    bid.status = "accepted";
    await bid.save();

    // Update task with OTP fields
    bid.task.status = "assigned";
    bid.task.assignedHelperId = bid.helperId;
    bid.task.acceptedAt = new Date();
    bid.task.verificationOtp = otp;
    bid.task.otpGeneratedAt = new Date();
    bid.task.isOtpVerified = false;
    await bid.task.save();

    // Reject all other pending bids for this task
    await Bid.update(
      { status: "rejected" },
      {
        where: {
          taskId: bid.taskId,
          id: { [require("sequelize").Op.ne]: bidId },
          status: "pending",
        },
      }
    );

    // Remove task from queue
    await TaskQueue.destroy({ where: { taskId: bid.taskId } });

    // Notify helper (accepted + OTP instruction)
    await Notification.create({
      helperId: bid.helperId,
      userType: 'helper',
      taskId: bid.taskId,
      title: "Bid Accepted - Task Assigned! 🎉",
      message: `Great news! Your bid of ₹${bid.bidAmount} for "${bid.task.title}" has been accepted. Ask ${bid.task.creator.fullName} for the 6-digit OTP to start work.`,
      type: "bid_accepted",
      priority: "high",
    });

    // Notify helpseeker with OTP
    await Notification.create({
      helpseekerId: helpseekerId,
      userType: 'helpseeker',
      taskId: bid.taskId,
      title: "Bid Accepted",
      message: `You accepted ${bid.helper.fullName}'s bid of ₹${bid.bidAmount} for "${bid.task.title}". Your verification OTP is: ${otp}. Share this OTP with the helper when work begins.`,
      type: "bid_accepted",
      priority: "high",
    });

    // Send push notifications to both helper and helpseeker
    Promise.all([
      sendToUser(
        bid.helperId,
        'helper',
        {
          title: "Task Assigned - Bid Accepted! 🎉",
          body: `Your bid of ₹${bid.bidAmount} for "${bid.task.title}" has been accepted. Ask for the OTP to start.`,
        },
        {
          type: "bid_accepted",
          taskId: bid.taskId.toString(),
        }
      ).catch(err => console.error('⚠️ Failed to send push notification to helper:', err)),
      sendToUser(
        helpseekerId,
        'helpseeker',
        {
          title: "Bid Accepted",
          body: `You accepted ${bid.helper.fullName}'s bid. OTP: ${otp}`,
        },
        {
          type: "bid_accepted",
          taskId: bid.taskId.toString(),
          otp: otp,
        }
      ).catch(err => console.error('⚠️ Failed to send push notification to helpseeker:', err))
    ]);

    // Notify rejected bidders
    const rejectedBids = await Bid.findAll({
      where: {
        taskId: bid.taskId,
        status: "rejected",
      },
    });

    const rejectedNotifications = rejectedBids.map((rejectedBid) => ({
      helperId: rejectedBid.helperId,
      userType: 'helper',
      taskId: bid.taskId,
      title: "Bid Not Selected",
      message: `The task "${bid.task.title}" was assigned to another helper`,
      type: "bid_rejected",
      priority: "low",
    }));

    await Notification.bulkCreate(rejectedNotifications);

    res.status(200).json({
      success: true,
      message: "Bid accepted successfully. OTP generated for task verification.",
      data: { 
        bid, 
        task: {
          id: bid.task.id,
          title: bid.task.title,
          status: bid.task.status,
          assignedHelperId: bid.task.assignedHelperId,
          acceptedAt: bid.task.acceptedAt,
        },
        otp: otp,
        helper: {
          id: bid.helper.id,
          fullName: bid.helper.fullName,
          email: bid.helper.email,
          phone: bid.helper.phone,
          profilePhoto: bid.helper.profilePhoto,
        },
        instructions: `Share the OTP (${otp}) with ${bid.helper.fullName} to start the task.`,
      },
    });
  } catch (error) {
    console.error("Accept bid error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to accept bid",
      error: error.message,
    });
  }
};;

// Reject a bid (Helpseeker)
const rejectBid = async (req, res) => {
  try {
    const { bidId } = req.params;
    const helpseekerId = req.user.id;

    const bid = await Bid.findByPk(bidId, {
      include: [
        {
          model: Task,
          as: "task",
        },
      ],
    });

    if (!bid) {
      return res.status(404).json({
        success: false,
        message: "Bid not found",
      });
    }

    // Verify task ownership
    if (bid.task.helpseekerId !== helpseekerId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to reject this bid",
      });
    }

    if (bid.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "Bid is not in pending status",
      });
    }

    bid.status = "rejected";
    await bid.save();

    // Notify helper
    await Notification.create({
      helperId: bid.helperId,
      userType: 'helper',
      taskId: bid.taskId,
      title: "Bid Rejected",
      message: `Your bid for "${bid.task.title}" was not selected`,
      type: "bid_rejected",
      priority: "low",
    });

    res.status(200).json({
      success: true,
      message: "Bid rejected successfully",
      data: bid,
    });
  } catch (error) {
    console.error("Reject bid error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reject bid",
      error: error.message,
    });
  }
};

// Withdraw bid (Helper)
const withdrawBid = async (req, res) => {
  try {
    const { bidId } = req.params;
    const helperId = req.user.id;

    const bid = await Bid.findOne({
      where: { id: bidId, helperId },
      include: [{ model: Task, as: "task" }],
    });

    if (!bid) {
      return res.status(404).json({
        success: false,
        message: "Bid not found",
      });
    }

    if (bid.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "Can only withdraw pending bids",
      });
    }

    bid.status = "withdrawn";
    await bid.save();

    // Notify task creator
    await Notification.create({
      helpseekerId: bid.task.helpseekerId,
      userType: 'helpseeker',
      taskId: bid.taskId,
      title: "Bid Withdrawn",
      message: `A helper withdrew their bid for "${bid.task.title}"`,
      type: "general",
      priority: "low",
    });

    res.status(200).json({
      success: true,
      message: "Bid withdrawn successfully",
      data: bid,
    });
  } catch (error) {
    console.error("Withdraw bid error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to withdraw bid",
      error: error.message,
    });
  }
};

module.exports = {
  placeBid,
  getTaskBids,
  getMyBids,
  acceptBid,
  rejectBid,
  withdrawBid,
};
