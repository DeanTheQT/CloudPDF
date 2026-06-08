const mongoose = require("mongoose");

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function limitText(value = "", maxLength = 200) {
  return String(value || "").trim().slice(0, maxLength);
}

function toObjectId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return null;
  }

  return new mongoose.Types.ObjectId(id);
}

module.exports = {
  escapeRegex,
  limitText,
  toObjectId
};
