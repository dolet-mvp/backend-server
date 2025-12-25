const Report = require("../../models/reportModel/reportModel");
const Helper = require("../../models/authModel/helperModel");
const Helpseeker = require("../../models/authModel/helpseekerModel");
const Admin = require("../../models/authModel/adminModel");
const Notification = require("../../models/notificationModel/notificationModel");
const Task = require("../../models/taskModel/taskModel");

// Create a new report
const createReport = async (req, res) => {
  try {
    const reporterId = req.user.id;
    const reporterType = req.user.userType; // 'helper' or 'helpseeker'
    
    const {
      description,
      category,
      taskId,
    } = req.body;

    // Validation
    if (!taskId || !description) {
      return res.status(400).json({
        success: false,
        message: "Task ID and description are required",
      });
    }

    // Fetch task to determine who to report
    const task = await Task.findByPk(taskId);
    
    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    let reportedUserId;
    let reportedUserType;

    // If helper is reporting, report the helpseeker (task creator)
    if (reporterType === "helper") {
      reportedUserId = task.helpseekerId;
      reportedUserType = "helpseeker";
      
      // Verify this helper is assigned to the task
      if (task.assignedHelperId !== reporterId) {
        return res.status(403).json({
          success: false,
          message: "You can only report the helpseeker of tasks assigned to you",
        });
      }
    }
    // If helpseeker is reporting, report the assigned helper
    else if (reporterType === "helpseeker") {
      // Verify this helpseeker owns the task
      if (task.helpseekerId !== reporterId) {
        return res.status(403).json({
          success: false,
          message: "You can only report helpers on your own tasks",
        });
      }
      
      if (!task.assignedHelperId) {
        return res.status(400).json({
          success: false,
          message: "No helper is assigned to this task yet",
        });
      }
      
      reportedUserId = task.assignedHelperId;
      reportedUserType = "helper";
    }

    // Prevent self-reporting (shouldn't happen but double check)
    if (reporterId === reportedUserId) {
      return res.status(400).json({
        success: false,
        message: "You cannot report yourself",
      });
    }

    // Verify reported user exists
    let reportedUser;
    if (reportedUserType === "helper") {
      reportedUser = await Helper.findByPk(reportedUserId);
    } else if (reportedUserType === "helpseeker") {
      reportedUser = await Helpseeker.findByPk(reportedUserId);
    }

    if (!reportedUser) {
      return res.status(404).json({
        success: false,
        message: "Reported user not found",
      });
    }

    // Create report
    const report = await Report.create({
      reporterId,
      reporterType,
      reportedUserId,
      reportedUserType,
      description,
      category: category || "other",
      taskId: taskId || null,
      status: "pending",
    });

    // Notify admins (you can fetch all admins and send notifications)
    console.log(`📋 New report created: ${report.id}`);
    console.log(`   Reporter: ${reporterType} (${reporterId})`);
    console.log(`   Reported: ${reportedUserType} (${reportedUserId})`);
    console.log(`   Category: ${category}`);

    res.status(201).json({
      success: true,
      message: "Report submitted successfully. Our team will review it shortly.",
      data: {
        reportId: report.id,
        status: report.status,
        createdAt: report.createdAt,
      },
    });
  } catch (error) {
    console.error("Create report error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to submit report",
      error: error.message,
    });
  }
};

// Get reports made by current user
const getMyReports = async (req, res) => {
  try {
    const userId = req.user.id;
    const userType = req.user.userType;

    const reports = await Report.findAll({
      where: {
        reporterId: userId,
        reporterType: userType,
      },
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json({
      success: true,
      message: "Reports retrieved successfully",
      data: {
        count: reports.length,
        reports,
      },
    });
  } catch (error) {
    console.error("Get my reports error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch reports",
      error: error.message,
    });
  }
};

// Get all reports (Admin only)
const getAllReports = async (req, res) => {
  try {
    const { status, reporterType, reportedUserType, category } = req.query;

    const whereClause = {};
    if (status) whereClause.status = status;
    if (reporterType) whereClause.reporterType = reporterType;
    if (reportedUserType) whereClause.reportedUserType = reportedUserType;
    if (category) whereClause.category = category;

    const reports = await Report.findAll({
      where: whereClause,
      include: [
        {
          model: Helper,
          as: "reporterHelper",
          attributes: ["id", "fullName", "email", "profilePhoto"],
          required: false,
        },
        {
          model: Helpseeker,
          as: "reporterHelpseeker",
          attributes: ["id", "fullName", "email", "profilePhoto"],
          required: false,
        },
        {
          model: Helper,
          as: "reportedHelper",
          attributes: ["id", "fullName", "email", "profilePhoto", "verificationStatus"],
          required: false,
        },
        {
          model: Helpseeker,
          as: "reportedHelpseeker",
          attributes: ["id", "fullName", "email", "profilePhoto"],
          required: false,
        },
        {
          model: Task,
          as: "task",
          attributes: ["id", "title", "status"],
          required: false,
        },
        {
          model: Admin,
          as: "reviewer",
          attributes: ["id", "fullName", "email"],
          required: false,
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json({
      success: true,
      message: "All reports retrieved successfully",
      data: {
        count: reports.length,
        reports,
      },
    });
  } catch (error) {
    console.error("Get all reports error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch reports",
      error: error.message,
    });
  }
};

// Get report by ID (Admin only)
const getReportById = async (req, res) => {
  try {
    const { reportId } = req.params;

    const report = await Report.findByPk(reportId, {
      include: [
        {
          model: Helper,
          as: "reporterHelper",
          attributes: ["id", "fullName", "email", "phone", "profilePhoto"],
          required: false,
        },
        {
          model: Helpseeker,
          as: "reporterHelpseeker",
          attributes: ["id", "fullName", "email", "phone", "profilePhoto"],
          required: false,
        },
        {
          model: Helper,
          as: "reportedHelper",
          attributes: ["id", "fullName", "email", "phone", "profilePhoto", "verificationStatus"],
          required: false,
        },
        {
          model: Helpseeker,
          as: "reportedHelpseeker",
          attributes: ["id", "fullName", "email", "phone", "profilePhoto"],
          required: false,
        },
        {
          model: Task,
          as: "task",
          attributes: ["id", "title", "status", "description"],
          required: false,
        },
        {
          model: Admin,
          as: "reviewer",
          attributes: ["id", "fullName", "email"],
          required: false,
        },
      ],
    });

    if (!report) {
      return res.status(404).json({
        success: false,
        message: "Report not found",
      });
    }

    res.status(200).json({
      success: true,
      data: report,
    });
  } catch (error) {
    console.error("Get report by ID error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch report",
      error: error.message,
    });
  }
};

// Update report status and take action (Admin only)
const updateReport = async (req, res) => {
  try {
    const { reportId } = req.params;
    const adminId = req.user.id;
    const { status, adminNotes, actionTaken } = req.body;

    const report = await Report.findByPk(reportId);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: "Report not found",
      });
    }

    // Update report
    if (status) report.status = status;
    if (adminNotes) report.adminNotes = adminNotes;
    if (actionTaken) report.actionTaken = actionTaken;
    
    report.reviewedBy = adminId;
    report.reviewedAt = new Date();

    await report.save();

    // If action is taken, update the reported user's status
    if (actionTaken && actionTaken !== "none" && actionTaken !== "no_action_needed") {
      if (report.reportedUserType === "helper") {
        const helper = await Helper.findByPk(report.reportedUserId);
        if (helper) {
          if (actionTaken === "account_suspended") {
            helper.isApproved = false;
            helper.verificationStatus = "suspended";
            await helper.save();
          } else if (actionTaken === "account_banned") {
            helper.isApproved = false;
            helper.verificationStatus = "banned";
            await helper.save();
          }
        }
      } else if (report.reportedUserType === "helpseeker") {
        const helpseeker = await Helpseeker.findByPk(report.reportedUserId);
        if (helpseeker) {
          if (actionTaken === "account_suspended" || actionTaken === "account_banned") {
            // Add your helpseeker suspension/ban logic here
            helpseeker.isActive = false;
            await helpseeker.save();
          }
        }
      }

      // Notify the reported user
      await Notification.create({
        userId: report.reportedUserId,
        userType: report.reportedUserType,
        title: "Account Action Taken",
        message: `Action has been taken on your account: ${actionTaken.replace(/_/g, " ")}`,
        type: "general",
        priority: "high",
      });
    }

    // Notify the reporter
    await Notification.create({
      userId: report.reporterId,
      userType: report.reporterType,
      title: "Report Update",
      message: `Your report has been reviewed and is now ${status}`,
      type: "general",
      priority: "medium",
    });

    console.log(`✅ Report ${reportId} updated by admin ${adminId}`);
    console.log(`   Status: ${status}`);
    console.log(`   Action: ${actionTaken}`);

    res.status(200).json({
      success: true,
      message: "Report updated successfully",
      data: report,
    });
  } catch (error) {
    console.error("Update report error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update report",
      error: error.message,
    });
  }
};

// Get report statistics (Admin only)
const getReportStats = async (req, res) => {
  try {
    const { Op } = require("sequelize");

    const totalReports = await Report.count();
    const pendingReports = await Report.count({ where: { status: "pending" } });
    const underReviewReports = await Report.count({ where: { status: "under_review" } });
    const resolvedReports = await Report.count({ where: { status: "resolved" } });
    const dismissedReports = await Report.count({ where: { status: "dismissed" } });

    const reportsByCategory = await Report.findAll({
      attributes: [
        "category",
        [require("sequelize").fn("COUNT", require("sequelize").col("id")), "count"],
      ],
      group: ["category"],
    });

    const reportsByUserType = await Report.findAll({
      attributes: [
        "reportedUserType",
        [require("sequelize").fn("COUNT", require("sequelize").col("id")), "count"],
      ],
      group: ["reportedUserType"],
    });

    res.status(200).json({
      success: true,
      data: {
        totalReports,
        statusBreakdown: {
          pending: pendingReports,
          underReview: underReviewReports,
          resolved: resolvedReports,
          dismissed: dismissedReports,
        },
        categoryBreakdown: reportsByCategory,
        userTypeBreakdown: reportsByUserType,
      },
    });
  } catch (error) {
    console.error("Get report stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch report statistics",
      error: error.message,
    });
  }
};

module.exports = {
  createReport,
  getMyReports,
  getAllReports,
  getReportById,
  updateReport,
  getReportStats,
};
