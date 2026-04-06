const mongoose = require("mongoose");

const logSchema = new mongoose.Schema(
  {
    level: {
      type: String,
      default: "info"
    },
    action: {
      type: String,
      required: true,
      trim: true
    },
    method: {
      type: String,
      trim: true
    },
    path: {
      type: String,
      trim: true
    },
    statusCode: {
      type: Number
    },
    durationMs: {
      type: Number
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    username: {
      type: String,
      trim: true
    },
    meta: {
      type: mongoose.Schema.Types.Mixed
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  { collection: "Logs" }
);

module.exports = mongoose.model("Log", logSchema);
