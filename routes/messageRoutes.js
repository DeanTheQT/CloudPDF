const router = require("express").Router();
const messageController = require("../controllers/messageController");
const { createRateLimiter } = require("../middleware/rateLimit");

const messageLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  maxRequests: 8,
  key: (req) => `${req.session?.user?.id || req.ip}:${req.path}`,
  message: "Too many messages sent. Please wait before sending another one."
});

router.post("/", messageLimiter, messageController.createMessage);
router.get("/inbox", messageController.getInbox);
router.get("/inbox/summary", messageController.getInboxSummary);
router.post("/inbox/:id/read", messageController.markInboxMessageRead);

module.exports = router;
