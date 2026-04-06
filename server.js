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


// =========================
// DATABASE CONNECTION
// =========================
connectDB();
startUploadQueueProcessor();


// =========================
// BODY PARSERS
// =========================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// =========================
// SESSION CONFIGURATION
// =========================
app.use(
  session({
    name: "cloudpdf_session",
    secret: process.env.SESSION_SECRET || "supersecret",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      collectionName: "sessions"
    }),
    cookie: {
      maxAge: 1000 * 60 * 60,
      httpOnly: true,
      secure: false
    }
  })
);

app.use(attachCsrfToken);
app.get("/auth/csrf-token", getCsrfToken);
app.use(requireCsrf);


// =========================
// STATIC FILES 
// =========================

// serve uploaded PDFs
app.use(
  "/uploads",
  express.static(path.join(__dirname, "uploads"), {
    setHeaders: (res) => {
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("Content-Type", "application/pdf");
    }
  })
);

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
  res.sendFile(path.join(__dirname, "public", "Home.html"));
});


// =========================
// START SERVER
// =========================
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
