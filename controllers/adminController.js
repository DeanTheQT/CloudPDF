// controllers/adminController.js
const User = require("../models/User");
const Upload = require("../models/Upload");
const Log = require("../models/Log");
const Message = require("../models/Message");
const userService = require("../services/userService");
const uploadService = require("../services/uploadService");
const { logEvent } = require("../services/logService");
const { getOrSetCache, deleteCacheByPrefix } = require("../services/cacheService");
const { escapeRegex, limitText, toObjectId } = require("../services/securityUtils");
const { asyncHandler, AppError } = require("../middleware/errorMiddleware");

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
exports.getUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req, { page: 1, limit: 25, maxLimit: 100 });
  const search = limitText(req.query.search, 80).toLowerCase();
  const role = (req.query.role || "").trim().toLowerCase();

  const payload = await getOrSetCache(`admin:users:page:${page}:limit:${limit}:search:${search}:role:${role}`, 30 * 1000, async () => {
    return userService.getUsersList({ page, limit, skip, search, role });
  });

  res.json({
    items: payload.items,
    total: payload.total,
    page,
    limit,
    hasMore: skip + payload.items.length < payload.total
  });
});

// ======================
// DELETE USER 
// ======================
exports.deleteUser = asyncHandler(async (req, res) => {
  const userId = req.params.id;
  const currentSessionUserId = req.session.user.id;

  await userService.deleteUserAccount(userId, currentSessionUserId);

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
});

// ======================
// TOGGLE ADMIN ROLE
// ======================
exports.toggleAdmin = asyncHandler(async (req, res) => {
  const targetUserId = req.params.id;
  const currentSessionUserId = req.session.user.id;

  const user = await userService.toggleAdminRole(targetUserId, currentSessionUserId);

  deleteCacheByPrefix("admin:users:");
  deleteCacheByPrefix("admin:logs:");
  logEvent(req, "admin_role_toggled", {
    targetUserId: user._id.toString(),
    isAdmin: user.isAdmin
  });

  res.json({ success: true, isAdmin: user.isAdmin });
});

// ======================
// GET UPLOADS BY USER
// ======================
exports.getUploads = asyncHandler(async (req, res) => {
  let userId = null;

  if (req.query.user) {
    const objectId = toObjectId(req.query.user);
    if (!objectId) throw new AppError("Invalid user ID", 400);
    userId = objectId;
  } else {
    return res.json([]); // prevent returning all uploads by default
  }

  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const search = limitText(req.query.search, 80);
  const cacheKey = `admin:uploads:user:${userId}:limit:${limit}:search:${search.toLowerCase()}`;

  const uploads = await getOrSetCache(cacheKey, 30 * 1000, async () => {
    return Upload.find({ user: userId, archived: { $ne: true } })
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
});

// ======================
// DELETE UPLOAD
// ======================
exports.deleteUpload = asyncHandler(async (req, res) => {
  const uploadId = req.params.id;
  const upload = await uploadService.archiveUpload(uploadId);

  deleteCacheByPrefix("admin:uploads:");
  deleteCacheByPrefix("uploads:user:");
  deleteCacheByPrefix("admin:logs:");

  logEvent(req, "admin_upload_archived", {
    uploadId: upload._id.toString(),
    ownerUserId: upload.user?.toString?.() || String(upload.user)
  });

  res.json({ success: true });
});

// ======================
// GET RECENT LOGS
// ======================
exports.getLogs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req, { page: 1, limit: 50, maxLimit: 100 });
  const search = limitText(req.query.search, 80);
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
      const escapedSearch = escapeRegex(search);
      filter.$or = [
        { action: { $regex: escapedSearch, $options: "i" } },
        { username: { $regex: escapedSearch, $options: "i" } }
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
});

exports.getArchivedOverview = asyncHandler(async (req, res) => {
  const [users, messages] = await Promise.all([
    User.find({ archived: true }).select("email username archivedAt").sort({ archivedAt: -1 }).limit(50).lean(),
    Message.find({ archived: true }).select("subject username archivedAt user").populate("user", "email username").sort({ archivedAt: -1 }).limit(50).lean()
  ]);

  res.json({ users, messages });
});

exports.restoreUser = asyncHandler(async (req, res) => {
  const userId = req.params.id;
  const user = await userService.restoreUserAccount(userId);

  deleteCacheByPrefix("admin:users:");
  deleteCacheByPrefix(`admin:uploads:user:${user._id}:`);
  deleteCacheByPrefix("admin:messages:");
  deleteCacheByPrefix("uploads:user:");
  deleteCacheByPrefix(`account:stats:${user._id}`);
  deleteCacheByPrefix("admin:logs:");
  logEvent(req, "admin_user_restored", { targetUserId: user._id.toString() });

  res.json({ success: true });
});

exports.restoreUpload = asyncHandler(async (req, res) => {
  const uploadId = req.params.id;
  const upload = await uploadService.restoreUpload(uploadId);

  deleteCacheByPrefix("admin:uploads:");
  deleteCacheByPrefix("uploads:user:");
  deleteCacheByPrefix(`account:stats:${upload.user}`);
  deleteCacheByPrefix("admin:logs:");

  logEvent(req, "admin_upload_restored", {
    uploadId: upload._id.toString(),
    ownerUserId: upload.user?.toString?.() || String(upload.user)
  });

  res.json({ success: true });
});

exports.permanentlyDeleteArchivedUser = asyncHandler(async (req, res) => {
  const userId = req.params.id;
  const currentSessionUserId = req.session.user.id;

  if (userId === currentSessionUserId) {
    throw new AppError("You cannot delete your own account while signed in", 400);
  }

  const user = await userService.permanentlyDeleteUserAccount(userId);

  deleteCacheByPrefix("admin:users:");
  deleteCacheByPrefix(`admin:uploads:user:${user._id}:`);
  deleteCacheByPrefix("admin:messages:");
  deleteCacheByPrefix("uploads:user:");
  deleteCacheByPrefix(`account:stats:${user._id}`);
  deleteCacheByPrefix("admin:logs:");
  logEvent(req, "admin_user_deleted_permanently", { targetUserId: user._id.toString() });

  res.json({ success: true });
});

exports.permanentlyDeleteArchivedUpload = asyncHandler(async (req, res) => {
  const uploadId = req.params.id;
  const upload = await uploadService.permanentlyDeleteUpload(uploadId);

  deleteCacheByPrefix("admin:uploads:");
  deleteCacheByPrefix("uploads:user:");
  deleteCacheByPrefix(`account:stats:${upload.user}`);
  deleteCacheByPrefix("admin:logs:");
  logEvent(req, "admin_upload_deleted_permanently", {
    uploadId: upload._id.toString(),
    ownerUserId: upload.user?.toString?.() || String(upload.user)
  });

  res.json({ success: true });
});

exports.getAnalytics = asyncHandler(async (req, res) => {
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
});
