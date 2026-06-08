// services/eventListeners.js
const eventEmitter = require("./eventEmitter");
const { saveUser, saveUpload } = require("../config/firestore");

function initEventListeners() {
  // Listener for user registration
  eventEmitter.on("user:registered", async (user) => {
    try {
      console.log(`[EVENT] user:registered event received for ${user.email}`);
      await saveUser({
        id: user._id,
        username: user.username,
        isAdmin: user.isAdmin
      });
    } catch (err) {
      console.error("[ERROR] Failed to save registered user to Firestore asynchronously:", err);
    }
  });

  // Listener for upload completion
  eventEmitter.on("upload:completed", async (upload) => {
    try {
      console.log(`[EVENT] upload:completed event received for ${upload.originalname}`);
      await saveUpload({
        uploadId: upload._id.toString(),
        userId: upload.user.toString(),
        originalname: upload.originalname,
        processingStatus: upload.processingStatus,
        completedAt: upload.completedAt
      });
    } catch (err) {
      console.error("[ERROR] Failed to save completed upload to Firestore asynchronously:", err);
    }
  });

  // Listener for upload queue triggers
  eventEmitter.on("upload:queued", (uploadId) => {
    console.log(`[EVENT] upload:queued event received for upload ID: ${uploadId}`);
    try {
      const { kickUploadProcessor } = require("./uploadQueueService");
      kickUploadProcessor().catch((err) => {
        console.error("[ERROR] Event-triggered kickUploadProcessor failed:", err);
      });
    } catch (err) {
      console.error("[ERROR] Error importing/kicking upload processor:", err);
    }
  });
}

module.exports = { initEventListeners };
