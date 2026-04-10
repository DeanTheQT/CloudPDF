const Message = require("../models/Message");
const { getOrSetCache, deleteCacheByPrefix } = require("../services/cacheService");
const { logEvent } = require("../services/logService");

exports.createMessage = async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({ message: "Not logged in" });
    }

    const subject = (req.body.subject || "").trim();
    const message = (req.body.message || "").trim();

    if (!subject || !message) {
      return res.status(400).json({ message: "Subject and message are required" });
    }

    const savedMessage = await Message.create({
      user: req.session.user.id,
      username: req.session.user.email || req.session.user.username,
      senderRole: "user",
      subject,
      message,
      archived: false
    });
    deleteCacheByPrefix("admin:messages:");
    deleteCacheByPrefix(`user:inbox:${req.session.user.id}`);

    res.status(201).json({
      success: true,
      id: savedMessage._id,
      message: "Message sent to admin"
    });
  } catch (err) {
    console.error("[ERROR] createMessage:", err);
    res.status(500).json({ message: "Failed to send message" });
  }
};

exports.getMessages = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const search = (req.query.search || "").trim();
    const cacheKey = `admin:messages:page:${page}:limit:${limit}:search:${search.toLowerCase()}`;
    const payload = await getOrSetCache(cacheKey, 20 * 1000, async () => {
      const filter = { archived: { $ne: true }, senderRole: "user" };
      if (search) {
        filter.$or = [
          { username: { $regex: search, $options: "i" } },
          { subject: { $regex: search, $options: "i" } },
          { message: { $regex: search, $options: "i" } }
        ];
      }

      const [items, total] = await Promise.all([
        Message.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate("user", "email username")
          .lean(),
        Message.countDocuments(filter)
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
    console.error("[ERROR] getMessages:", err);
    res.status(500).json({ message: "Failed to load messages" });
  }
};

exports.replyToMessage = async (req, res) => {
  try {
    if (!req.session?.user?.isAdmin) {
      return res.status(403).json({ message: "Admin only" });
    }

    const parent = await Message.findById(req.params.id).populate("user", "email username");
    if (!parent || parent.archived || parent.senderRole !== "user") {
      return res.status(404).json({ message: "Original user message not found" });
    }

    const message = (req.body.message || "").trim();
    if (!message) {
      return res.status(400).json({ message: "Reply message is required" });
    }

    const reply = await Message.create({
      user: parent.user._id,
      username: req.session.user.email || req.session.user.username,
      senderRole: "admin",
      subject: `Re: ${parent.subject}`,
      message,
      archived: false,
      replyTo: parent._id
    });

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
  } catch (err) {
    console.error("[ERROR] replyToMessage:", err);
    res.status(500).json({ message: "Failed to send reply" });
  }
};

exports.getInbox = async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({ message: "Not logged in" });
    }

    const cacheKey = `user:inbox:${req.session.user.id}`;
    const inbox = await getOrSetCache(cacheKey, 20 * 1000, async () => {
      return Message.find({
        user: req.session.user.id,
        senderRole: "admin",
        archived: { $ne: true }
      })
        .sort({ createdAt: -1 })
        .lean();
    });

    res.json(inbox);
  } catch (err) {
    console.error("[ERROR] getInbox:", err);
    res.status(500).json({ message: "Failed to load inbox" });
  }
};

exports.getInboxSummary = async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({ message: "Not logged in" });
    }

    const cacheKey = `user:inbox:${req.session.user.id}`;
    const inbox = await getOrSetCache(cacheKey, 20 * 1000, async () => {
      return Message.find({
        user: req.session.user.id,
        senderRole: "admin",
        archived: { $ne: true }
      })
        .sort({ createdAt: -1 })
        .lean();
    });

    const limit = Math.min(Number(req.query.limit) || 5, 10);
    const unreadCount = inbox.filter((item) => !item.readAt).length;

    res.json({
      unreadCount,
      items: inbox.slice(0, limit)
    });
  } catch (err) {
    console.error("[ERROR] getInboxSummary:", err);
    res.status(500).json({ message: "Failed to load inbox summary" });
  }
};

exports.markInboxMessageRead = async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({ message: "Not logged in" });
    }

    const message = await Message.findOne({
      _id: req.params.id,
      user: req.session.user.id,
      senderRole: "admin",
      archived: { $ne: true }
    });

    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    if (!message.readAt) {
      message.readAt = new Date();
      await message.save();
      deleteCacheByPrefix(`user:inbox:${req.session.user.id}`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[ERROR] markInboxMessageRead:", err);
    res.status(500).json({ message: "Failed to mark message as read" });
  }
};

exports.deleteMessage = async (req, res) => {
  try {
    const deleted = await Message.findById(req.params.id);

    if (!deleted || deleted.archived) {
      return res.status(404).json({ message: "Message not found" });
    }
    deleted.archived = true;
    deleted.archivedAt = new Date();
    await deleted.save();
    deleteCacheByPrefix("admin:messages:");
    deleteCacheByPrefix(`user:inbox:${deleted.user}`);
    deleteCacheByPrefix("admin:logs:");
    logEvent(req, "admin_message_archived", {
      targetMessageId: deleted._id.toString(),
      targetUserId: deleted.user?.toString?.() || String(deleted.user)
    });

    res.json({ success: true });
  } catch (err) {
    console.error("[ERROR] deleteMessage:", err);
    res.status(500).json({ message: "Failed to delete message" });
  }
};

exports.restoreMessage = async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);

    if (!message || !message.archived) {
      return res.status(404).json({ message: "Archived message not found" });
    }

    message.archived = false;
    message.archivedAt = null;
    await message.save();
    deleteCacheByPrefix("admin:messages:");
    deleteCacheByPrefix(`account:stats:${message.user}`);
    deleteCacheByPrefix(`user:inbox:${message.user}`);
    deleteCacheByPrefix("admin:logs:");
    logEvent(req, "admin_message_restored", {
      targetMessageId: message._id.toString(),
      targetUserId: message.user?.toString?.() || String(message.user)
    });

    res.json({ success: true });
  } catch (err) {
    console.error("[ERROR] restoreMessage:", err);
    res.status(500).json({ message: "Failed to restore message" });
  }
};

exports.permanentlyDeleteArchivedMessage = async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);

    if (!message || !message.archived) {
      return res.status(404).json({ message: "Archived message not found" });
    }

    const userId = message.user;
    await Message.deleteOne({ _id: message._id });
    deleteCacheByPrefix("admin:messages:");
    deleteCacheByPrefix(`account:stats:${userId}`);
    deleteCacheByPrefix(`user:inbox:${userId}`);
    deleteCacheByPrefix("admin:logs:");
    logEvent(req, "admin_message_deleted_permanently", {
      targetMessageId: message._id.toString(),
      targetUserId: userId?.toString?.() || String(userId)
    });

    res.json({ success: true });
  } catch (err) {
    console.error("[ERROR] permanentlyDeleteArchivedMessage:", err);
    res.status(500).json({ message: "Failed to permanently delete message" });
  }
};
