const router = require("express").Router();
const auth = require("../controllers/authController");
const { createRateLimiter } = require("../middleware/rateLimit");

const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 20,
  key: (req) => `${req.ip}:${req.path}`,
  message: "Too many auth requests. Please wait a bit and try again."
});

router.post("/register", authLimiter, auth.register);
router.post("/verify-otp", authLimiter, auth.verifyOtp);
router.post("/resend-otp", authLimiter, auth.resendRegistrationOtp);
router.post("/forgot-password", authLimiter, auth.requestPasswordReset);
router.post("/reset-password", authLimiter, auth.resetPasswordWithOtp);
router.post("/login", authLimiter, auth.login);
router.get("/session", auth.getSession);
router.get("/dashboard-stats", auth.getDashboardStats);
router.get("/logout", auth.logout);
router.post("/change-password", authLimiter, auth.changePassword);
router.post("/terminate", authLimiter, auth.selfDestruct);

module.exports = router;
