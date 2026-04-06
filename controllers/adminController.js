// controllers/adminController.js
const User = require("../models/User");
const Upload = require("../models/Upload");
const Log = require("../models/Log");
const Message = require("../models/Message");
const fs = require("fs");
const path = require("path");
const { logEvent } = require("../services/logService");
const { getOrSetCache, deleteCacheByPrefix, deleteCache } = require("../services/cacheService");

// ======================
// GET ALL USERS
// ======================
exports.getUsers = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 200);
    const search = (req.query.search || "").trim().toLowerCase();
    const users = await getOrSetCache(`admin:users:limit:${limit}:search:${search}`, 30 * 1000, async () => {
      const filter = { archived: { $ne: true } };
      if (search) {
        filter.$or = [
          { email: { $regex: search, $options: "i" } },
          { username: { $regex: search, $options: "i" } }
        ];
      }
      return User.find(filter)
        .select("-password -otpCode -otpExpiresAt")
        .sort({ _id: -1 })
        .limit(limit)
        .lean();
    });
    res.json(users);
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
    deleteCache("admin:logs");

    logEvent(req, "account_deleted", {
      deletedUserId: userId,
      deletedByAdmin: true
    });

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
    const { logs, total } = await getOrSetCache("admin:logs", 15 * 1000, async () => {
      const [logs, total] = await Promise.all([
        Log.find()
          .sort({ createdAt: -1 })
          .limit(200)
          .populate("user", "email username")
          .lean(),
        Log.estimatedDocumentCount()
      ]);
      return { logs, total };
    }).then((payload) => {
      const search = (req.query.search || "").trim().toLowerCase();
      if (!search) return payload;
      return {
        ...payload,
        logs: payload.logs.filter((log) =>
          (log.action || "").toLowerCase().includes(search) ||
          (log.username || log.user?.email || log.user?.username || "").toLowerCase().includes(search)
        )
      };
    });

    res.json({ logs, total });
  } catch (err) {
    console.error("[ERROR] getLogs:", err);
    res.status(500).json({ error: "Failed to fetch logs" });
  }
};

exports.getArchivedOverview = async (req, res) => {
  try {
    const [users, uploads, messages] = await Promise.all([
      User.find({ archived: true }).select("email username archivedAt").sort({ archivedAt: -1 }).limit(50).lean(),
      Upload.find({ archived: true }).select("originalname archivedAt user").populate("user", "email username").sort({ archivedAt: -1 }).limit(50).lean(),
      Message.find({ archived: true }).select("subject username archivedAt user").populate("user", "email username").sort({ archivedAt: -1 }).limit(50).lean()
    ]);

    res.json({ users, uploads, messages });
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

    res.json({ success: true });
  } catch (err) {
    console.error("[ERROR] restoreUpload:", err);
    res.status(500).json({ error: "Failed to restore upload" });
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
