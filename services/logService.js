// services/logService.js
const winston = require("winston");
const Log = require("../models/Log");

const ALLOWED_ACTIONS = new Set([
  "user_registered",
  "account_deleted",
  "admin_user_archived",
  "admin_user_restored",
  "admin_user_deleted_permanently",
  "admin_role_toggled",
  "admin_upload_archived",
  "admin_upload_restored",
  "admin_upload_deleted_permanently",
  "admin_message_archived",
  "admin_message_restored",
  "admin_message_deleted_permanently",
  "admin_message_replied"
]);

// Create Winston logger configured for standard stdout/stderr output
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console()
  ]
});

function normalizeLog(entry = {}) {
  return {
    level: entry.level || "info",
    action: entry.action || "unknown",
    method: entry.method || "",
    path: entry.path || "",
    statusCode: entry.statusCode,
    durationMs: entry.durationMs,
    user: entry.user || undefined,
    username: entry.username || "",
    meta: entry.meta || {},
    createdAt: entry.createdAt || new Date()
  };
}

function logEvent(req, action, meta = {}, level = "info") {
  if (!ALLOWED_ACTIONS.has(action)) {
    return;
  }

  const actorRole = req.session?.user?.isAdmin ? "admin" : "user";
  const logEntry = normalizeLog({
    level,
    action,
    method: req.method,
    path: req.originalUrl,
    statusCode: meta.statusCode,
    user: req.session?.user?.id,
    username: req.session?.user?.email || req.session?.user?.username,
    meta: {
      actorRole,
      ...meta
    }
  });

  // 1. Structured log directly to Winston stdout/stderr
  if (level === "error") {
    logger.error(logEntry);
  } else if (level === "warn") {
    logger.warn(logEntry);
  } else {
    logger.info(logEntry);
  }

  // 2. Persist directly to MongoDB in the background (non-blocking, async)
  Log.create(logEntry).catch((err) => {
    // Log failures to write to MongoDB locally
    logger.error({
      message: "Failed to persist log event to MongoDB",
      error: err.message,
      originalLog: logEntry
    });
  });
}

// Backward compatibility stub
async function flushLogs() {
  return Promise.resolve();
}

module.exports = {
  logEvent,
  flushLogs
};
