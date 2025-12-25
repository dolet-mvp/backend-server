const Admin = require("../../models/authModel/adminModel");
const Helper = require("../../models/authModel/helperModel");
const Task = require("../../models/taskModel/taskModel");
const Helpseeker = require("../../models/authModel/helpseekerModel");
const { createToken } = require("../../services/authServices");
const bcrypt = require("bcryptjs");


const handleAdminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

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

    // Generate token
    const token = createToken(admin, "admin");

    const { password: _, ...adminData } = admin.toJSON();

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

    res.json({
      success: true,
      count: helpers.length,
      helpers,
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

    res.json({
      success: true,
      total: count,
      helpers,
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

    res.json({
      success: true,
      helper,
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
};
