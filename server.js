require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const initDB = require("./dbConnection/dbSync");
const { initTaskScheduler } = require("./services/taskSchedulerService");
const { initSocketServer } = require("./services/socketService");
const { initializeFirebase } = require("./services/pushNotificationService");
const { processRetryQueue } = require("./services/taskDeliveryService");

const PORT = process.env.PORT || 8181;
const app = express();
const server = http.createServer(app);

// Allowed frontend origins
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.FRONTEND_URL_2,
  process.env.FRONTEND_URL_3,
  'https://dolet.pixbit.me',
  'http://dolet.pixbit.me',
].filter(Boolean); 

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) {
        return callback(null, true);
      }

      // Normalize origin by removing :443 for HTTPS
      let normalizedOrigin = origin;
      if (origin.includes(':443')) {
        normalizedOrigin = origin.replace(':443', '');
      }

      // Check if origin is in allowed list (check both original and normalized)
      if (allowedOrigins.includes(origin) || allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }

      // Allow localhost/local network for development and production domain
      if (
        origin.includes("localhost") ||
        origin.includes("127.0.0.1") ||
        origin.includes("192.168") ||
        origin.includes("10.0.") ||
        origin.includes("dolet.pixbit.me")
      ) {
        return callback(null, true);
      }

      // Allow anyway for now (log warning but don't reject)
      console.warn('⚠️  CORS: Origin not in whitelist but allowing:', origin);
      callback(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Import block check middleware
const { checkUserBlocked } = require("./middleware/blockCheckMiddleware");

const authRoutes = require("./routes/authRoute/authRoute");
const profileRoutes = require("./routes/profileRoute/profileRoute");
const addressRoutes = require("./routes/addressRoute/addressRoute");
const taskRoutes = require("./routes/taskRoute/taskRoute");
const bidRoutes = require("./routes/bidRoute/bidRoute");
const trackingRoutes = require("./routes/trackingRoute/trackingRoute");
const paymentRoutes = require("./routes/paymentRoute/paymentRoute");
const ratingRoutes = require("./routes/ratingRoute/ratingRoute");
const helperRoutes = require("./routes/helperRoute/helperRoute");
const notificationRoutes = require("./routes/notificationRoute/notificationRoute");
const testNotificationRoutes = require("./routes/notificationRoute/testNotificationRoute");
const diagnosticRoutes = require("./routes/notificationRoute/diagnosticRoute");
const supportRoutes = require("./routes/supportRoute/supportRoute");
const taskMessageRoutes = require("./routes/messageRoute/taskMessageRoute");
const geminiRoutes = require("./routes/aiRoute/gemniRoute");
const reportRoutes = require("./routes/reportRoute/reportRoute");
const blockRoutes = require("./routes/blockRoute/blockRoute");
const adminRoutes = require("./routes/adminRoute/adminRoute");
const locationRoutes = require("./routes/locationRoute/locationRoute");
const optionalAuthentication = require("./middleware/authMiddleware").optionalAuthentication;



app.use("/api/auth", authRoutes);

app.use(optionalAuthentication());
app.use(checkUserBlocked);

app.use("/api/ai", geminiRoutes);

app.use(
  "/api/user",
  profileRoutes, addressRoutes
);

app.use(
  "/api/tasks",
  taskRoutes
);

// Bid management routes
app.use(
  "/api/bids",
  bidRoutes
);

// Task tracking routes
app.use(
  "/api/tracking",
  trackingRoutes
);

// Payment routes
app.use(
  "/api/payments",
  paymentRoutes
);

// Rating routes
app.use(
  "/api/ratings",
  ratingRoutes
);

// Helper profile routes
app.use(
  "/api/helpers",
  helperRoutes
);

// Location routes
app.use(
  "/api/location",
  locationRoutes
);

// Notification routes
app.use(
  "/api/notifications",
  notificationRoutes
);

// Test notification routes (for development/testing)
app.use(
  "/api/notifications",
  testNotificationRoutes
);

// Diagnostic routes
app.use(
  "/api/notifications",
  diagnosticRoutes
);

// Report routes
app.use(
  "/api/report",
  reportRoutes
);

// Support ticket routes
app.use(
  "/api/support",
  supportRoutes
);

// Task message routes
app.use(
  "/api/messages",
  taskMessageRoutes
);

// Block management routes (Admin only)
app.use(
  "/api/admin/blocks",
  blockRoutes
);

// Admin routes
app.use(
  "/api/admin",
  adminRoutes
);


app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is running successfully",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

initDB(() => {
  initSocketServer(server);
  initializeFirebase();
  
  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    initTaskScheduler();
    console.log(' Task scheduler initialized');
    const RETRY_INTERVAL = 2000; 
    setInterval(async () => {
      try {
        await processRetryQueue();
      } catch (error) {
        console.error(' [RETRY] Error processing retry queue:', error);
      }
    }, RETRY_INTERVAL);
    console.log(` Task delivery retry processor initialized (interval: ${RETRY_INTERVAL}ms)`);
  });
});

//testing
