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
const LOG_BATCH_SIZE = 200;
const LOG_FLUSH_INTERVAL_MS = 2000;
const MAX_QUEUE_SIZE = 5000;

const queue = [];
let flushInProgress = false;
let droppedLogs = 0;

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

function enqueueLog(entry) {
  if (queue.length >= MAX_QUEUE_SIZE) {
    queue.shift();
    droppedLogs += 1;
  }

  queue.push(normalizeLog(entry));

  if (queue.length >= LOG_BATCH_SIZE) {
    void flushLogs();
  }
}

async function flushLogs() {
  if (flushInProgress || queue.length === 0) {
    return;
  }

  flushInProgress = true;

  try {
    const batch = queue.splice(0, LOG_BATCH_SIZE);

    if (droppedLogs > 0) {
      batch.unshift(
        normalizeLog({
          level: "warn",
          action: "log_queue_overflow",
          meta: { droppedLogs },
          createdAt: new Date()
        })
      );
      droppedLogs = 0;
    }

    await Log.insertMany(batch, { ordered: false });
  } catch (err) {
    console.error("[ERROR] flushLogs:", err);
  } finally {
    flushInProgress = false;

    if (queue.length > 0) {
      setImmediate(() => {
        void flushLogs();
      });
    }
  }
}

function logEvent(req, action, meta = {}, level = "info") {
  if (!ALLOWED_ACTIONS.has(action)) {
    return;
  }

  const actorRole = req.session?.user?.isAdmin ? "admin" : "user";
  enqueueLog({
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
}

const flushTimer = setInterval(() => {
  void flushLogs();
}, LOG_FLUSH_INTERVAL_MS);

if (typeof flushTimer.unref === "function") {
  flushTimer.unref();
}

process.on("beforeExit", () => {
  void flushLogs();
});

module.exports = {
  logEvent,
  flushLogs
};
