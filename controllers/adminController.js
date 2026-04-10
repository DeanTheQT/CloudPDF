// controllers/adminController.js
const User = require("../models/User");
const Upload = require("../models/Upload");
const Log = require("../models/Log");
const Message = require("../models/Message");
const fs = require("fs");
const path = require("path");
const { logEvent } = require("../services/logService");
const { getOrSetCache, deleteCacheByPrefix } = require("../services/cacheService");

function getPaginationParams(req, defaults = {}) {
  const page = Math.max(Number(req.query.page) || defaults.page || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || defaults.limit || 25, 1), defaults.maxLimit || 100);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

const ADMIN_LOG_ACTIONS = [
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
];

// ======================
// GET ALL USERS
// ======================
exports.getUsers = async (req, res) => {
  try {
    const { page, limit, skip } = getPaginationParams(req, { page: 1, limit: 25, maxLimit: 100 });
    const search = (req.query.search || "").trim().toLowerCase();
    const role = (req.query.role || "").trim().toLowerCase();
    const payload = await getOrSetCache(`admin:users:page:${page}:limit:${limit}:search:${search}:role:${role}`, 30 * 1000, async () => {
      const filter = { archived: { $ne: true } };
      if (search) {
        filter.$or = [
          { email: { $regex: search, $options: "i" } },
          { username: { $regex: search, $options: "i" } }
        ];
      }
      if (role === "admin") filter.isAdmin = true;
      if (role === "user") filter.isAdmin = false;

      const [items, total] = await Promise.all([
        User.find(filter)
          .select("-password -otpCode -otpExpiresAt")
          .sort({ _id: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        User.countDocuments(filter)
      ]);

      return { items, total };
    });
    res.json({
      items: payload.items,
      total: payload.total,
      page,
      limit,
      hasMore: skip + payload.items.length < payload.total
    });
  } catch (err) {
    console.error("[ERROR] getUsers:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
};

// ======================
// DELETE USER 
// ======================
exports.deleteUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const uploads = await Upload.find({ user: userId, archived: { $ne: true } }).select("filename");

    for (const upload of uploads) {
      const filePath = path.join(__dirname, "../uploads", upload.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await Promise.all([
      Upload.updateMany({ user: userId, archived: { $ne: true } }, { archived: true, archivedAt: new Date() }),
      Message.updateMany({ user: userId, archived: { $ne: true } }, { archived: true, archivedAt: new Date() }),
      User.findByIdAndUpdate(userId, { archived: true, archivedAt: new Date() })
    ]);
    deleteCacheByPrefix("admin:users:");
    deleteCacheByPrefix(`admin:uploads:user:${userId}:`);
    deleteCacheByPrefix("admin:messages:");
    deleteCacheByPrefix("uploads:user:");
    deleteCacheByPrefix("admin:logs:");

    logEvent(req, "account_deleted", {
      deletedUserId: userId,
      deletedByAdmin: true
    });
    logEvent(req, "admin_user_archived", { targetUserId: userId });

    res.json({ success: true });
  } catch (err) {
    console.error("[ERROR] deleteUser:", err);
    res.status(500).json({ error: "Delete failed" });
  }
};

// ======================
// TOGGLE ADMIN ROLE
// ======================
exports.toggleAdmin = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.archived) return res.status(404).json({ error: "User not found" });

    user.isAdmin = !user.isAdmin;
    await user.save();
    deleteCacheByPrefix("admin:users:");
    deleteCacheByPrefix("admin:logs:");
    logEvent(req, "admin_role_toggled", {
      targetUserId: user._id.toString(),
      isAdmin: user.isAdmin
    });

    res.json({ success: true, isAdmin: user.isAdmin });
  } catch (err) {
    console.error("[ERROR] toggleAdmin:", err);
    res.status(500).json({ error: "Failed to update admin status" });
  }
};

// ======================
// GET UPLOADS BY USER
// ======================
exports.getUploads = async (req, res) => {
  try {
    const filter = {};

    // Require ?user=USER_ID to fetch uploads
    if (req.query.user) {
      filter.user = req.query.user;
    } else {
      return res.json([]); // prevent returning all uploads by default
    }
    filter.archived = { $ne: true };

    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const search = (req.query.search || "").trim();
    const uploads = await getOrSetCache(`admin:uploads:user:${filter.user}:limit:${limit}:search:${search.toLowerCase()}`, 30 * 1000, async () => {
      return Upload.find(filter)
        .populate("user", "email username")
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
    }).then((items) => {
      if (!search) return items;
      const normalized = search.toLowerCase();
      return items.filter((upload) =>
        (upload.originalname || "").toLowerCase().includes(normalized) ||
        (upload.summary || "").toLowerCase().includes(normalized) ||
        (upload.keywords || []).some((keyword) => keyword.toLowerCase().includes(normalized))
      );
    });

    res.json(uploads);
  } catch (err) {
    console.error("[ERROR] getUploads:", err);
    res.status(500).json({ error: "Failed to fetch uploads" });
  }
};

// ======================
// DELETE UPLOAD
// ======================
exports.deleteUpload = async (req, res) => {
  try {
    const upload = await Upload.findById(req.params.id);
    if (!upload || upload.archived) return res.status(404).json({ error: "Upload not found" });

    // Delete file from disk if it exists
    const fs = require("fs");
    const path = require("path");
    const filePath = path.join(__dirname, "../uploads", upload.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    upload.archived = true;
    upload.archivedAt = new Date();
    await upload.save();
    deleteCacheByPrefix("admin:uploads:");
    deleteCacheByPrefix("uploads:user:");
    deleteCacheByPrefix("admin:logs:");
    logEvent(req, "admin_upload_archived", {
      uploadId: upload._id.toString(),
      ownerUserId: upload.user?.toString?.() || String(upload.user)
    });

    res.json({ success: true });
  } catch (err) {
    console.error("[ERROR] deleteUpload:", err);
    res.status(500).json({ error: "Failed to delete upload" });
  }
};

// ======================
// GET RECENT LOGS
// ======================
exports.getLogs = async (req, res) => {
  try {
    const { page, limit, skip } = getPaginationParams(req, { page: 1, limit: 50, maxLimit: 100 });
    const search = (req.query.search || "").trim();
    const action = (req.query.action || "").trim();
    const cacheKey = `admin:logs:page:${page}:limit:${limit}:search:${search.toLowerCase()}:action:${action}`;
    const payload = await getOrSetCache(cacheKey, 15 * 1000, async () => {
      const filter = {
        "meta.actorRole": "admin",
        action: { $in: ADMIN_LOG_ACTIONS }
      };
      if (action) {
        filter.action = action;
      }
      if (search) {
        filter.$or = [
          { action: { $regex: search, $options: "i" } },
          { username: { $regex: search, $options: "i" } }
        ];
      }

      const [logs, total] = await Promise.all([
        Log.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate("user", "email username")
          .lean(),
        Log.countDocuments(filter)
      ]);

      return { logs, total };
    });

    res.json({
      logs: payload.logs,
      total: payload.total,
      page,
      limit,
      hasMore: skip + payload.logs.length < payload.total
    });
  } catch (err) {
    console.error("[ERROR] getLogs:", err);
    res.status(500).json({ error: "Failed to fetch logs" });
  }
};

exports.getArchivedOverview = async (req, res) => {
  try {
    const [users, messages] = await Promise.all([
      User.find({ archived: true }).select("email username archivedAt").sort({ archivedAt: -1 }).limit(50).lean(),
      Message.find({ archived: true }).select("subject username archivedAt user").populate("user", "email username").sort({ archivedAt: -1 }).limit(50).lean()
    ]);

    res.json({ users, messages });
  } catch (err) {
    console.error("[ERROR] getArchivedOverview:", err);
    res.status(500).json({ error: "Failed to fetch archived items" });
  }
};

exports.restoreUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || !user.archived) return res.status(404).json({ error: "Archived user not found" });

    user.archived = false;
    user.archivedAt = null;
    await user.save();

    await Promise.all([
      Upload.updateMany({ user: user._id, archived: true }, { archived: false, archivedAt: null }),
      Message.updateMany({ user: user._id, archived: true }, { archived: false, archivedAt: null })
    ]);

    deleteCacheByPrefix("admin:users:");
    deleteCacheByPrefix(`admin:uploads:user:${user._id}:`);
    deleteCacheByPrefix("admin:messages:");
    deleteCacheByPrefix("uploads:user:");
    deleteCacheByPrefix(`account:stats:${user._id}`);
    deleteCacheByPrefix("admin:logs:");
    logEvent(req, "admin_user_restored", { targetUserId: user._id.toString() });

    res.json({ success: true });
  } catch (err) {
    console.error("[ERROR] restoreUser:", err);
    res.status(500).json({ error: "Failed to restore user" });
  }
};

exports.restoreUpload = async (req, res) => {
  try {
    const upload = await Upload.findById(req.params.id);
    if (!upload || !upload.archived) return res.status(404).json({ error: "Archived upload not found" });

    upload.archived = false;
    upload.archivedAt = null;
    await upload.save();

    deleteCacheByPrefix("admin:uploads:");
    deleteCacheByPrefix("uploads:user:");
    deleteCacheByPrefix(`account:stats:${upload.user}`);
    deleteCacheByPrefix("admin:logs:");
    logEvent(req, "admin_upload_restored", {
      uploadId: upload._id.toString(),
      ownerUserId: upload.user?.toString?.() || String(upload.user)
    });

    res.json({ success: true });
  } catch (err) {
    console.error("[ERROR] restoreUpload:", err);
    res.status(500).json({ error: "Failed to restore upload" });
  }
};

exports.permanentlyDeleteArchivedUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || !user.archived) return res.status(404).json({ error: "Archived user not found" });

    const uploads = await Upload.find({ user: user._id }).select("filename");
    for (const upload of uploads) {
      const filePath = path.join(__dirname, "../uploads", upload.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await Promise.all([
      Upload.deleteMany({ user: user._id }),
      Message.deleteMany({ user: user._id }),
      User.deleteOne({ _id: user._id })
    ]);

    deleteCacheByPrefix("admin:users:");
    deleteCacheByPrefix(`admin:uploads:user:${user._id}:`);
    deleteCacheByPrefix("admin:messages:");
    deleteCacheByPrefix("uploads:user:");
    deleteCacheByPrefix(`account:stats:${user._id}`);
    deleteCacheByPrefix("admin:logs:");
    logEvent(req, "admin_user_deleted_permanently", { targetUserId: user._id.toString() });

    res.json({ success: true });
  } catch (err) {
    console.error("[ERROR] permanentlyDeleteArchivedUser:", err);
    res.status(500).json({ error: "Failed to permanently delete user" });
  }
};

exports.permanentlyDeleteArchivedUpload = async (req, res) => {
  try {
    const upload = await Upload.findById(req.params.id);
    if (!upload) return res.status(404).json({ error: "Upload not found" });

    const filePath = path.join(__dirname, "../uploads", upload.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await Upload.deleteOne({ _id: upload._id });

    deleteCacheByPrefix("admin:uploads:");
    deleteCacheByPrefix("uploads:user:");
    deleteCacheByPrefix(`account:stats:${upload.user}`);
    deleteCacheByPrefix("admin:logs:");
    logEvent(req, "admin_upload_deleted_permanently", {
      uploadId: upload._id.toString(),
      ownerUserId: upload.user?.toString?.() || String(upload.user)
    });

    res.json({ success: true });
  } catch (err) {
    console.error("[ERROR] permanentlyDeleteArchivedUpload:", err);
    res.status(500).json({ error: "Failed to permanently delete upload" });
  }
};

exports.getAnalytics = async (req, res) => {
  try {
    const [totalUsers, totalUploads, totalMessages, totalArchivedUsers, totalArchivedUploads, totalArchivedMessages, uploads, logs] = await Promise.all([
      User.countDocuments({ archived: { $ne: true } }),
      Upload.countDocuments({ archived: { $ne: true } }),
      Message.countDocuments({ archived: { $ne: true } }),
      User.countDocuments({ archived: true }),
      Upload.countDocuments({ archived: true }),
      Message.countDocuments({ archived: true }),
      Upload.find({ archived: { $ne: true } }).select("keywords createdAt").lean(),
      Log.find().sort({ createdAt: -1 }).limit(200).lean()
    ]);

    const keywordCounts = new Map();
    uploads.forEach((upload) => {
      (upload.keywords || []).forEach((keyword) => {
        const normalized = String(keyword || "").trim();
        if (!normalized) return;
        keywordCounts.set(normalized, (keywordCounts.get(normalized) || 0) + 1);
      });
    });

    const topKeywords = [...keywordCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([keyword, count]) => ({ keyword, count }));

    const actionCounts = logs.reduce((acc, log) => {
      const key = log.action || "unknown";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    res.json({
      totals: {
        totalUsers,
        totalUploads,
        totalMessages,
        totalArchivedUsers,
        totalArchivedUploads,
        totalArchivedMessages
      },
      topKeywords,
      actionCounts
    });
  } catch (err) {
    console.error("[ERROR] getAnalytics:", err);
    res.status(500).json({ error: "Failed to load analytics" });
  }
};
