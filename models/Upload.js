const mongoose = require("mongoose");

const uploadSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true 
  },
  filename: { 
    type: String, 
    required: true 
  },
  originalname: { 
    type: String 
  },
  summary: { 
    type: String 
  },
  sourceHash: {
    type: String,
    index: true
  },
  fileHash: {
    type: String,
    index: true
  },
  optionSignature: {
    type: String,
    index: true
  },
  summaryOptions: {
    length: { type: String, default: "medium" },
    style: { type: String, default: "academic" },
    format: { type: String, default: "paragraph" },
    focusArea: { type: String, default: "" },
    includeKeywords: { type: Boolean, default: false },
    includeHighlights: { type: Boolean, default: false },
    includeCitations: { type: Boolean, default: false }
  },
  // --- NEW: Add this to store the AI-extracted keywords ---
  keywords: { 
    type: [String], 
    default: [] 
  },
  highlights: {
    type: [String],
    default: []
  },
  citations: {
    type: [String],
    default: []
  },
  archived: {
    type: Boolean,
    default: false
  },
  archivedAt: {
    type: Date,
    default: null
  },
  processingStatus: {
    type: String,
    enum: ["queued", "processing", "completed", "failed", "duplicate"],
    default: "queued",
    index: true
  },
  processingError: {
    type: String,
    default: null
  },
  duplicateOf: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Upload",
    default: null
  },
  thesisValidatedAt: {
    type: Date,
    default: null
  },
  processingStartedAt: {
    type: Date,
    default: null
  },
  completedAt: {
    type: Date,
    default: null
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
}, { collection: "Uploads" });

module.exports = mongoose.model("Upload", uploadSchema);
