// server.js
require("dotenv").config();
const express = require("express");
const path = require("path");
const session = require("express-session");
const MongoStore = require("connect-mongo").default;

const { connectDB } = require("./config/db");
const { attachCsrfToken, requireCsrf, getCsrfToken } = require("./middleware/csrfMiddleware");
const { startUploadQueueProcessor } = require("./services/uploadQueueService");

const authRoutes = require("./routes/authRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const adminRoutes = require("./routes/adminRoutes");
const messageRoutes = require("./routes/messageRoutes");

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required in production");
}


// =========================
// DATABASE & EVENT INITIALIZATION
// =========================
const { initEventListeners } = require("./services/eventListeners");
initEventListeners();
connectDB();
startUploadQueueProcessor();


// =========================
// BODY PARSERS
// =========================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
  );
  next();
});


// =========================
// SESSION CONFIGURATION
// =========================
app.use(
  session({
    name: "cloudpdf_session",
    secret: process.env.SESSION_SECRET || "development-only-session-secret",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      collectionName: "sessions"
    }),
    cookie: {
      maxAge: 1000 * 60 * 60,
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction
    }
  })
);

app.use(attachCsrfToken);
app.get("/auth/csrf-token", getCsrfToken);
app.use(requireCsrf);


// =========================
// STATIC FILES 
// =========================

// serve frontend files
app.use(express.static(path.join(__dirname, "public"), { index: false }));


// =========================
// ROUTES
// =========================
app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/messages", messageRoutes);
app.use("/", uploadRoutes);


// Default route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "home.html"));
});

// Global Error Handler
const { globalErrorHandler } = require("./middleware/errorMiddleware");
app.use(globalErrorHandler);

// =========================
// START SERVER
// =========================
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
