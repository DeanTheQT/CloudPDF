const router = require("express").Router();
const admin = require("../middleware/adminMiddleware");
const adminController = require("../controllers/adminController");
const messageController = require("../controllers/messageController");

router.get("/users", admin, adminController.getUsers);
router.delete("/users/:id", admin, adminController.deleteUser);
router.post("/users/:id/restore", admin, adminController.restoreUser);
router.delete("/users/:id/permanent", admin, adminController.permanentlyDeleteArchivedUser);
router.patch("/users/:id/admin", admin, adminController.toggleAdmin);

router.get("/uploads", admin, adminController.getUploads);
router.delete("/uploads/:id", admin, adminController.deleteUpload);
router.post("/uploads/:id/restore", admin, adminController.restoreUpload);
router.delete("/uploads/:id/permanent", admin, adminController.permanentlyDeleteArchivedUpload);
router.get("/logs", admin, adminController.getLogs);
router.get("/analytics", admin, adminController.getAnalytics);
router.get("/archived", admin, adminController.getArchivedOverview);
router.get("/messages", admin, messageController.getMessages);
router.delete("/messages/:id", admin, messageController.deleteMessage);
router.post("/messages/:id/restore", admin, messageController.restoreMessage);
router.delete("/messages/:id/permanent", admin, messageController.permanentlyDeleteArchivedMessage);
router.post("/messages/:id/reply", admin, messageController.replyToMessage);

module.exports = router;
