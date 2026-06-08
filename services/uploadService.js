// services/uploadService.js
const Upload = require("../models/Upload");
const fs = require("fs");
const path = require("path");
const { AppError } = require("../middleware/errorMiddleware");
const { toObjectId } = require("./securityUtils");

const uploadsDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

async function removeFileIfExists(filePath) {
  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    if (err.code !== "ENOENT") {
      throw err;
    }
  }
}

async function findUploadById(id, userId) {
  const objectId = toObjectId(id);
  if (!objectId) throw new AppError("Invalid upload ID", 400);

  const query = { _id: objectId };
  if (userId) query.user = toObjectId(userId);

  return Upload.findOne(query);
}

async function findUploadByFilename(filename, userId) {
  const query = { filename, archived: { $ne: true } };
  if (userId) query.user = toObjectId(userId);
  return Upload.findOne(query);
}

async function checkDuplicateUpload(userId, fileHash, optionSignature) {
  return Upload.findOne({
    user: toObjectId(userId),
    fileHash,
    optionSignature,
    processingStatus: "completed",
    archived: { $ne: true }
  })
    .sort({ createdAt: -1 })
    .lean();
}

async function checkDuplicateSourceExcerpt(userId, sourceHash, optionSignature) {
  return Upload.findOne({
    user: toObjectId(userId),
    sourceHash,
    optionSignature,
    processingStatus: "completed",
    archived: { $ne: true }
  })
    .sort({ createdAt: -1 })
    .lean();
}

async function createQueuedUpload({ userId, filename, originalname, fileHash, sourceHash, sourceExcerpt, optionSignature, summaryOptions }) {
  return Upload.create({
    user: toObjectId(userId),
    filename,
    originalname,
    fileHash,
    sourceHash,
    sourceExcerpt,
    optionSignature,
    summaryOptions,
    processingStatus: "queued",
    archived: false,
    thesisValidatedAt: new Date()
  });
}

async function getUserUploads(userId, limit = 50) {
  return Upload.find({
    user: toObjectId(userId),
    archived: { $ne: true },
    processingStatus: "completed"
  })
    .sort({ _id: -1 })
    .limit(limit)
    .lean();
}

async function getArchivedUploads(userId) {
  return Upload.find({
    user: toObjectId(userId),
    archived: true,
    processingStatus: "completed"
  })
    .sort({ archivedAt: -1, createdAt: -1 })
    .limit(50)
    .lean();
}

async function restoreUpload(uploadId, userId) {
  const upload = await findUploadById(uploadId, userId);
  if (!upload || !upload.archived) {
    throw new AppError("Archived summary not found", 404);
  }

  upload.archived = false;
  upload.archivedAt = null;
  await upload.save();
  return upload;
}

async function archiveUpload(uploadId, userId) {
  const upload = await findUploadById(uploadId, userId);
  if (!upload || upload.archived) {
    throw new AppError("Upload not found", 404);
  }

  const filePath = path.join(uploadsDir, upload.filename);
  await removeFileIfExists(filePath);

  upload.archived = true;
  upload.archivedAt = new Date();
  await upload.save();
  return upload;
}

async function permanentlyDeleteUpload(uploadId, userId) {
  const query = { _id: toObjectId(uploadId) };
  if (userId) query.user = toObjectId(userId);

  const upload = await Upload.findOne(query);
  if (!upload) {
    throw new AppError("Upload not found", 404);
  }

  await removeFileIfExists(path.join(uploadsDir, upload.filename));
  await Upload.deleteOne({ _id: upload._id });
  return upload;
}

module.exports = {
  findUploadById,
  findUploadByFilename,
  checkDuplicateUpload,
  checkDuplicateSourceExcerpt,
  createQueuedUpload,
  getUserUploads,
  getArchivedUploads,
  restoreUpload,
  archiveUpload,
  permanentlyDeleteUpload,
  uploadsDir,
  removeFileIfExists
};
