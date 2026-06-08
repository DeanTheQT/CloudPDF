// services/messageService.js
const Message = require("../models/Message");
const { AppError } = require("../middleware/errorMiddleware");
const { toObjectId } = require("./securityUtils");

async function createMessage({ userId, username, subject, message }) {
  if (!subject || !message) {
    throw new AppError("Subject and message are required", 400);
  }

  return Message.create({
    user: toObjectId(userId),
    username,
    senderRole: "user",
    subject,
    message,
    archived: false
  });
}

async function getMessagesList({ page, limit, skip, search }) {
  const filter = { archived: { $ne: true }, senderRole: "user" };
  if (search) {
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { username: { $regex: escapedSearch, $options: "i" } },
      { subject: { $regex: escapedSearch, $options: "i" } },
      { message: { $regex: escapedSearch, $options: "i" } }
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
}

async function replyToMessage(messageId, replyMessage, adminUser) {
  const objectId = toObjectId(messageId);
  if (!objectId) throw new AppError("Invalid message ID", 400);

  const parent = await Message.findById(objectId).populate("user", "email username");
  if (!parent || parent.archived || parent.senderRole !== "user") {
    throw new AppError("Original user message not found", 404);
  }

  if (!replyMessage) {
    throw new AppError("Reply message is required", 400);
  }

  const reply = await Message.create({
    user: parent.user._id,
    username: adminUser.email || adminUser.username,
    senderRole: "admin",
    subject: `Re: ${parent.subject}`,
    message: replyMessage,
    archived: false,
    replyTo: parent._id
  });

  return { reply, parent };
}

async function getUserInbox(userId) {
  return Message.find({
    user: toObjectId(userId),
    senderRole: "admin",
    archived: { $ne: true }
  })
    .sort({ createdAt: -1 })
    .lean();
}

async function markMessageRead(messageId, userId) {
  const objectId = toObjectId(messageId);
  if (!objectId) throw new AppError("Invalid message ID", 400);

  const message = await Message.findOne({
    _id: objectId,
    user: toObjectId(userId),
    senderRole: "admin",
    archived: { $ne: true }
  });

  if (!message) {
    throw new AppError("Message not found", 404);
  }

  if (!message.readAt) {
    message.readAt = new Date();
    await message.save();
    return true; // was updated
  }

  return false; // already read
}

async function archiveMessage(messageId) {
  const objectId = toObjectId(messageId);
  if (!objectId) throw new AppError("Invalid message ID", 400);

  const message = await Message.findById(objectId);
  if (!message || message.archived) {
    throw new AppError("Message not found", 404);
  }

  message.archived = true;
  message.archivedAt = new Date();
  await message.save();
  return message;
}

async function restoreMessage(messageId) {
  const objectId = toObjectId(messageId);
  if (!objectId) throw new AppError("Invalid message ID", 400);

  const message = await Message.findById(objectId);
  if (!message || !message.archived) {
    throw new AppError("Archived message not found", 404);
  }

  message.archived = false;
  message.archivedAt = null;
  await message.save();
  return message;
}

async function permanentlyDeleteMessage(messageId) {
  const objectId = toObjectId(messageId);
  if (!objectId) throw new AppError("Invalid message ID", 400);

  const message = await Message.findById(objectId);
  if (!message || !message.archived) {
    throw new AppError("Archived message not found", 404);
  }

  await Message.deleteOne({ _id: message._id });
  return message;
}

module.exports = {
  createMessage,
  getMessagesList,
  replyToMessage,
  getUserInbox,
  markMessageRead,
  archiveMessage,
  restoreMessage,
  permanentlyDeleteMessage
};
