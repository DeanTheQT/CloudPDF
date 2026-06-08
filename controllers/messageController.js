const messageService = require("../services/messageService");
const { getOrSetCache, deleteCacheByPrefix } = require("../services/cacheService");
const { logEvent } = require("../services/logService");
const { escapeRegex, limitText, toObjectId } = require("../services/securityUtils");
const { asyncHandler, AppError } = require("../middleware/errorMiddleware");
const { SUBJECT_MAX_LENGTH, MESSAGE_MAX_LENGTH } = require("../config/constants");

exports.createMessage = asyncHandler(async (req, res) => {
  if (!req.session?.user) {
    throw new AppError("Not logged in", 401);
  }

  const subject = limitText(req.body.subject, SUBJECT_MAX_LENGTH);
  const message = limitText(req.body.message, MESSAGE_MAX_LENGTH);

  const savedMessage = await messageService.createMessage({
    userId: req.session.user.id,
    username: req.session.user.email || req.session.user.username,
    subject,
    message
  });

  deleteCacheByPrefix("admin:messages:");
  deleteCacheByPrefix(`user:inbox:${req.session.user.id}`);

  res.status(201).json({
    success: true,
    id: savedMessage._id,
    message: "Message sent to admin"
  });
});

exports.getMessages = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const skip = (page - 1) * limit;
  const search = limitText(req.query.search, 80);

  const cacheKey = `admin:messages:page:${page}:limit:${limit}:search:${search.toLowerCase()}`;
  const payload = await getOrSetCache(cacheKey, 20 * 1000, async () => {
    return messageService.getMessagesList({ page, limit, skip, search });
  });

  res.json({
    items: payload.items,
    total: payload.total,
    page,
    limit,
    hasMore: skip + payload.items.length < payload.total
  });
});

exports.replyToMessage = asyncHandler(async (req, res) => {
  if (!req.session?.user?.isAdmin) {
    throw new AppError("Admin only", 403);
  }

  const messageId = req.params.id;
  const replyMessageContent = limitText(req.body.message, MESSAGE_MAX_LENGTH);

  const { reply, parent } = await messageService.replyToMessage(messageId, replyMessageContent, req.session.user);

  deleteCacheByPrefix(`user:inbox:${parent.user._id}`);
  deleteCacheByPrefix("admin:messages:");
  deleteCacheByPrefix("admin:logs:");

  logEvent(req, "admin_message_replied", {
    targetMessageId: parent._id.toString(),
    targetUserId: parent.user._id.toString()
  });

  res.status(201).json({
    success: true,
    id: reply._id,
    message: "Reply sent to user"
  });
});

exports.getInbox = asyncHandler(async (req, res) => {
  if (!req.session?.user) {
    throw new AppError("Not logged in", 401);
  }

  const cacheKey = `user:inbox:${req.session.user.id}`;
  const inbox = await getOrSetCache(cacheKey, 20 * 1000, async () => {
    return messageService.getUserInbox(req.session.user.id);
  });

  res.json(inbox);
});

exports.getInboxSummary = asyncHandler(async (req, res) => {
  if (!req.session?.user) {
    throw new AppError("Not logged in", 401);
  }

  const cacheKey = `user:inbox:${req.session.user.id}`;
  const inbox = await getOrSetCache(cacheKey, 20 * 1000, async () => {
    return messageService.getUserInbox(req.session.user.id);
  });

  const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 10);
  const unreadCount = inbox.filter((item) => !item.readAt).length;

  res.json({
    unreadCount,
    items: inbox.slice(0, limit)
  });
});

exports.markInboxMessageRead = asyncHandler(async (req, res) => {
  if (!req.session?.user) {
    throw new AppError("Not logged in", 401);
  }

  const messageId = req.params.id;
  const wasUpdated = await messageService.markMessageRead(messageId, req.session.user.id);

  if (wasUpdated) {
    deleteCacheByPrefix(`user:inbox:${req.session.user.id}`);
  }

  res.json({ success: true });
});

exports.deleteMessage = asyncHandler(async (req, res) => {
  const messageId = req.params.id;
  const deleted = await messageService.archiveMessage(messageId);

  deleteCacheByPrefix("admin:messages:");
  deleteCacheByPrefix(`user:inbox:${deleted.user}`);
  deleteCacheByPrefix("admin:logs:");

  logEvent(req, "admin_message_archived", {
    targetMessageId: deleted._id.toString(),
    targetUserId: deleted.user?.toString?.() || String(deleted.user)
  });

  res.json({ success: true });
});

exports.restoreMessage = asyncHandler(async (req, res) => {
  const messageId = req.params.id;
  const message = await messageService.restoreMessage(messageId);

  deleteCacheByPrefix("admin:messages:");
  deleteCacheByPrefix(`account:stats:${message.user}`);
  deleteCacheByPrefix(`user:inbox:${message.user}`);
  deleteCacheByPrefix("admin:logs:");

  logEvent(req, "admin_message_restored", {
    targetMessageId: message._id.toString(),
    targetUserId: message.user?.toString?.() || String(message.user)
  });

  res.json({ success: true });
});

exports.permanentlyDeleteArchivedMessage = asyncHandler(async (req, res) => {
  const messageId = req.params.id;
  const message = await messageService.permanentlyDeleteMessage(messageId);
  const userId = message.user;

  deleteCacheByPrefix("admin:messages:");
  deleteCacheByPrefix(`account:stats:${userId}`);
  deleteCacheByPrefix(`user:inbox:${userId}`);
  deleteCacheByPrefix("admin:logs:");

  logEvent(req, "admin_message_deleted_permanently", {
    targetMessageId: message._id.toString(),
    targetUserId: userId?.toString?.() || String(userId)
  });

  res.json({ success: true });
});
