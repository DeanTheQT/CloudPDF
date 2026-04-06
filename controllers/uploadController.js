const fs = require("fs");
const path = require("path");
const Upload = require("../models/Upload");
const { getOrSetCache, deleteCacheByPrefix } = require("../services/cacheService");
const { hashValue, kickUploadProcessor } = require("../services/uploadQueueService");

const fsPromises = fs.promises;
const uploadsDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

async function removeFileIfExists(filePath) {
  try {
    await fsPromises.unlink(filePath);
  } catch (err) {
    if (err.code !== "ENOENT") {
      throw err;
    }
  }
}

function normalizeOptions(body = {}) {
  return {
    length: body.length || "medium",
    style: body.style || "academic",
    format: body.format || "paragraph",
    focusArea: body.focusArea || "",
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
    originalname: upload.originalname || "",
    processingStatus: upload.processingStatus,
    processingError: upload.processingError || null
  };
}

exports.checkDuplicate = async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const fileHash = String(req.body.fileHash || "").trim();
    const options = normalizeOptions(req.body.options || {});

    if (!fileHash) {
      return res.status(400).json({ message: "Missing file fingerprint" });
    }

    const optionSignature = hashValue(JSON.stringify(options));
    const existingUpload = await Upload.findOne({
      user: req.session.user.id,
      fileHash,
      optionSignature,
      processingStatus: "completed",
      archived: { $ne: true }
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!existingUpload) {
      return res.json({ duplicate: false });
    }

    return res.json({
      duplicate: true,
      message: "You already summarized this thesis with the same options.",
      existingUpload: buildUploadPayload(existingUpload)
    });
  } catch (err) {
    console.error("[ERROR] checkDuplicate:", err);
    res.status(500).json({ message: "Could not check for duplicates" });
  }
};

exports.parsePDF = async (req, res) => {
  try {
    if (!req.file) return res.status(400).send("No file uploaded");
    if (!req.session?.user) return res.status(401).send("Unauthorized");

    const { id: userId } = req.session.user;
    const { filename, originalname, path: filePath } = req.file;
    const options = normalizeOptions(req.body);

    const fileBuffer = await fsPromises.readFile(filePath);
    const fileHash = hashValue(fileBuffer);
    const optionSignature = hashValue(JSON.stringify(options));

    const existingUpload = await Upload.findOne({
      user: userId,
      fileHash,
      optionSignature,
      processingStatus: "completed",
      archived: { $ne: true }
    })
      .sort({ createdAt: -1 })
      .lean();

    if (existingUpload) {
      await removeFileIfExists(filePath);
      return res.status(409).json({
        duplicate: true,
        message: "This thesis was already summarized with the same options.",
        existingUpload: buildUploadPayload(existingUpload)
      });
    }

    const queuedUpload = await Upload.create({
      user: userId,
      filename,
      originalname,
      fileHash,
      optionSignature,
      summaryOptions: options,
      processingStatus: "queued",
      archived: false
    });

    deleteCacheByPrefix(`uploads:user:${userId}:`);
    deleteCacheByPrefix(`account:stats:${userId}`);
    kickUploadProcessor().catch((err) => console.error("[ERROR] queue kick:", err));

    res.status(202).json({
      queued: true,
      uploadId: queuedUpload._id,
      message: "Upload received. Your thesis is queued for processing.",
      status: queuedUpload.processingStatus
    });
  } catch (err) {
    console.error("[ERROR] parsePDF failed:", err);
    res.status(500).send("Internal Server Error during PDF upload");
  }
};

exports.getUploadStatus = async (req, res) => {
  try {
    if (!req.session?.user) return res.status(401).json({ message: "Unauthorized" });

    const upload = await Upload.findOne({
      _id: req.params.id,
      user: req.session.user.id
    }).lean();

    if (!upload) {
      return res.status(404).json({ message: "Upload not found" });
    }

    let duplicateUpload = null;
    if (upload.processingStatus === "duplicate" && upload.duplicateOf) {
      duplicateUpload = await Upload.findById(upload.duplicateOf).lean();
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
      originalname: upload.originalname || "",
      processingError: upload.processingError || null,
      existingUpload: duplicateUpload ? buildUploadPayload(duplicateUpload) : null
    });
  } catch (err) {
    console.error("[ERROR] getUploadStatus:", err);
    res.status(500).json({ message: "Failed to get upload status" });
  }
};

exports.getAllUploads = async (req, res) => {
  try {
    if (!req.session?.user) return res.status(401).send("Unauthorized");
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const cacheKey = `uploads:user:${req.session.user.id}:limit:${limit}`;
    const uploads = await getOrSetCache(cacheKey, 30 * 1000, async () => {
      return Upload.find({
        user: req.session.user.id,
        archived: { $ne: true },
        processingStatus: "completed"
      })
        .sort({ _id: -1 })
        .limit(limit)
        .lean();
    });
    res.json(uploads);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading uploads");
  }
};

exports.getArchivedUploads = async (req, res) => {
  try {
    if (!req.session?.user) return res.status(401).json({ message: "Unauthorized" });

    const uploads = await Upload.find({
      user: req.session.user.id,
      archived: true,
      processingStatus: "completed"
    })
      .sort({ archivedAt: -1, createdAt: -1 })
      .limit(50)
      .lean();

    res.json(uploads);
  } catch (err) {
    console.error("[ERROR] getArchivedUploads:", err);
    res.status(500).json({ message: "Failed to load archived uploads" });
  }
};

exports.restoreUpload = async (req, res) => {
  try {
    if (!req.session?.user) return res.status(401).json({ message: "Unauthorized" });

    const upload = await Upload.findOne({
      _id: req.params.id,
      user: req.session.user.id,
      archived: true
    });

    if (!upload) {
      return res.status(404).json({ message: "Archived summary not found" });
    }

    upload.archived = false;
    upload.archivedAt = null;
    await upload.save();

    deleteCacheByPrefix(`uploads:user:${req.session.user.id}:`);
    deleteCacheByPrefix(`account:stats:${req.session.user.id}`);

    res.json({ success: true, message: "Summary restored to your history." });
  } catch (err) {
    console.error("[ERROR] restoreUpload:", err);
    res.status(500).json({ message: "Failed to restore summary" });
  }
};

exports.deletePDF = async (req, res) => {
  try {
    if (!req.session?.user) return res.status(401).send("Unauthorized");

    const { id: userId } = req.session.user;
    const filename = req.params.filename;
    const filePath = path.join(uploadsDir, filename);

    await removeFileIfExists(filePath);

    await Upload.updateOne(
      { user: userId, filename, archived: { $ne: true } },
      { archived: true, archivedAt: new Date() }
    );
    deleteCacheByPrefix(`uploads:user:${userId}:`);
    deleteCacheByPrefix(`account:stats:${userId}`);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).send("Delete failed");
  }
};
