const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pdfParse = require("pdf-parse");
const Upload = require("../models/Upload");
const { summarizeText, validateThesisText } = require("./geminiService");
const { deleteCacheByPrefix } = require("./cacheService");

const fsPromises = fs.promises;
const MAX_CONCURRENT_UPLOADS = Math.max(1, Number(process.env.MAX_CONCURRENT_UPLOADS || 1));
const POLL_INTERVAL_MS = Math.max(2000, Number(process.env.UPLOAD_QUEUE_POLL_MS || 4000));

let activeWorkers = 0;
let processorStarted = false;
let processorTimer = null;

function hashValue(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function removeFileIfExists(filePath) {
  try {
    await fsPromises.unlink(filePath);
  } catch (err) {
    if (err.code !== "ENOENT") {
      throw err;
    }
  }
}

async function failUpload(upload, message) {
  upload.processingStatus = "failed";
  upload.processingError = message;
  upload.completedAt = new Date();
  await upload.save();
  deleteCacheByPrefix(`uploads:user:${upload.user}:`);
  deleteCacheByPrefix(`account:stats:${upload.user}`);
}

async function markDuplicate(upload, existingUpload) {
  upload.processingStatus = "duplicate";
  upload.processingError = "This thesis was already summarized with the same options.";
  upload.duplicateOf = existingUpload._id;
  upload.completedAt = new Date();
  upload.archived = true;
  upload.archivedAt = new Date();
  await upload.save();
  const filePath = path.join(__dirname, "../uploads", upload.filename);
  await removeFileIfExists(filePath);
  deleteCacheByPrefix(`uploads:user:${upload.user}:`);
  deleteCacheByPrefix(`account:stats:${upload.user}`);
}

async function processUpload(uploadId) {
  const upload = await Upload.findOneAndUpdate(
    { _id: uploadId, processingStatus: "queued", archived: { $ne: true } },
    {
      processingStatus: "processing",
      processingStartedAt: new Date(),
      processingError: null
    },
    { new: true }
  );

  if (!upload) return;

  const filePath = path.join(__dirname, "../uploads", upload.filename);

  try {
    const buffer = await fsPromises.readFile(filePath);
    const pdfData = await pdfParse(buffer);
    const cleanText = (pdfData.text || "").replace(/\s+/g, " ").trim();
    const limitedText = cleanText.slice(0, 12000);

    if (!limitedText) {
      await failUpload(upload, "The PDF content could not be read.");
      return;
    }

    upload.sourceHash = hashValue(limitedText);
    await upload.save();

    const existingUpload = await Upload.findOne({
      _id: { $ne: upload._id },
      user: upload.user,
      sourceHash: upload.sourceHash,
      optionSignature: upload.optionSignature,
      processingStatus: "completed",
      archived: { $ne: true }
    })
      .sort({ createdAt: -1 })
      .lean();

    if (existingUpload) {
      await markDuplicate(upload, existingUpload);
      return;
    }

    const thesisCheck = await validateThesisText(limitedText);
    if (!thesisCheck?.isThesis) {
      await failUpload(upload, thesisCheck?.reason || "This PDF is not a valid thesis document.");
      await removeFileIfExists(filePath);
      return;
    }

    const aiResult = await summarizeText(limitedText, upload.summaryOptions || {});
    const finalSummary = Array.isArray(aiResult.summary)
      ? aiResult.summary.map((point) => `- ${point}`).join("\n\n")
      : aiResult.summary;

    upload.summary = finalSummary || "";
    upload.keywords = aiResult.keywords || [];
    upload.highlights = aiResult.highlights || [];
    upload.citations = aiResult.citations || [];
    upload.processingStatus = "completed";
    upload.processingError = null;
    upload.thesisValidatedAt = new Date();
    upload.completedAt = new Date();
    await upload.save();

    deleteCacheByPrefix(`uploads:user:${upload.user}:`);
    deleteCacheByPrefix(`account:stats:${upload.user}`);
  } catch (err) {
    console.error("[ERROR] upload queue processing failed:", err);
    await failUpload(upload, err.message || "Internal Server Error during PDF processing");
  }
}

async function kickUploadProcessor() {
  if (activeWorkers >= MAX_CONCURRENT_UPLOADS) return;

  const availableSlots = MAX_CONCURRENT_UPLOADS - activeWorkers;
  const queuedUploads = await Upload.find({
    processingStatus: "queued",
    archived: { $ne: true }
  })
    .sort({ createdAt: 1 })
    .limit(availableSlots)
    .select("_id");

  queuedUploads.forEach(({ _id }) => {
    activeWorkers += 1;
    processUpload(_id)
      .catch((err) => {
        console.error("[ERROR] processUpload:", err);
      })
      .finally(() => {
        activeWorkers = Math.max(0, activeWorkers - 1);
        setImmediate(() => {
          kickUploadProcessor().catch((err) => console.error("[ERROR] queue restart:", err));
        });
      });
  });
}

function startUploadQueueProcessor() {
  if (processorStarted) return;
  processorStarted = true;
  processorTimer = setInterval(() => {
    kickUploadProcessor().catch((err) => console.error("[ERROR] queue poll:", err));
  }, POLL_INTERVAL_MS);

  if (processorTimer.unref) {
    processorTimer.unref();
  }

  kickUploadProcessor().catch((err) => console.error("[ERROR] initial queue poll:", err));
}

module.exports = {
  hashValue,
  kickUploadProcessor,
  startUploadQueueProcessor
};
