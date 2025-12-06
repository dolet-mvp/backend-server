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
  console.log('🚀 [SOCKET SERVER] Initializing Socket.IO server...');
  
  io = new Server(server, {
    cors: {
      origin: function (origin, callback) {
        console.log('🔍 [SOCKET SERVER] CORS check for origin:', origin || 'NO ORIGIN (mobile app)');
        
        // Parse the origin to remove port if it's the default HTTPS port
        let normalizedOrigin = origin;
        if (origin && origin.includes(':443')) {
          normalizedOrigin = origin.replace(':443', '');
          console.log('🔧 [SOCKET SERVER] Normalized origin (removed :443):', normalizedOrigin);
        }
        
        const allowedOrigins = [
          process.env.FRONTEND_URL,
          process.env.FRONTEND_URL_2,
          process.env.FRONTEND_URL_3,
          'https://dolet.pixbit.me', // Production domain
          'http://dolet.pixbit.me', // HTTP variant
        ].filter(Boolean);

        // Allow requests with no origin (mobile apps)
        if (!origin) {
          console.log('✅ [SOCKET SERVER] Allowing request with no origin (mobile app)');
          return callback(null, true);
        }

        // Check allowed origins (check both original and normalized)
        if (allowedOrigins.includes(origin) || allowedOrigins.includes(normalizedOrigin)) {
          console.log('✅ [SOCKET SERVER] Origin allowed:', origin);
          return callback(null, true);
        }

        // Allow localhost/local network for development
        if (
          origin.includes("localhost") ||
          origin.includes("127.0.0.1") ||
          origin.includes("192.168") ||
          origin.includes("10.0.") ||
          origin.includes("dolet.pixbit.me") // Production domain
        ) {
          console.log('✅ [SOCKET SERVER] Local/production origin allowed:', origin);
          return callback(null, true);
        }

        console.warn('⚠️  [SOCKET SERVER] Origin not allowed:', origin);
        // Allow anyway for now (remove in production)
        callback(null, true);
      },
      credentials: true,
      methods: ["GET", "POST"],
    },
    // Try polling first for better compatibility with proxies/HTTPS
    transports: ["polling", "websocket"],
    allowEIO3: true, // Allow Engine.IO v3 clients
    pingTimeout: 60000,
    pingInterval: 25000,
    upgradeTimeout: 30000,
    maxHttpBufferSize: 1e6,
    // Path configuration
    path: '/socket.io/',
  });
  
  console.log('✅ [SOCKET SERVER] Socket.IO server configured');
  console.log('📋 [SOCKET SERVER] Allowed origins:', process.env.FRONTEND_URL, process.env.FRONTEND_URL_2);

  // Authentication middleware for socket connections
  io.use((socket, next) => {
    try {
      console.log('🔐 [SOCKET SERVER] New connection attempt from:', socket.handshake.address);
      console.log('🔍 [SOCKET SERVER] Headers:', JSON.stringify(socket.handshake.headers, null, 2));
      
      const token = socket.handshake.auth.token;
      console.log('🔑 [SOCKET SERVER] Auth token from handshake:', token ? 'PRESENT' : 'MISSING');
      
      if (!token) {
        // Try to get from cookies
        console.log('🍪 [SOCKET SERVER] Trying to get token from cookies...');
        const cookies = cookie.parse(socket.handshake.headers.cookie || "");
        const cookieToken = cookies.token;
        
        if (!cookieToken) {
          console.error('❌ [SOCKET SERVER] No token in auth or cookies');
          return next(new Error("Authentication error: No token provided"));
        }
        
        console.log('✅ [SOCKET SERVER] Token found in cookies');
        const decoded = jwt.verify(cookieToken, process.env.JWT_SECRET);
        socket.userId = decoded.id;
        socket.userType = decoded.userType;
        console.log('✅ [SOCKET SERVER] Cookie token verified:', socket.userId, socket.userType);
        return next();
      }

      console.log('🔓 [SOCKET SERVER] Verifying auth token...');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      socket.userType = decoded.userType;
      console.log('✅ [SOCKET SERVER] Token verified:', socket.userId, socket.userType);
      next();
    } catch (error) {
      console.error("❌ [SOCKET SERVER] Authentication error:", error.message);
      console.error("📋 [SOCKET SERVER] Error stack:", error.stack);
      next(new Error("Authentication error: Invalid token"));
    }
  });

  // Handle socket connections
  io.on("connection", (socket) => {
    const userId = socket.userId;
    const userType = socket.userType;

    console.log(`✅ [SOCKET SERVER] User connected: ${userId} (${userType}) - Socket: ${socket.id}`);
    console.log(`📊 [SOCKET SERVER] Transport: ${socket.conn.transport.name}`);
    console.log(`🌐 [SOCKET SERVER] Client address: ${socket.handshake.address}`);

    // Store user connection
    connectedUsers.set(userId, socket.id);
    console.log(`📝 [SOCKET SERVER] Total connected users: ${connectedUsers.size}`);

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
