const path = require("path");
const pdfParse = require("pdf-parse");
const uploadService = require("../services/uploadService");
const eventEmitter = require("../services/eventEmitter");
const { getOrSetCache, deleteCacheByPrefix } = require("../services/cacheService");
const { hashValue } = require("../services/uploadQueueService");
const { toObjectId } = require("../services/securityUtils");
const { asyncHandler, AppError } = require("../middleware/errorMiddleware");
const {
  compareTheses,
  findResearchGaps,
  prepareDefense,
  validateThesisText
} = require("../services/geminiService");

function isPdfBuffer(fileBuffer) {
  return fileBuffer.slice(0, 5).toString("utf8") === "%PDF-";
}

function normalizeOptions(body = {}) {
  return {
    length: body.length || "medium",
    style: body.style || "academic",
    format: body.format || "paragraph",
    focusArea: body.focusArea || "",
    includeBreakdown: body.includeBreakdown !== false && body.includeBreakdown !== "false",
    breakdownFormat: body.breakdownFormat || "cards",
    includeKeywords: body.includeKeywords === true || body.includeKeywords === "true",
    includeHighlights: body.includeHighlights === true || body.includeHighlights === "true",
    includeCitations: body.includeCitations === true || body.includeCitations === "true"
  };
}

function buildUploadPayload(upload) {
  return {
    id: upload._id,
    summary: upload.summary || "",
    keywords: upload.keywords || [],
    highlights: upload.highlights || [],
    citations: upload.citations || [],
    thesisBreakdown: upload.thesisBreakdown || null,
    sourceExcerpt: upload.sourceExcerpt || "",
    summaryOptions: upload.summaryOptions || null,
    originalname: upload.originalname || "",
    processingStatus: upload.processingStatus,
    processingError: upload.processingError || null
  };
}

function buildProcessingSignatureInput(options = {}) {
  return {
    length: options.length || "medium",
    style: options.style || "academic",
    format: options.format || "paragraph",
    focusArea: options.focusArea || "",
    includeKeywords: Boolean(options.includeKeywords),
    includeHighlights: Boolean(options.includeHighlights),
    includeCitations: Boolean(options.includeCitations)
  };
}

function parseSelectionIds(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

async function loadSelectedUploads(userId, ids, minimumCount = 1) {
  const uniqueIds = [...new Set(parseSelectionIds(ids))];
  if (uniqueIds.length < minimumCount) {
    return { error: `Please select at least ${minimumCount} thesis summaries.` };
  }

  const objectIds = uniqueIds.map(toObjectId);
  if (objectIds.some((id) => !id)) {
    return { error: "One or more selected summaries could not be found." };
  }

  const Upload = require("../models/Upload");
  const uploads = await Upload.find({
    _id: { $in: objectIds },
    user: userId,
    archived: { $ne: true },
    processingStatus: "completed"
  }).lean();

  if (uploads.length !== uniqueIds.length) {
    return { error: "One or more selected summaries could not be found." };
  }

  return { uploads };
}

exports.checkDuplicate = asyncHandler(async (req, res) => {
  if (!req.session?.user) {
    throw new AppError("Unauthorized", 401);
  }

  const fileHash = String(req.body.fileHash || "").trim();
  const options = normalizeOptions(req.body.options || {});

  if (!fileHash) {
    throw new AppError("Missing file fingerprint", 400);
  }

  const optionSignature = hashValue(JSON.stringify(buildProcessingSignatureInput(options)));
  const existingUpload = await uploadService.checkDuplicateUpload(req.session.user.id, fileHash, optionSignature);

  if (!existingUpload) {
    return res.json({ duplicate: false });
  }

  return res.json({
    duplicate: true,
    message: "You already summarized this thesis with the same options.",
    existingUpload: buildUploadPayload(existingUpload)
  });
});

exports.parsePDF = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError("No file uploaded", 400);
  if (!req.session?.user) throw new AppError("Unauthorized", 401);

  const { id: userId } = req.session.user;
  const { filename, originalname, path: filePath } = req.file;
  const options = normalizeOptions(req.body);

  const fs = require("fs");
  const fileBuffer = await fs.promises.readFile(filePath);
  if (!isPdfBuffer(fileBuffer)) {
    await uploadService.removeFileIfExists(filePath);
    throw new AppError("Only valid PDF files are allowed.", 400);
  }

  const fileHash = hashValue(fileBuffer);
  const optionSignature = hashValue(JSON.stringify(buildProcessingSignatureInput(options)));

  const existingUpload = await uploadService.checkDuplicateUpload(userId, fileHash, optionSignature);
  if (existingUpload) {
    await uploadService.removeFileIfExists(filePath);
    return res.status(409).json({
      duplicate: true,
      message: "This thesis was already summarized with the same options.",
      existingUpload: buildUploadPayload(existingUpload)
    });
  }

  const pdfData = await pdfParse(fileBuffer);
  const cleanText = (pdfData.text || "").replace(/\s+/g, " ").trim();
  const limitedText = cleanText.slice(0, 12000);

  if (!limitedText) {
    await uploadService.removeFileIfExists(filePath);
    throw new AppError("The PDF content could not be read.", 400);
  }

  const sourceHash = hashValue(limitedText);
  const existingSourceMatch = await uploadService.checkDuplicateSourceExcerpt(userId, sourceHash, optionSignature);

  if (existingSourceMatch) {
    await uploadService.removeFileIfExists(filePath);
    return res.status(409).json({
      duplicate: true,
      message: "This thesis was already summarized with the same options.",
      existingUpload: buildUploadPayload(existingSourceMatch)
    });
  }

  const thesisCheck = await validateThesisText(limitedText);
  if (!thesisCheck?.isThesis) {
    await uploadService.removeFileIfExists(filePath);
    throw new AppError(thesisCheck?.reason || "This PDF is not a valid thesis document.", 400);
  }

  const queuedUpload = await uploadService.createQueuedUpload({
    userId,
    filename,
    originalname,
    fileHash,
    sourceHash,
    sourceExcerpt: limitedText,
    optionSignature,
    summaryOptions: options
  });

  deleteCacheByPrefix(`uploads:user:${userId}:`);
  deleteCacheByPrefix(`account:stats:${userId}`);

  // Decoupled event emission
  eventEmitter.emit("upload:queued", queuedUpload._id.toString());

  res.status(202).json({
    queued: true,
    uploadId: queuedUpload._id,
    message: "Upload received. Your thesis is queued for processing.",
    status: queuedUpload.processingStatus
  });
});

exports.getUploadStatus = asyncHandler(async (req, res) => {
  if (!req.session?.user) throw new AppError("Unauthorized", 401);

  const upload = await uploadService.findUploadById(req.params.id, req.session.user.id);
  if (!upload) {
    throw new AppError("Upload not found", 404);
  }

  let duplicateUpload = null;
  if (upload.processingStatus === "duplicate" && upload.duplicateOf) {
    duplicateUpload = await uploadService.findUploadById(upload.duplicateOf);
  }

  res.json({
    id: upload._id,
    status: upload.processingStatus,
    queued: upload.processingStatus === "queued",
    processing: upload.processingStatus === "processing",
    complete: upload.processingStatus === "completed",
    failed: upload.processingStatus === "failed",
    duplicate: upload.processingStatus === "duplicate",
    message:
      upload.processingStatus === "queued"
        ? "Your thesis is waiting in the processing queue."
        : upload.processingStatus === "processing"
          ? "Your thesis is being analyzed. This may take a while on large documents."
          : upload.processingStatus === "failed"
            ? upload.processingError || "Processing failed."
            : upload.processingStatus === "duplicate"
              ? "This thesis was already summarized with the same options."
              : "Summary generated successfully.",
    summary: upload.summary || "",
    keywords: upload.keywords || [],
    highlights: upload.highlights || [],
    citations: upload.citations || [],
    thesisBreakdown: upload.thesisBreakdown || null,
    sourceExcerpt: upload.sourceExcerpt || "",
    summaryOptions: upload.summaryOptions || null,
    originalname: upload.originalname || "",
    processingError: upload.processingError || null,
    existingUpload: duplicateUpload ? buildUploadPayload(duplicateUpload) : null
  });
});

exports.getAllUploads = asyncHandler(async (req, res) => {
  if (!req.session?.user) throw new AppError("Unauthorized", 401);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const cacheKey = `uploads:user:${req.session.user.id}:limit:${limit}`;
  const uploads = await getOrSetCache(cacheKey, 30 * 1000, async () => {
    return uploadService.getUserUploads(req.session.user.id, limit);
  });
  res.json(uploads);
});

exports.getArchivedUploads = asyncHandler(async (req, res) => {
  if (!req.session?.user) throw new AppError("Unauthorized", 401);
  const uploads = await uploadService.getArchivedUploads(req.session.user.id);
  res.json(uploads);
});

exports.restoreUpload = asyncHandler(async (req, res) => {
  if (!req.session?.user) throw new AppError("Unauthorized", 401);

  await uploadService.restoreUpload(req.params.id, req.session.user.id);

  deleteCacheByPrefix(`uploads:user:${req.session.user.id}:`);
  deleteCacheByPrefix(`account:stats:${req.session.user.id}`);

  res.json({ success: true, message: "Summary restored to your history." });
});

exports.permanentlyDeleteArchivedUpload = asyncHandler(async (req, res) => {
  if (!req.session?.user) throw new AppError("Unauthorized", 401);

  await uploadService.permanentlyDeleteUpload(req.params.id, req.session.user.id);

  deleteCacheByPrefix(`uploads:user:${req.session.user.id}:`);
  deleteCacheByPrefix(`account:stats:${req.session.user.id}`);

  res.json({ success: true, message: "Archived summary deleted permanently." });
});

exports.deletePDF = asyncHandler(async (req, res) => {
  if (!req.session?.user) throw new AppError("Unauthorized", 401);

  const { id: userId } = req.session.user;
  const filename = req.params.filename;
  const upload = await uploadService.findUploadByFilename(filename, userId);

  if (!upload) {
    throw new AppError("Upload not found", 404);
  }

  await uploadService.archiveUpload(upload._id, userId);

  deleteCacheByPrefix(`uploads:user:${userId}:`);
  deleteCacheByPrefix(`account:stats:${userId}`);

  res.json({ success: true });
});

exports.compareUploads = asyncHandler(async (req, res) => {
  if (!req.session?.user) throw new AppError("Unauthorized", 401);

  const { uploads, error } = await loadSelectedUploads(req.session.user.id, req.body.uploadIds, 2);
  if (error) {
    throw new AppError(error, 400);
  }

  const result = await compareTheses(uploads, String(req.body.focus || "").trim());
  res.json(result);
});

exports.findResearchGaps = asyncHandler(async (req, res) => {
  if (!req.session?.user) throw new AppError("Unauthorized", 401);

  const { uploads, error } = await loadSelectedUploads(req.session.user.id, req.body.uploadIds, 2);
  if (error) {
    throw new AppError(error, 400);
  }

  const result = await findResearchGaps(uploads, String(req.body.focus || "").trim());
  res.json(result);
});

exports.prepareDefenseBrief = asyncHandler(async (req, res) => {
  if (!req.session?.user) throw new AppError("Unauthorized", 401);

  const { uploads, error } = await loadSelectedUploads(req.session.user.id, [req.body.uploadId], 1);
  if (error) {
    throw new AppError("Please select one thesis summary.", 400);
  }

  const result = await prepareDefense(uploads[0], String(req.body.emphasis || "").trim());
  res.json(result);
});
