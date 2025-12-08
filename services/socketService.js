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

    // Handle joining task chat room
    socket.on("joinTaskChat", (taskId) => {
      const roomName = `task:${taskId}:chat`;
      socket.join(roomName);
      
      // Get all sockets in the room
      const socketsInRoom = io.sockets.adapter.rooms.get(roomName);
      const clientCount = socketsInRoom ? socketsInRoom.size : 0;
      
      console.log(`👥 [SOCKET SERVER] User ${userId} (${userType}) joined task chat room: ${roomName}`);
      console.log(`📊 [SOCKET SERVER] Total clients in room ${roomName}: ${clientCount}`);
      
      socket.emit("joinedTaskChat", { taskId, roomName, clientCount });
    });

    // Handle subscribing to nearby helpers updates (for helpseekers)
    socket.on("subscribeNearbyHelpers", async (data) => {
      try {
        const { latitude, longitude, radius } = data;
        const roomName = `nearby:${userId}`;
        
        socket.join(roomName);
        console.log(`📍 [SOCKET SERVER] Helpseeker ${userId} subscribed to nearby helpers updates`);
        
        // Immediately send current nearby helpers
        const helperController = require("../controllers/taskController/helpseekerTaskController");
        // Store location data for this user
        socket.helperSearchLocation = { latitude, longitude, radius };
        
        socket.emit("subscribed", { roomName });
      } catch (error) {
        console.error("❌ [SOCKET SERVER] Error subscribing to nearby helpers:", error);
      }
    });

    // Handle unsubscribing from nearby helpers updates
    socket.on("unsubscribeNearbyHelpers", () => {
      const roomName = `nearby:${userId}`;
      socket.leave(roomName);
      delete socket.helperSearchLocation;
      console.log(`📍 [SOCKET SERVER] Helpseeker ${userId} unsubscribed from nearby helpers updates`);
    });

    // Handle leaving task chat room
    socket.on("leaveTaskChat", (taskId) => {
      const roomName = `task:${taskId}:chat`;
      socket.leave(roomName);
      console.log(`👋 [SOCKET SERVER] User ${userId} left task chat room: ${roomName}`);
    });

    // Handle joining task tracking room for real-time location updates
    socket.on("joinTaskTracking", (taskId) => {
      const roomName = `task:${taskId}:tracking`;
      socket.join(roomName);
      const clientCount = this.io.sockets.adapter.rooms.get(roomName)?.size || 0;
      console.log(`📍 [SOCKET SERVER] User ${userId} joined task tracking room: ${roomName} (${clientCount} clients)`);
    });

    // Handle leaving task tracking room
    socket.on("leaveTaskTracking", (taskId) => {
      const roomName = `task:${taskId}:tracking`;
      socket.leave(roomName);
      console.log(`📍 [SOCKET SERVER] User ${userId} left task tracking room: ${roomName}`);
    });

    // Handle sending chat message
    socket.on("sendTaskMessage", async (data) => {
      try {
        const { taskId, message, tempId } = data;
        console.log(`💬 [SOCKET SERVER] Message from ${userId} for task ${taskId}, tempId: ${tempId}`);

        const TaskMessage = require("../models/messageModel/taskMessageModel");
        const Task = require("../models/taskModel/taskModel");
        const Helper = require("../models/authModel/helperModel");
        const Helpseeker = require("../models/authModel/helpseekerModel");

        // Verify task access
        const task = await Task.findByPk(taskId);
        if (!task) {
          console.error(`❌ [SOCKET SERVER] Task not found: ${taskId}`);
          socket.emit("messageError", { error: "Task not found", tempId });
          return;
        }

        if (task.helpseekerId !== userId && task.assignedHelperId !== userId) {
          console.error(`❌ [SOCKET SERVER] Unauthorized access for task ${taskId} by user ${userId}`);
          socket.emit("messageError", { error: "Unauthorized", tempId });
          return;
        }

        // Create message
        const taskMessage = await TaskMessage.create({
          taskId,
          senderId: userId,
          senderType: userType,
          message: message.trim(),
          attachments: data.attachments || [],
          status: 'sent', // Set initial status
        });

        console.log(`✅ [SOCKET SERVER] Message saved to DB: ${taskMessage.id}`);

        // Fetch message with sender details using correct alias
        const senderAlias = userType === 'helper' ? 'senderHelper' : 'senderHelpseeker';
        const senderModel = userType === 'helper' ? Helper : Helpseeker;
        
        const messageWithDetails = await TaskMessage.findByPk(taskMessage.id, {
          include: [
            {
              model: senderModel,
              as: senderAlias,
              attributes: ["id", "fullName", "email", "profilePhoto"],
            },
          ],
        });

        // Normalize sender data to 'sender' for frontend
        const messageToSend = {
          ...messageWithDetails.toJSON(),
          sender: messageWithDetails[senderAlias], // Map to 'sender' for consistency
          tempId: tempId,
        };

        // Remove the original aliased property
        delete messageToSend[senderAlias];

        // Broadcast to task chat room
        const roomName = `task:${taskId}:chat`;
        const socketsInRoom = io.sockets.adapter.rooms.get(roomName);
        const clientCount = socketsInRoom ? socketsInRoom.size : 0;
        
        console.log(`📡 [SOCKET SERVER] Broadcasting to room ${roomName} with ${clientCount} clients`);
        
        io.to(roomName).emit("newTaskMessage", {
          taskId,
          message: messageToSend,
        });

        // Send delivery confirmation to sender
        socket.emit("messageSent", {
          taskId,
          messageId: taskMessage.id,
          tempId: tempId,
          status: "sent",
        });

        console.log(`✅ [SOCKET SERVER] Message broadcasted to room: ${roomName}`);
      } catch (error) {
        console.error("❌ [SOCKET SERVER] Error sending message:", error);
        socket.emit("messageError", { error: error.message });
      }
    });

    // Handle typing indicator
    socket.on("typing", (data) => {
      const { taskId, isTyping } = data;
      const roomName = `task:${taskId}:chat`;
      socket.to(roomName).emit("userTyping", {
        userId,
        userType,
        isTyping,
      });
    });

    // Handle message delivery receipt
    socket.on("messageDelivered", async (data) => {
      try {
        const { messageId, taskId } = data;
        const TaskMessage = require("../models/messageModel/taskMessageModel");
        
        // Update message status
        await TaskMessage.update(
          { 
            status: "delivered",
            deliveredAt: new Date(),
          },
          { where: { id: messageId } }
        );

        // Notify sender about delivery
        const roomName = `task:${taskId}:chat`;
        io.to(roomName).emit("messageStatusUpdate", {
          messageId,
          taskId,
          status: "delivered",
          deliveredAt: new Date(),
        });

        console.log(`✅ [SOCKET SERVER] Message ${messageId} marked as delivered`);
      } catch (error) {
        console.error("❌ [SOCKET SERVER] Error marking message as delivered:", error);
      }
    });

    // Handle message read receipt
    socket.on("messageRead", async (data) => {
      try {
        const { messageId, taskId } = data;
        const TaskMessage = require("../models/messageModel/taskMessageModel");
        
        // Update message status
        await TaskMessage.update(
          { 
            status: "read",
            readAt: new Date(),
          },
          { where: { id: messageId } }
        );

        // Notify sender about read
        const roomName = `task:${taskId}:chat`;
        io.to(roomName).emit("messageStatusUpdate", {
          messageId,
          taskId,
          status: "read",
          readAt: new Date(),
        });

        console.log(`✅ [SOCKET SERVER] Message ${messageId} marked as read`);
      } catch (error) {
        console.error("❌ [SOCKET SERVER] Error marking message as read:", error);
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
 * Broadcast nearby helpers update to specific helpseeker
 * @param {string} helpseekerId - Helpseeker ID
 * @param {object} helpersData - Nearby helpers data
 */
const broadcastNearbyHelpersUpdate = (helpseekerId, helpersData) => {
  try {
    const io = getIO();
    const roomName = `nearby:${helpseekerId}`;
    
    io.to(roomName).emit("nearbyHelpersUpdate", {
      timestamp: new Date().toISOString(),
      ...helpersData,
    });
    
    console.log(`📍 [SOCKET SERVER] Broadcasted nearby helpers update to ${helpseekerId}`);
  } catch (error) {
    console.error("❌ [SOCKET SERVER] Error broadcasting nearby helpers:", error);
  }
};

/**
 * Broadcast helper status change to all subscribed helpseekers
 * @param {string} helperId - Helper ID
 * @param {string} status - 'online' or 'offline'
 * @param {object} helperData - Helper location and details
 */
const broadcastHelperStatusChange = async (helperId, status, helperData) => {
  try {
    const io = getIO();
    
    // Notify all helpseekers who might be interested
    io.emit("helperStatusChanged", {
      helperId,
      status,
      timestamp: new Date().toISOString(),
      ...helperData,
    });
    
    console.log(`📡 [SOCKET SERVER] Broadcasted helper ${helperId} status: ${status}`);
  } catch (error) {
    console.error("❌ [SOCKET SERVER] Error broadcasting helper status:", error);
  }
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
  broadcastNearbyHelpersUpdate,
  broadcastHelperStatusChange,
};
