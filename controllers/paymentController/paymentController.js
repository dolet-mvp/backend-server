const Payment = require("../../models/paymentModel/paymentModel");
const Task = require("../../models/taskModel/taskModel");
const Notification = require("../../models/notificationModel/notificationModel");
const Helper = require("../../models/authModel/helperModel");
const Helpseeker = require("../../models/authModel/helpseekerModel");
const Razorpay = require("razorpay");
const crypto = require("crypto");

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Helper requests payment (creates Razorpay order)
const requestPayment = async (req, res) => {
  try {
    const helperId = req.user.id;
    const { taskId } = req.params;

    if (req.user.userType !== "helper") {
      return res.status(403).json({
        success: false,
        message: "Only helpers can request payment",
      });
    }

    const task = await Task.findOne({
      where: { id: taskId, assignedHelperId: helperId },
      include: [
        {
          model: Helpseeker,
          as: "creator",
          attributes: ["id", "fullName", "email", "phone"],
        },
      ],
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found or not assigned to you",
      });
    }

    if (task.status !== "completed") {
      return res.status(400).json({
        success: false,
        message: "Task must be completed before requesting payment",
      });
    }

    // Check if payment already exists
    const existingPayment = await Payment.findOne({
      where: { taskId, status: ["completed", "processing"] },
    });

    if (existingPayment) {
      return res.status(400).json({
        success: false,
        message: "Payment already processed or in progress for this task",
      });
    }

    // Calculate amounts (in paise for Razorpay - multiply by 100)
    const amount = parseFloat(task.budget);
    const platformFee = amount * 0.1; // 10% platform fee
    const netAmount = amount - platformFee;
    const amountInPaise = Math.round(amount * 100);

    // Create Razorpay Order
    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: `task_${taskId}`,
      notes: {
        taskId: taskId,
        taskTitle: task.title,
        helperId: helperId,
        helpseekerId: task.helpseekerId,
      },
    });

    // Create payment record in database
    const payment = await Payment.create({
      taskId,
      payerId: task.helpseekerId,
      receiverId: helperId,
      amount,
      platformFee,
      netAmount,
      paymentMethod: "digital_wallet",
      paymentGateway: "razorpay",
      transactionId: razorpayOrder.id,
      status: "pending",
      type: "task_payment",
      description: `Payment for task: ${task.title}`,
    });

    // Notify helpseeker about payment request
    await Notification.create({
      helpseekerId: task.helpseekerId,
      userType: 'helpseeker',
      taskId: task.id,
      title: "Payment Request",
      message: `Helper has requested payment of ₹${amount.toFixed(2)} for "${task.title}"`,
      type: "payment_requested",
      priority: "high",
    });

    // Notify helper that request was sent
    await Notification.create({
      helperId: helperId,
      userType: 'helper',
      taskId: task.id,
      title: "Payment Request Sent",
      message: `Your payment request for ₹${amount.toFixed(2)} has been sent to the helpseeker`,
      type: "payment_request_sent",
      priority: "medium",
    });

    res.status(201).json({
      success: true,
      message: "Payment request created successfully",
      data: {
        payment,
        razorpayOrder: {
          orderId: razorpayOrder.id,
          amount: razorpayOrder.amount,
          currency: razorpayOrder.currency,
          keyId: process.env.RAZORPAY_KEY_ID,
        },
        helpseeker: {
          name: task.creator.fullName,
          email: task.creator.email,
          phone: task.creator.phone,
        },
      },
    });
  } catch (error) {
    console.error("Request payment error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create payment request",
      error: error.message,
    });
  }
};

// Verify Razorpay payment signature (webhook or manual verification)
const verifyPayment = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      taskId,
    } = req.body;

    // Verify signature
    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest("hex");

    if (razorpay_signature !== expectedSign) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment signature",
      });
    }

    // Find payment by Razorpay order ID
    const payment = await Payment.findOne({
      where: { transactionId: razorpay_order_id },
      include: [
        {
          model: Task,
          as: "task",
        },
      ],
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    if (payment.status === "completed") {
      return res.status(400).json({
        success: false,
        message: "Payment already completed",
      });
    }

    // Update payment status
    payment.status = "completed";
    payment.processedAt = new Date();
    payment.transactionId = razorpay_payment_id; // Update with actual payment ID
    await payment.save();

    // Update helper earnings
    const helper = await Helper.findByPk(payment.receiverId);

    if (helper) {
      helper.totalEarnings =
        parseFloat(helper.totalEarnings || 0) + parseFloat(payment.netAmount);
      helper.completedTasks = (helper.completedTasks || 0) + 1;
      await helper.save();
    }

    // Notify helper about received payment
    await Notification.create({
      helperId: payment.receiverId,
      userType: 'helper',
      taskId: payment.taskId,
      title: "Payment Received! 💰",
      message: `You received ₹${parseFloat(payment.netAmount).toFixed(2)} for "${payment.task.title}"`,
      type: "payment_received",
      priority: "high",
    });

    // Notify helpseeker about successful payment
    await Notification.create({
      helpseekerId: payment.payerId,
      userType: 'helpseeker',
      taskId: payment.taskId,
      title: "Payment Successful ✅",
      message: `Payment of ₹${parseFloat(payment.amount).toFixed(2)} sent successfully for "${payment.task.title}"`,
      type: "payment_sent",
      priority: "high",
    });

    res.status(200).json({
      success: true,
      message: "Payment verified and completed successfully",
      data: payment,
    });
  } catch (error) {
    console.error("Verify payment error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify payment",
      error: error.message,
    });
  }
};

// Get payment request for a task (Helpseeker checks if helper requested payment)
const getPaymentRequest = async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.user.id;

    const task = await Task.findByPk(taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    // Verify user is task creator (helpseeker)
    if (task.helpseekerId !== userId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to view payment request",
      });
    }

    const payment = await Payment.findOne({
      where: { taskId },
      include: [
        {
          model: Helper,
          as: "receiver",
          attributes: ["id", "fullName", "email", "phone", "profilePhoto"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "No payment request found for this task",
        data: {
          hasPaymentRequest: false,
        },
      });
    }

    res.status(200).json({
      success: true,
      message: "Payment request found",
      data: {
        hasPaymentRequest: true,
        payment,
        razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      },
    });
  } catch (error) {
    console.error("Get payment request error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payment request",
      error: error.message,
    });
  }
};


// Get payment history for user
const getPaymentHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { type, status } = req.query;

    let whereClause = {};

    if (req.user.userType === "helper") {
      whereClause.receiverId = userId;
    } else if (req.user.userType === "helpseeker") {
      whereClause.payerId = userId;
    }

    if (type) {
      whereClause.type = type;
    }

    if (status) {
      whereClause.status = status;
    }

    const payments = await Payment.findAll({
      where: whereClause,
      include: [
        {
          model: Task,
          as: "task",
          attributes: ["id", "title", "category"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    // Calculate totals
    const totalEarned = payments
      .filter((p) => p.receiverId === userId && p.status === "completed")
      .reduce((sum, p) => sum + parseFloat(p.netAmount), 0);

    const totalSpent = payments
      .filter((p) => p.payerId === userId && p.status === "completed")
      .reduce((sum, p) => sum + parseFloat(p.amount), 0);

    res.status(200).json({
      success: true,
      data: {
        payments,
        summary: {
          totalEarned: totalEarned.toFixed(2),
          totalSpent: totalSpent.toFixed(2),
          totalTransactions: payments.length,
        },
      },
    });
  } catch (error) {
    console.error("Get payment history error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payment history",
      error: error.message,
    });
  }
};

// Request refund (Helpseeker)
const requestRefund = async (req, res) => {
  try {
    const userId = req.user.id;
    const { paymentId } = req.params;
    const { reason } = req.body;

    const payment = await Payment.findByPk(paymentId, {
      include: [{ model: Task, as: "task" }],
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    if (payment.payerId !== userId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to request refund",
      });
    }

    if (payment.status !== "completed") {
      return res.status(400).json({
        success: false,
        message: "Can only refund completed payments",
      });
    }

    // Update task status to disputed
    const task = await Task.findByPk(payment.taskId);
    if (task) {
      task.status = "disputed";
      await task.save();
    }

    payment.status = "disputed";
    payment.failureReason = reason;
    await payment.save();

    // Notify admin and helper
    await Notification.create({
      userId: payment.receiverId,
      taskId: payment.taskId,
      title: "Refund Requested",
      message: `A refund has been requested for "${payment.task.title}"`,
      type: "general",
      priority: "high",
    });

    res.status(200).json({
      success: true,
      message: "Refund request submitted",
      data: payment,
    });
  } catch (error) {
    console.error("Request refund error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to request refund",
      error: error.message,
    });
  }
};

module.exports = {
  requestPayment,
  verifyPayment,
  getPaymentRequest,
  getPaymentHistory,
  requestRefund,
};
