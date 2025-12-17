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

    // Store user connection with userType
    connectedUsers.set(socket.id, { userId, userType, socketId: socket.id });
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
      const clientCount = this.io?.sockets?.adapter?.rooms?.get(roomName)?.size || 0;
      console.log(`📍 [SOCKET SERVER] User ${userId} joined task tracking room: ${roomName} (${clientCount} clients)`);
    });

    // Handle leaving task tracking room
    socket.on("leaveTaskTracking", (taskId) => {
      const roomName = `task:${taskId}:tracking`;
      socket.leave(roomName);
      console.log(`📍 [SOCKET SERVER] User ${userId} left task tracking room: ${roomName}`);
    });

    // Handle joining job search (real-time available tasks for helpers)
    socket.on("joinJobSearch", async (data) => {
      try {
        console.log(`🔍 [SOCKET] Helper ${userId} requesting to join job search. Data:`, data);
        
        if (userType !== "helper") {
          socket.emit("jobSearchError", { message: "Only helpers can search for jobs" });
          return;
        }

        let helperLat, helperLng;
        let searchRadius = 50; // Default 50km

        // Priority 1: Use location data from client (most accurate, current location)
        if (data && data.lat && data.lng) {
          helperLat = parseFloat(data.lat);
          helperLng = parseFloat(data.lng);
          if (data.radius) {
            searchRadius = parseFloat(data.radius);
          }
          console.log(`✅ [SOCKET] Using location from client: ${helperLat}, ${helperLng}, radius: ${searchRadius}km`);
        } else {
          // Priority 2: Get helper's data from Redis (includes location)
          console.log(`📍 [SOCKET] No client location, checking Redis...`);
          const redis = require("../config/redis/redis");
          const cachedHelper = await redis.get(`helper:online:${userId}`);
          
          if (!cachedHelper) {
            console.warn(`⚠️ [SOCKET] Helper ${userId} not found in Redis online helpers`);
            socket.emit("jobSearchError", { 
              message: "You must be online to search for jobs",
              requiresAction: "Go online first"
            });
            return;
          }

          const helperData = typeof cachedHelper === 'string' ? JSON.parse(cachedHelper) : cachedHelper;
          
          // Get helper's address
          if (helperData.addresses && helperData.addresses.length > 0) {
            const helperAddress = helperData.addresses.find(addr => addr.isDefault) || helperData.addresses[0];
            if (helperAddress && helperAddress.latitude && helperAddress.longitude) {
              helperLat = parseFloat(helperAddress.latitude);
              helperLng = parseFloat(helperAddress.longitude);
              console.log(`✅ [SOCKET] Using location from Redis: ${helperLat}, ${helperLng}`);
            }
          }
        }

        if (!helperLat || !helperLng) {
          console.error(`❌ [SOCKET] No location available for helper ${userId}`);
          socket.emit("jobSearchError", { 
            message: "Please add your address with location coordinates to search for jobs"
          });
          return;
        }

        // Store helper's location on socket for filtering new jobs
        socket.jobSearchData = {
          helperId: userId,
          latitude: helperLat,
          longitude: helperLng,
          radius: searchRadius,
        };

        const roomName = `job:search:${userId}`;
        socket.join(roomName);
        
        console.log(`✅ [SOCKET] ========================================`);
        console.log(`✅ [SOCKET] Helper ${userId} joined job search`);
        console.log(`📍 [SOCKET] Location: ${helperLat}, ${helperLng}, Radius: ${searchRadius}km`);
        console.log(`🔍 [SOCKET] Socket ID: ${socket.id}`);
        console.log(`🔍 [SOCKET] Socket connected: ${socket.connected}`);
        console.log(`🔍 [SOCKET] jobSearchData:`, socket.jobSearchData);
        console.log(`✅ [SOCKET] ========================================`);
        
        socket.emit("joinedJobSearch", { 
          message: "Connected to real-time job updates",
          location: { lat: helperLat, lng: helperLng },
          radius: searchRadius
        });

        // Send initial available tasks (reuse getAvailableTasks logic)
        const helperTaskController = require("../controllers/taskController/helperTaskController");
        const mockReq = { user: { id: userId, userType: 'helper' } };
        const mockRes = {
          status: (code) => ({
            json: (data) => {
              if (data.success && data.data) {
                socket.emit("availableJobs", {
                  jobs: data.data,
                  count: data.data.length,
                  message: data.data.length > 0 ? `Found ${data.data.length} jobs nearby` : "No jobs available right now"
                });
                console.log(`📤 [SOCKET] Sent ${data.data.length} initial jobs to helper ${userId}`);
              }
            }
          })
        };

        // Call getAvailableTasks to get initial jobs
        await helperTaskController.getAvailableTasks(mockReq, mockRes);

      } catch (error) {
        console.error("❌ [SOCKET] Error joining job search:", error);
        socket.emit("jobSearchError", { message: error.message });
      }
    });

    // Handle leaving job search
    socket.on("leaveJobSearch", () => {
      if (userType === "helper") {
        const roomName = `job:search:${userId}`;
        socket.leave(roomName);
        delete socket.jobSearchData;
        console.log(`🚪 [SOCKET] Helper ${userId} left job search`);
        socket.emit("leftJobSearch", { message: "Disconnected from job updates" });
      }
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

        console.log('🔍 [SOCKET SERVER] Task authorization check:');
        console.log('   Task ID:', taskId);
        console.log('   Task helpseekerId:', task.helpseekerId);
        console.log('   Task assignedHelperId:', task.assignedHelperId);
        console.log('   Current userId:', userId);
        console.log('   Current userType:', userType);
        console.log('   Is helpseeker?:', task.helpseekerId === userId);
        console.log('   Is assigned helper?:', task.assignedHelperId === userId);

        if (task.helpseekerId !== userId && task.assignedHelperId !== userId) {
          console.error(`❌ [SOCKET SERVER] Unauthorized access for task ${taskId} by user ${userId}`);
          console.error('   Neither helpseeker nor assigned helper matches');
          socket.emit("messageError", { error: "Unauthorized", tempId });
          return;
        }
        
        console.log('✅ [SOCKET SERVER] Authorization check passed');

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

        // Broadcast to task chat room (EXCLUDING sender to prevent duplicates)
        const roomName = `task:${taskId}:chat`;
        const socketsInRoom = io.sockets.adapter.rooms.get(roomName);
        const clientCount = socketsInRoom ? socketsInRoom.size : 0;
        
        console.log(`📡 [SOCKET SERVER] Broadcasting to room ${roomName} with ${clientCount} clients`);
        
        // Use socket.to() instead of io.to() to exclude the sender
        socket.to(roomName).emit("newTaskMessage", {
          taskId,
          message: messageToSend,
        });

        // Send delivery confirmation to sender with full message details
        socket.emit("messageSent", {
          taskId,
          messageId: taskMessage.id,
          tempId: tempId,
          message: messageToSend,
          status: "sent",
        });

        console.log(`✅ [SOCKET SERVER] Message sent to others in room: ${roomName}`);
        console.log(`✅ [SOCKET SERVER] Confirmation sent back to sender with tempId: ${tempId}`);

        // Send push notification to the recipient (only if not in chat)
        const recipientId = userType === 'helper' ? task.helpseekerId : task.assignedHelperId;
        const recipientType = userType === 'helper' ? 'helpseeker' : 'helper';
        
        console.log(`🔍 [SOCKET SERVER] Checking notification for recipient: ${recipientType} ${recipientId}`);
        console.log(`👤 [SOCKET SERVER] Sender: ${userType} ${userId}`);
        
        // Check if recipient is in the room (online in chat)
        // Find the recipient's socket(s) in connectedUsers
        const recipientSockets = Array.from(connectedUsers.entries()).filter(
          ([socketId, user]) => user.userId === recipientId && user.userType === recipientType
        );
        
        console.log(`🔌 [SOCKET SERVER] Found ${recipientSockets.length} socket(s) for recipient ${recipientId}`);
        
        // Check if ANY of the recipient's sockets is in the chat room
        let recipientInChat = false;
        if (recipientSockets.length > 0 && socketsInRoom) {
          recipientInChat = recipientSockets.some(([socketId]) => socketsInRoom.has(socketId));
          console.log(`📊 [SOCKET SERVER] Recipient in chat room: ${recipientInChat}`);
        }
        
        // Log all sockets in the room for debugging
        if (socketsInRoom) {
          console.log(`👥 [SOCKET SERVER] Sockets in room ${roomName}:`, Array.from(socketsInRoom));
        }
        
        if (!recipientInChat) {
          // Recipient is not in chat, send push notification
          console.log(`📱 [SOCKET SERVER] Sending push notification:`);
          console.log(`   Recipient: ${recipientType} ${recipientId}`);
          console.log(`   Sender: ${userType} ${userId}`);
          console.log(`   Task: ${taskId}`);
          
          const { sendToUser } = require("./pushNotificationService");
          const senderName = messageWithDetails[senderAlias]?.fullName || 'Someone';
          
          console.log(`   Sender name: ${senderName}`);
          console.log(`   Message preview: ${message.substring(0, 50)}...`);
          
          sendToUser(
            recipientId,
            recipientType,
            {
              title: `New message from ${senderName}`,
              body: message.length > 100 ? message.substring(0, 100) + '...' : message,
            },
            {
              type: 'new_message',
              taskId: taskId.toString(),
              messageId: taskMessage.id.toString(),
              senderId: userId,
              senderType: userType,
              openChat: 'true',
            }
          ).then(() => {
            console.log(`✅ [SOCKET SERVER] Push notification sent successfully to ${recipientType} ${recipientId}`);
          }).catch(err => {
            console.error(`❌ [SOCKET SERVER] Failed to send push notification to ${recipientType} ${recipientId}:`, err.message);
          });
        } else {
          console.log(`ℹ️ [SOCKET SERVER] Recipient IS in chat room, skipping push notification`);
        }
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
      console.log(`❌ User disconnected: ${userId} (${userType}) - Socket: ${socket.id}`);
      connectedUsers.delete(socket.id);
      console.log(`📝 [SOCKET SERVER] Remaining connected users: ${connectedUsers.size}`);
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
    
    // Validate inputs
    if (!helperId || !status) {
      console.error("❌ [SOCKET SERVER] Invalid broadcast parameters: helperId and status are required");
      return;
    }
    
    if (!['online', 'offline'].includes(status)) {
      console.error(`❌ [SOCKET SERVER] Invalid status: ${status}. Must be 'online' or 'offline'`);
      return;
    }
    
    // Ensure payload has consistent structure
    const payload = {
      helperId: helperId.toString(), // Ensure string
      status,
      timestamp: new Date().toISOString(),
      helper: helperData?.helper || null,
    };
    
    // Notify all helpseekers who might be interested
    io.emit("helperStatusChanged", payload);
    
    console.log(`📡 [SOCKET SERVER] Broadcasted helper ${helperId} status: ${status}`);
    console.log(`📦 [SOCKET SERVER] Payload:`, JSON.stringify(payload, null, 2));
    console.log(`👥 [SOCKET SERVER] Connected clients: ${io.engine.clientsCount}`);
  } catch (error) {
    console.error("❌ [SOCKET SERVER] Error broadcasting helper status:", error);
    console.error("Stack trace:", error.stack);
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

/**
 * Broadcast new job to helpers searching for jobs (based on location and associated tasks)
 * @param {object} taskData - New task data from Redis
 */
const broadcastNewJobToSearchingHelpers = async (taskData) => {
  try {
    const io = getIO();
    const redis = require("../config/redis/redis");
    const { calculateDistance, getGoogleMapsDistances } = require("../controllers/taskController/helperTaskController");
    
    console.log(`🚀 [SOCKET BROADCAST] Starting broadcast for new task`, {
      taskId: taskData.taskId || taskData.id,
      title: taskData.title,
      hasLocation: !!(taskData.location || (taskData.steps && taskData.steps[0])),
    });
    
    // Get task location
    const taskLocation = taskData.location || (taskData.steps && taskData.steps[0] ? taskData.steps[0].location : null);
    
    if (!taskLocation || !taskLocation.lat || !taskLocation.lng) {
      console.log(`⚠️ [SOCKET BROADCAST] Task ${taskData.taskId} has no location, skipping broadcast`);
      return;
    }

    const taskLat = parseFloat(taskLocation.lat);
    const taskLng = parseFloat(taskLocation.lng);
    const taskId = taskData.taskId || taskData.id;
    let broadcastCount = 0;
    let helpersInSearch = 0;
    let eligibleHelpers = 0;
    let helpersChecked = 0;

    // Get all connected sockets
    const sockets = io.sockets.sockets;
    console.log(`🔍 [SOCKET BROADCAST] Checking ${sockets.size} connected sockets for task ${taskId}`);
    console.log(`🔍 [SOCKET BROADCAST] Connected users in Map:`, connectedUsers.size);
    
    for (const [socketId, socket] of sockets) {
      helpersChecked++;
      
      // Get helper info from socket connection or job search data
      const userInfo = Array.from(connectedUsers.entries()).find(
        ([sid, user]) => sid === socketId && user.userType === 'helper'
      );
      
      const helperId = socket.jobSearchData?.helperId || userInfo?.[1]?.userId;
      const latitude = socket.jobSearchData?.latitude;
      const longitude = socket.jobSearchData?.longitude;
      const radius = socket.jobSearchData?.radius || 50; // Default 50km if not in search
      
      // Skip if not a helper
      if (!helperId) {
        console.log(`⏭️ [SOCKET BROADCAST] Socket ${socketId} - not a helper (userType: ${userInfo?.[1]?.userType || 'none'})`);
        continue;
      }
      
      if (socket.jobSearchData) {
        helpersInSearch++;
      }
      
      console.log(`👤 [SOCKET BROADCAST] Checking helper ${helperId} - Socket: ${socketId} (In search: ${!!socket.jobSearchData})`);

      try {
        // Check if helper is in associated tasks list
        const helperTasksKey = `helper:${helperId}:associated_tasks`;
        const associatedTasksData = await redis.get(helperTasksKey);
          
          let associatedTaskIds = [];
          if (associatedTasksData) {
            associatedTaskIds = typeof associatedTasksData === 'string' 
              ? JSON.parse(associatedTasksData) 
              : associatedTasksData;
          }

          
          console.log(`📋 [SOCKET BROADCAST] Helper ${helperId} associated tasks:`, associatedTaskIds);
          
          // Only send if task is in helper's associated list
          if (associatedTaskIds.includes(taskId)) {
            eligibleHelpers++;
            console.log(`✅ [SOCKET BROADCAST] Helper ${helperId} is eligible for task ${taskId}`);
            
            // If helper not in search (no location), send basic notification
            if (!latitude || !longitude) {
              const jobPayload = {
                ...taskData,
                distance: null,
                distanceText: 'N/A',
                durationText: 'N/A',
              };
              
              console.log(`📤 [SOCKET BROADCAST] Emitting basic notification to helper ${helperId} (not in search)`);
              socket.emit("newJobAvailable", jobPayload);
              broadcastCount++;
              console.log(`📤 [SOCKET BROADCAST] ✅ Sent new job ${taskId} to helper ${helperId} (no distance calc)`);
              continue;
            }
            
            // Calculate distance for helpers in search mode
            const distance = calculateDistance(latitude, longitude, taskLat, taskLng);
            console.log(`📏 [SOCKET BROADCAST] Distance: ${distance.toFixed(2)}km (max: ${radius}km)`);

            if (distance <= radius) {
              // Get Google Maps distance for accurate info
              let distanceInfo = {
                distance: parseFloat(distance.toFixed(2)),
                distanceText: `${distance.toFixed(1)} km`,
                durationText: 'N/A',
                source: 'haversine'
              };

              try {
                const googleDistances = await getGoogleMapsDistances(
                  { lat: latitude, lng: longitude },
                  [{ lat: taskLat, lng: taskLng }]
                );

                if (googleDistances && googleDistances[0] && googleDistances[0].status === 'OK') {
                  const gDistance = googleDistances[0].distance;
                  const gDuration = googleDistances[0].duration;
                  
                  distanceInfo = {
                    distance: parseFloat(gDistance.toFixed(2)),
                    distanceText: gDistance < 1 ? `${Math.round(gDistance * 1000)} m` : `${gDistance.toFixed(1)} km`,
                    durationText: gDuration < 60 ? `${Math.round(gDuration)} mins` : `${Math.floor(gDuration / 60)} hr ${Math.round(gDuration % 60)} mins`,
                    duration: gDuration * 60,
                    source: 'google_maps'
                  };
                }
              } catch (error) {
                console.warn(`⚠️ [SOCKET BROADCAST] Google Maps failed for helper ${helperId}, using haversine`);
              }

              // Send new job to this helper
              const jobPayload = {
                ...taskData,
                ...distanceInfo
              };
              
              console.log(`📤 [SOCKET BROADCAST] Emitting to socket ${socketId}`);
              console.log(`📤 [SOCKET BROADCAST] Helper ID: ${helperId}`);
              console.log(`📤 [SOCKET BROADCAST] Event: newJobAvailable`);
              console.log(`📤 [SOCKET BROADCAST] Payload:`, JSON.stringify(jobPayload, null, 2));
              
              socket.emit("newJobAvailable", jobPayload);

              broadcastCount++;
              console.log(`📤 [SOCKET BROADCAST] ✅ Sent new job ${taskId} to helper ${helperId} via socket ${socketId} (${distanceInfo.distanceText} away)`);
            } else {
              console.log(`⚠️ [SOCKET BROADCAST] Helper ${helperId} is ${distance.toFixed(2)}km away (outside ${radius}km radius)`);
            }
          } else {
            console.log(`⚠️ [SOCKET BROADCAST] Task ${taskId} not in helper ${helperId}'s associated tasks`);
          }
      } catch (error) {
        console.error(`❌ [SOCKET BROADCAST] Error processing helper ${helperId}:`, error.message);
      }
    }

    console.log(`📊 [SOCKET BROADCAST] Summary for task ${taskData.taskId}:`);
    console.log(`   - Total sockets: ${sockets.size}`);
    console.log(`   - Sockets checked: ${helpersChecked}`);
    console.log(`   - Helpers in job search: ${helpersInSearch}`);
    console.log(`   - Eligible helpers (in associated list): ${eligibleHelpers}`);
    console.log(`   - Successfully broadcasted to: ${broadcastCount} helpers`);
    
    if (broadcastCount === 0) {
      console.warn(`⚠️ [SOCKET BROADCAST] WARNING: No helpers received the broadcast!`);
      console.warn(`   - Check if helpers are connected and associated with task ${taskId}`);
    }
  } catch (error) {
    console.error("❌ [SOCKET BROADCAST] Error broadcasting new job:", error);
  }
};

/**
 * Notify a helper of available jobs after task association completes
 * This solves the race condition where helper goes online and socket joins job search
 * before backend task association completes
 */
const notifyHelperOfAvailableJobs = async (helperId) => {
  try {
    console.log(`📢 [SOCKET] Notifying helper ${helperId} of available jobs after association...`);
    
    // Find the helper's socket ID from connectedUsers Map
    const helperSocketEntry = Array.from(connectedUsers.entries()).find(
      ([socketId, user]) => user.userId === helperId && user.userType === 'helper'
    );
    
    if (!helperSocketEntry) {
      console.log(`⚠️ [SOCKET] Helper ${helperId} not connected, cannot notify`);
      return;
    }
    
    const socketId = helperSocketEntry[0];
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) {
      console.log(`⚠️ [SOCKET] Socket ${socketId} not found for helper ${helperId}`);
      return;
    }
    
    console.log(`✅ [SOCKET] Found socket ${socketId} for helper ${helperId}`);

    // Get available tasks for this helper using the controller
    const helperTaskController = require("../controllers/taskController/helperTaskController");
    const mockReq = { user: { id: helperId, userType: 'helper' } };
    const mockRes = {
      status: (code) => ({
        json: (data) => {
          if (data.success && data.data) {
            const jobs = data.data;
            socket.emit("availableJobs", {
              jobs: jobs,
              count: jobs.length,
              message: jobs.length > 0 ? `Found ${jobs.length} jobs nearby` : "No jobs available right now"
            });
            console.log(`✅ [SOCKET] Sent ${jobs.length} available jobs to helper ${helperId} after association`);
          } else {
            console.log(`ℹ️ [SOCKET] No jobs available for helper ${helperId} after association`);
          }
        }
      })
    };

    // Call getAvailableTasks to fetch jobs
    await helperTaskController.getAvailableTasks(mockReq, mockRes);
  } catch (error) {
    console.error(`❌ [SOCKET] Error notifying helper ${helperId} of available jobs:`, error);
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
  broadcastNewJobToSearchingHelpers,
  notifyHelperOfAvailableJobs,
  connectedUsers,
};
