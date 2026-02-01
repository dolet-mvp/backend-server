const Admin = require("../../models/authModel/adminModel");
const Helper = require("../../models/authModel/helperModel");
const Task = require("../../models/taskModel/taskModel");
const Helpseeker = require("../../models/authModel/helpseekerModel");
const { createToken } = require("../../services/authServices");
const { decryptHelperData } = require("../../services/encryptionService");
const bcrypt = require("bcryptjs");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");


const handleAdminLogin = async (req, res) => {
  try {
    const { email, password, twoFactorCode } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // Find admin
    const admin = await Admin.findOne({ where: { email } });
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    // Check if admin is active
    if (!admin.isActive) {
      return res.status(403).json({
        success: false,
        message: "Your admin account is inactive. Contact super admin.",
      });
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Check if 2FA is enabled
    if (admin.twoFactorEnabled) {
      if (!twoFactorCode) {
        return res.status(200).json({
          success: true,
          requires2FA: true,
          message: "Please provide 2FA code",
        });
      }

      // Verify 2FA code
      const verified = speakeasy.totp.verify({
        secret: admin.twoFactorSecret,
        encoding: "base32",
        token: twoFactorCode,
        window: 2, // Allow 2 time steps before/after for clock drift
      });

      if (!verified) {
        return res.status(401).json({
          success: false,
          message: "Invalid 2FA code",
        });
      }
    }

    // Update last login
    await admin.update({ lastLogin: new Date() });

    // Generate token
    const token = createToken(admin, "admin");

    const { password: _, twoFactorSecret: __, ...adminData } = admin.toJSON();

    res.json({
      success: true,
      message: "Login successful",
      token,
      admin: adminData,
      userType: "admin",
    });
  } catch (error) {
    console.error("Admin login error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during login",
      error: error.message,
    });
  }
};


const getPendingHelpers = async (req, res) => {
  try {
    const helpers = await Helper.findAll({
      where: { verificationStatus: "submitted" },
      order: [["createdAt", "ASC"]],
    });

    // Decrypt documents for each helper
    const decryptedHelpers = helpers.map(helper => decryptHelperData(helper));

    res.json({
      success: true,
      count: decryptedHelpers.length,
      helpers: decryptedHelpers,
    });
  } catch (error) {
    console.error("Get pending helpers error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const approveHelper = async (req, res) => {
  try {
    const { helperId } = req.params;
    const adminId = req.user.id;

    const helper = await Helper.findByPk(helperId);
    if (!helper) {
      return res.status(404).json({
        success: false,
        message: "Helper not found",
      });
    }

    if (helper.verificationStatus !== "submitted") {
      return res.status(400).json({
        success: false,
        message: `Helper is already ${helper.verificationStatus}`,
      });
    }

    // Approve helper
    helper.verificationStatus = "approved";
    helper.approvedBy = adminId;
    helper.isApproved = true; // Can now start taking tasks
    await helper.save();

    
    const { password: _, ...helperData } = helper.toJSON();

    res.json({
      success: true,
      message: "Helper approved successfully",
      helper: helperData,
    });
  } catch (error) {
    console.error("Approve helper error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};


const rejectHelper = async (req, res) => {
  try {
    const { helperId } = req.params;
    const { reason } = req.body;
    const adminId = req.user.id;

    const helper = await Helper.findByPk(helperId);
    if (!helper) {
      return res.status(404).json({
        success: false,
        message: "Helper not found",
      });
    }

    if (helper.verificationStatus !== "submitted") {
      return res.status(400).json({
        success: false,
        message: `Helper is already ${helper.verificationStatus}`,
      });
    }

    // Reject helper
    helper.verificationStatus = "rejected";
    helper.approvedBy = adminId;
    helper.rejectionReason = reason || "Does not meet requirements";
    await helper.save();

    // TODO: Send notification to helper with reason

    const { password: _, ...helperData } = helper.toJSON();

    res.json({
      success: true,
      message: "Helper rejected",
      helper: helperData,
    });
  } catch (error) {
    console.error("Reject helper error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};


const getAllHelpers = async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;

    const where = {};
    if (status) {
      where.verificationStatus = status;
    }

    const { count, rows: helpers } = await Helper.findAndCountAll({
      where,
      attributes: { exclude: ["password"] },
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["createdAt", "DESC"]],
    });

    // Decrypt documents for each helper
    const decryptedHelpers = helpers.map(helper => decryptHelperData(helper));

    res.json({
      success: true,
      total: count,
      helpers: decryptedHelpers,
    });
  } catch (error) {
    console.error("Get all helpers error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};





const handleAdminSignup = async (req, res) => {
  try {
    const { fullName, email, password } = req.body;

    // 🔹 Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // 🔹 Check if admin already exists
    const existingAdmin = await Admin.findOne({ where: { email } });
    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        message: "Admin with this email already exists. Please login instead.",
      });
    }


    const hashedPassword = await bcrypt.hash(password, 10);


    const admin = await Admin.create({
      fullName: fullName || null,
      email,
      password: hashedPassword,
      role:  "admin", // default role
      isActive: true,
    });


    const { password: _, ...adminData } = admin.toJSON();

    res.status(201).json({
      success: true,
      message: "Admin registered successfully",
      admin: adminData,
      userType: "admin",
    });
  } catch (error) {
    console.error("Admin signup error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during admin registration",
      error: error.message,
    });
  }
};


const getHelperDetails = async (req, res) => {
  try {
    const { helperId } = req.params;

    const helper = await Helper.findByPk(helperId, {
      attributes: { exclude: ["password"] },
    });

    if (!helper) {
      return res.status(404).json({
        success: false,
        message: "Helper not found",
      });
    }

    // Decrypt documents
    const decryptedHelper = decryptHelperData(helper);

    res.json({
      success: true,
      helper: decryptedHelper,
    });
  } catch (error) {
    console.error("Get helper details error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};


const getHelperTasks = async (req, res) => {
  try {
    const { helperId } = req.params;
    const { status, limit = 50, offset = 0 } = req.query;

    // Verify helper exists
    const helper = await Helper.findByPk(helperId);
    if (!helper) {
      return res.status(404).json({
        success: false,
        message: "Helper not found",
      });
    }

    const where = { assignedHelperId: helperId };
    if (status) {
      where.status = status;
    }

    const { count, rows: tasks } = await Task.findAndCountAll({
      where,
      include: [
        {
          model: Helpseeker,
          as: "creator",
          attributes: ["id", "fullName", "phone", "email", "profilePhoto"],
        },
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["createdAt", "DESC"]],
    });

    // Format tasks for response
    const formattedTasks = tasks.map(task => ({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      price: task.budget,
      createdAt: task.createdAt,
      completedAt: task.completedAt,
      rating: task.rating,
      helpseekerName: task.creator?.fullName || "Unknown",
      helpseekerPhone: task.creator?.phone,
      helpseekerEmail: task.creator?.email,
    }));

    res.json({
      success: true,
      total: count,
      tasks: formattedTasks,
    });
  } catch (error) {
    console.error("Get helper tasks error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};


const getAllHelpseekers = async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const { count, rows: helpseekers } = await Helpseeker.findAndCountAll({
      attributes: { exclude: ["password"] },
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["createdAt", "DESC"]],
    });

    res.json({
      success: true,
      total: count,
      helpseekers,
    });
  } catch (error) {
    console.error("Get all helpseekers error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};


const getHelpseekerDetails = async (req, res) => {
  try {
    const { helpseekerId } = req.params;

    const helpseeker = await Helpseeker.findByPk(helpseekerId, {
      attributes: { exclude: ["password"] },
    });

    if (!helpseeker) {
      return res.status(404).json({
        success: false,
        message: "Helpseeker not found",
      });
    }

    res.json({
      success: true,
      helpseeker,
    });
  } catch (error) {
    console.error("Get helpseeker details error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};


const getHelpseekerTasks = async (req, res) => {
  try {
    const { helpseekerId } = req.params;
    const { status, limit = 50, offset = 0 } = req.query;

    // Verify helpseeker exists
    const helpseeker = await Helpseeker.findByPk(helpseekerId);
    if (!helpseeker) {
      return res.status(404).json({
        success: false,
        message: "Helpseeker not found",
      });
    }

    const where = { helpseekerId };
    if (status) {
      where.status = status;
    }

    const { count, rows: tasks } = await Task.findAndCountAll({
      where,
      include: [
        {
          model: Helper,
          as: "assignedHelper",
          attributes: ["id", "fullName", "phone", "email", "profilePhoto"],
        },
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["createdAt", "DESC"]],
    });

    // Format tasks for response
    const formattedTasks = tasks.map(task => ({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      price: task.budget,
      createdAt: task.createdAt,
      completedAt: task.completedAt,
      rating: task.rating,
      helperName: task.assignedHelper?.fullName || "Not Assigned",
      helperPhone: task.assignedHelper?.phone,
      helperEmail: task.assignedHelper?.email,
    }));

    res.json({
      success: true,
      total: count,
      tasks: formattedTasks,
    });
  } catch (error) {
    console.error("Get helpseeker tasks error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// Update admin profile
const updateAdminProfile = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { fullName, email, phone } = req.body;

    // Find admin
    const admin = await Admin.findByPk(adminId);
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    // Check if email is being changed and if it's already taken
    if (email && email !== admin.email) {
      const emailExists = await Admin.findOne({ where: { email } });
      if (emailExists) {
        return res.status(400).json({
          success: false,
          message: "Email already in use",
        });
      }
    }

    // Check if phone is being changed and if it's already taken
    if (phone && phone !== admin.phone) {
      const phoneExists = await Admin.findOne({ where: { phone } });
      if (phoneExists) {
        return res.status(400).json({
          success: false,
          message: "Phone number already in use",
        });
      }
    }

    // Update admin
    await admin.update({
      fullName: fullName || admin.fullName,
      email: email || admin.email,
      phone: phone || admin.phone,
    });

    const { password: _, ...updatedAdminData } = admin.toJSON();

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      admin: updatedAdminData,
    });
  } catch (error) {
    console.error("Update admin profile error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// Change admin password
const changeAdminPassword = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters",
      });
    }

    // Find admin
    const admin = await Admin.findByPk(adminId);
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, admin.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await admin.update({
      password: hashedPassword,
    });

    return res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Change admin password error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// Generate 2FA secret and QR code
const generateTwoFactorSecret = async (req, res) => {
  try {
    const adminId = req.user.id;

    // Find admin
    const admin = await Admin.findByPk(adminId);
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    // Generate secret
    const secret = speakeasy.generateSecret({
      name: `Dolet Admin (${admin.email})`,
      issuer: "Dolet",
    });

    // Generate QR code
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    // Store temporary secret (not enabled yet)
    await admin.update({
      twoFactorSecret: secret.base32,
      twoFactorEnabled: false,
    });

    return res.status(200).json({
      success: true,
      message: "2FA secret generated",
      secret: secret.base32,
      qrCode: qrCodeUrl,
    });
  } catch (error) {
    console.error("Generate 2FA secret error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// Enable 2FA after verifying the code
const enableTwoFactor = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Verification code is required",
      });
    }

    // Find admin
    const admin = await Admin.findByPk(adminId);
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    if (!admin.twoFactorSecret) {
      return res.status(400).json({
        success: false,
        message: "Please generate 2FA secret first",
      });
    }

    // Verify the code
    const verified = speakeasy.totp.verify({
      secret: admin.twoFactorSecret,
      encoding: "base32",
      token: code,
      window: 2,
    });

    if (!verified) {
      return res.status(401).json({
        success: false,
        message: "Invalid verification code",
      });
    }

    // Enable 2FA
    await admin.update({
      twoFactorEnabled: true,
    });

    return res.status(200).json({
      success: true,
      message: "Two-factor authentication enabled successfully",
    });
  } catch (error) {
    console.error("Enable 2FA error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// Disable 2FA
const disableTwoFactor = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        message: "Password is required to disable 2FA",
      });
    }

    // Find admin
    const admin = await Admin.findByPk(adminId);
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid password",
      });
    }

    // Disable 2FA
    await admin.update({
      twoFactorEnabled: false,
      twoFactorSecret: null,
    });

    return res.status(200).json({
      success: true,
      message: "Two-factor authentication disabled successfully",
    });
  } catch (error) {
    console.error("Disable 2FA error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// Get helper analytics
const getHelperAnalytics = async (req, res) => {
  try {
    const totalHelpers = await Helper.count();
    const approvedHelpers = await Helper.count({ where: { verificationStatus: 'approved' } });
    const pendingHelpers = await Helper.count({ where: { verificationStatus: 'submitted' } });
    const rejectedHelpers = await Helper.count({ where: { verificationStatus: 'rejected' } });

    res.status(200).json({
      success: true,
      analytics: {
        total: totalHelpers,
        approved: approvedHelpers,
        pending: pendingHelpers,
        rejected: rejectedHelpers,
      },
    });
  } catch (error) {
    console.error('Get helper analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch helper analytics',
      error: error.message,
    });
  }
};

// Get helpseeker analytics
const getHelpseekerAnalytics = async (req, res) => {
  try {
    const totalHelpseekers = await Helpseeker.count();

    res.status(200).json({
      success: true,
      analytics: {
        total: totalHelpseekers,
      },
    });
  } catch (error) {
    console.error('Get helpseeker analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch helpseeker analytics',
      error: error.message,
    });
  }
};

// Get all tasks for admin panel (Jobs Posted)
const getAllTasksForAdmin = async (req, res) => {
  try {
    const { status, priority, category, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    // Build where clause for filters
    const whereClause = {};
    if (status && status !== 'all') {
      whereClause.status = status;
    }
    if (priority && priority !== 'all') {
      whereClause.priority = priority;
    }
    if (category && category !== 'all') {
      whereClause.category = category;
    }

    // Fetch tasks with related data
    const { count, rows: tasks } = await Task.findAndCountAll({
      where: whereClause,
      attributes: [
        'id',
        'title',
        'description',
        'steps',
        'budget',
        'estimatedDuration',
        'dueDate',
        'status',
        'priority',
        'category',
        'location',
        'assignedHelperId',
        'helpseekerId',
        'createdAt',
        'updatedAt'
      ],
      include: [
        {
          model: Helper,
          as: 'assignedHelper',
          attributes: ['id', 'fullName', 'phone'],
          required: false
        },
        {
          model: Helpseeker,
          as: 'creator',
          attributes: ['id', 'fullName', 'phone'],
          required: false
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    // Calculate stats
    const allTasks = await Task.findAll({ attributes: ['status'] });
    const stats = {
      total: allTasks.length,
      published: allTasks.filter(t => t.status === 'published').length,
      inProgress: allTasks.filter(t => ['assigned', 'in_progress', 'on_the_way', 'arrived'].includes(t.status)).length,
      completed: allTasks.filter(t => t.status === 'completed').length,
      cancelled: allTasks.filter(t => t.status === 'cancelled').length
    };

    res.status(200).json({
      success: true,
      tasks,
      stats,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Get all tasks for admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tasks',
      error: error.message,
    });
  }
};

// Delete a task (Admin only)
const deleteTaskByAdmin = async (req, res) => {
  try {
    const { taskId } = req.params;

    const task = await Task.findByPk(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found',
      });
    }

    // Check if task can be deleted (not in progress)
    const nonDeletableStatuses = ['in_progress', 'on_the_way', 'arrived'];
    if (nonDeletableStatuses.includes(task.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete task that is ${task.status.replace(/_/g, ' ')}`,
      });
    }

    await task.destroy();

    res.status(200).json({
      success: true,
      message: 'Task deleted successfully',
    });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete task',
      error: error.message,
    });
  }
};


// Get active tasks for admin panel (Active Tasks Dashboard)
const getActiveTasksForAdmin = async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    // Active statuses
    const activeStatuses = ['in_queue', 'published', 'assigned', 'on_the_way', 'arrived', 'in_progress'];

    // Build where clause
    const whereClause = {};
    if (status && status !== 'all' && activeStatuses.includes(status)) {
      whereClause.status = status;
    } else {
      whereClause.status = activeStatuses;
    }

    // Fetch active tasks with related data
    const { count, rows: tasks } = await Task.findAndCountAll({
      where: whereClause,
      attributes: [
        'id',
        'title',
        'description',
        'steps',
        'budget',
        'estimatedDuration',
        'dueDate',
        'status',
        'priority',
        'category',
        'location',
        'assignedHelperId',
        'helpseekerId',
        'acceptedAt',
        'startedAt',
        'createdAt',
        'updatedAt'
      ],
      include: [
        {
          model: Helper,
          as: 'assignedHelper',
          attributes: ['id', 'fullName', 'phone'],
          required: false
        },
        {
          model: Helpseeker,
          as: 'creator',
          attributes: ['id', 'fullName', 'phone'],
          required: false
        }
      ],
      order: [['updatedAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    // Calculate stats for active tasks
    const allActiveTasks = await Task.findAll({ 
      where: { status: activeStatuses },
      attributes: ['status'] 
    });
    
    const stats = {
      total: allActiveTasks.length,
      inQueue: allActiveTasks.filter(t => t.status === 'in_queue').length,
      published: allActiveTasks.filter(t => t.status === 'published').length,
      assigned: allActiveTasks.filter(t => t.status === 'assigned').length,
      onTheWay: allActiveTasks.filter(t => t.status === 'on_the_way').length,
      arrived: allActiveTasks.filter(t => t.status === 'arrived').length,
      inProgress: allActiveTasks.filter(t => t.status === 'in_progress').length
    };

    res.status(200).json({
      success: true,
      tasks,
      stats,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Get active tasks for admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch active tasks',
      error: error.message,
    });
  }
};


module.exports = {
  handleAdminLogin,
  getPendingHelpers,
  approveHelper,
  rejectHelper,
  getAllHelpers,
  handleAdminSignup,
  getHelperDetails,
  getHelperTasks,
  getAllHelpseekers,
  getHelpseekerDetails,
  getHelpseekerTasks,
  updateAdminProfile,
  changeAdminPassword,
  generateTwoFactorSecret,
  enableTwoFactor,
  disableTwoFactor,
  getHelperAnalytics,
  getHelpseekerAnalytics,
  getAllTasksForAdmin,
  deleteTaskByAdmin,
  getActiveTasksForAdmin,
};
