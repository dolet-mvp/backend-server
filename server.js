require("dotenv").config();
const express = require("express");
const cors = require("cors");
const initDB = require("./dbConnection/dbSync");

const PORT = process.env.PORT || 8181;
const app = express();

// CORS configuration optimized for React Native
app.use(
  cors({
    origin: function (origin, callback) {
      // React Native apps don't send origin headers, so we allow requests without origin
      // In development, also allow localhost origins for testing
      if (
        !origin ||
        origin.includes("localhost") ||
        origin.includes("127.0.0.1") ||
        origin.includes("192.168") ||
        origin.includes("10.0.") ||
        origin === process.env.FRONTEND_URL
      ) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS: " + origin));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const checkForAuthenticationCookie = require("./middleware/authMiddleware");
const { authorizeRoles } = require("./middleware/roleMiddleware");
const authRoutes = require("./routes/authRoute/authRoute");
const profileRoutes = require("./routes/profileRoute/profileRoute");
const addressRoutes = require("./routes/addressRoute/addressRoute");

app.use("/api/auth", authRoutes);

app.use(
  "/api/user",
  checkForAuthenticationCookie("token"),
  authorizeRoles(["helpseeker", "helper", "admin"]),
  profileRoutes, addressRoutes
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
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
});
