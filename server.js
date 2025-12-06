require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const initDB = require("./dbConnection/dbSync");
const { initTaskScheduler } = require("./services/taskSchedulerService");
const { initSocketServer } = require("./services/socketService");
const { initializeFirebase } = require("./services/pushNotificationService");

const PORT = process.env.PORT || 8181;
const app = express();
const server = http.createServer(app);

// Allowed frontend origins
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.FRONTEND_URL_2,
].filter(Boolean); 

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) {
        return callback(null, true);
      }

      // Check if origin is in allowed list
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

      // Reject other origins
      callback(new Error("Not allowed by CORS: " + origin));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


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



app.use("/api/auth", authRoutes);


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


app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is running successfully",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

//testing
initDB(() => {
  // Initialize Socket.IO server
  initSocketServer(server);
  
  // Initialize Firebase for push notifications
  initializeFirebase();
  
  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    initTaskScheduler();
    console.log(' Task scheduler initialized');
  });
});
