const express = require('express');
const multer = require('multer');
const uploadController = require('../controllers/uploadController');
const { createRateLimiter } = require("../middleware/rateLimit");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF files are allowed"));
    }

    cb(null, true);
  }
});
const uploadPdf = (req, res, next) => {
  upload.single("pdf")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || "Invalid upload" });
    }

    next();
  });
};
const uploadLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 12,
  key: (req) => `${req.session?.user?.id || req.ip}:${req.path}`,
  message: "Too many uploads right now. Please wait and try again."
});

// Upload PDF
router.post('/upload/precheck', uploadLimiter, uploadController.checkDuplicate);
router.post('/upload', requireAuth, uploadLimiter, uploadPdf, uploadController.parsePDF);
router.get('/upload/status/:id', uploadController.getUploadStatus);
router.post('/analysis/compare', uploadController.compareUploads);
router.post('/analysis/gaps', uploadController.findResearchGaps);
router.post('/analysis/defense', uploadController.prepareDefenseBrief);
router.get('/uploads/archived', uploadController.getArchivedUploads);
router.post('/upload/:id/restore', uploadController.restoreUpload);
router.delete('/upload/:id/permanent', uploadController.permanentlyDeleteArchivedUpload);

// Delete PDF & summary
router.delete('/upload/:filename', uploadController.deletePDF);

// Get all saved summaries
router.get('/uploads', uploadController.getAllUploads);

module.exports = router;
