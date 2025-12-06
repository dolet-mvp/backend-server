const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const cookie = require("cookie");

let io;
const connectedUsers = new Map(); // Map to track userId -> socketId

/**
 * Initialize Socket.IO server
 * @param {http.Server} server - HTTP server instance
 */
const initSocketServer = (server) => {
  io = new Server(server, {
    cors: {
      origin: function (origin, callback) {
        const allowedOrigins = [
          process.env.FRONTEND_URL,
          process.env.FRONTEND_URL_2,
        ].filter(Boolean);

        // Allow requests with no origin (mobile apps)
        if (!origin) {
          return callback(null, true);
        }

        // Check allowed origins
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }

        // Allow localhost/local network for development
        if (
          origin.includes("localhost") ||
          origin.includes("127.0.0.1") ||
          origin.includes("192.168") ||
          origin.includes("10.0.")
        ) {
          return callback(null, true);
        }

        callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });

  // Authentication middleware for socket connections
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        // Try to get from cookies
        const cookies = cookie.parse(socket.handshake.headers.cookie || "");
        const cookieToken = cookies.token;
        
        if (!cookieToken) {
          return next(new Error("Authentication error: No token provided"));
        }
        
        const decoded = jwt.verify(cookieToken, process.env.JWT_SECRET);
        socket.userId = decoded.id;
        socket.userType = decoded.userType;
        return next();
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      socket.userType = decoded.userType;
      next();
    } catch (error) {
      console.error("Socket authentication error:", error.message);
      next(new Error("Authentication error: Invalid token"));
    }
  });

  // Handle socket connections
  io.on("connection", (socket) => {
    const userId = socket.userId;
    const userType = socket.userType;

    console.log(`✅ User connected: ${userId} (${userType}) - Socket: ${socket.id}`);

    // Store user connection
    connectedUsers.set(userId, socket.id);

    // Join user to their personal room
    socket.join(`user:${userId}`);
    socket.join(`${userType}:${userId}`);

    // Send connection confirmation
    socket.emit("connected", {
      message: "Connected to notification server",
      userId,
      userType,
    });

    // Handle manual notification request
    socket.on("getUnreadCount", async () => {
      try {
        const Notification = require("../models/notificationModel/notificationModel");
        
        const whereClause = { isRead: false, userType };
        if (userType === "helper") {
          whereClause.helperId = userId;
        } else if (userType === "helpseeker") {
          whereClause.helpseekerId = userId;
        }

        const unreadCount = await Notification.count({ where: whereClause });
        
        socket.emit("unreadCount", { count: unreadCount });
      } catch (error) {
        console.error("Error getting unread count:", error);
      }
    });

    // Handle notification read status
    socket.on("markAsRead", async (notificationId) => {
      try {
        const Notification = require("../models/notificationModel/notificationModel");
        
        const whereClause = { id: notificationId, userType };
        if (userType === "helper") {
          whereClause.helperId = userId;
        } else if (userType === "helpseeker") {
          whereClause.helpseekerId = userId;
        }

        await Notification.update(
          { isRead: true },
          { where: whereClause }
        );

        socket.emit("markedAsRead", { notificationId });
      } catch (error) {
        console.error("Error marking notification as read:", error);
      }
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      console.log(`❌ User disconnected: ${userId} - Socket: ${socket.id}`);
      connectedUsers.delete(userId);
    });

    // Handle errors
    socket.on("error", (error) => {
      console.error(`Socket error for user ${userId}:`, error);
    });
  });

  console.log("🔌 Socket.IO server initialized");
  return io;
};

/**
 * Get Socket.IO instance
 */
const getIO = () => {
  if (!io) {
    throw new Error("Socket.IO not initialized. Call initSocketServer first.");
  }
  return io;
};

/**
 * Emit notification to a specific user
 * @param {string} userId - User ID to send notification to
 * @param {string} userType - User type (helper/helpseeker)
 * @param {object} notification - Notification data
 */
const emitToUser = (userId, userType, event, data) => {
  try {
    const io = getIO();
    
    // Emit to user's personal room
    io.to(`user:${userId}`).emit(event, data);
    io.to(`${userType}:${userId}`).emit(event, data);
    
    console.log(`📤 Emitted '${event}' to user ${userId} (${userType})`);
  } catch (error) {
    console.error("Error emitting to user:", error);
  }
};

/**
 * Check if user is connected
 * @param {string} userId - User ID to check
 * @returns {boolean} - True if user is connected
 */
const isUserConnected = (userId) => {
  return connectedUsers.has(userId);
};

/**
 * Get all connected users count
 * @returns {number} - Number of connected users
 */
const getConnectedUsersCount = () => {
  return connectedUsers.size;
};

/**
 * Broadcast to all users of a specific type
 * @param {string} userType - User type (helper/helpseeker/admin)
 * @param {string} event - Event name
 * @param {object} data - Data to send
 */
const broadcastToUserType = (userType, event, data) => {
  try {
    const io = getIO();
    io.to(userType).emit(event, data);
    console.log(`📢 Broadcasted '${event}' to all ${userType}s`);
  } catch (error) {
    console.error("Error broadcasting to user type:", error);
  }
};

module.exports = {
  initSocketServer,
  getIO,
  emitToUser,
  isUserConnected,
  getConnectedUsersCount,
  broadcastToUserType,
};
