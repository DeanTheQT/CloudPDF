const bcrypt = require("bcrypt");
const userService = require("../services/userService");
const eventEmitter = require("../services/eventEmitter");
const { logEvent } = require("../services/logService");
const { getOrSetCache, deleteCacheByPrefix } = require("../services/cacheService");
const { sendOtpEmail } = require("../services/emailService");
const { toObjectId } = require("../services/securityUtils");
const { asyncHandler, AppError } = require("../middleware/errorMiddleware");
const {
  EMAIL_REGEX,
  OTP_RESEND_COOLDOWN_MS,
  OTP_MAX_VERIFY_ATTEMPTS,
  OTP_EXPIRATION_MS
} = require("../config/constants");

// =========================
// REGISTER 
// =========================
exports.register = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;
  const normalizedEmail = (email || "").trim().toLowerCase();

  if (!password || !normalizedEmail) {
    throw new AppError("Missing fields", 400);
  }

  if (!EMAIL_REGEX.test(normalizedEmail)) {
    throw new AppError("Use a valid email address", 400);
  }

  const existingEmail = await userService.findUserByEmail(normalizedEmail);
  if (existingEmail) {
    throw new AppError("Email already exists", 400);
  }

  const otpCode = userService.createOtp();
  const pendingUser = {
    username: normalizedEmail,
    email: normalizedEmail,
    password
  };

  await sendOtpEmail({
    email: normalizedEmail,
    otp: otpCode,
    username: normalizedEmail
  });

  req.session.pendingRegistration = {
    ...pendingUser,
    otpCode,
    otpExpiresAt: Date.now() + OTP_EXPIRATION_MS,
    otpAttempts: 0,
    otpLastSentAt: Date.now()
  };

  req.session.save(err => {
    if (err) return next(new AppError("Session error", 500));
    res.json({
      success: true,
      requiresOtp: true,
      message: "OTP sent to your email address",
      expiresInSeconds: Math.round(OTP_EXPIRATION_MS / 1000)
    });
  });
});

exports.verifyOtp = asyncHandler(async (req, res, next) => {
  const { otp } = req.body;
  const pending = req.session.pendingRegistration;

  if (!pending) {
    throw new AppError("No pending registration found", 400);
  }

  if ((pending.otpAttempts || 0) >= OTP_MAX_VERIFY_ATTEMPTS) {
    delete req.session.pendingRegistration;
    throw new AppError("Too many incorrect OTP attempts. Please register again.", 429);
  }

  if (!otp || otp.trim() !== pending.otpCode) {
    pending.otpAttempts = (pending.otpAttempts || 0) + 1;
    req.session.pendingRegistration = pending;
    throw new AppError("Invalid OTP", 400);
  }

  if (Date.now() > pending.otpExpiresAt) {
    delete req.session.pendingRegistration;
    throw new AppError("OTP expired. Please register again.", 400);
  }

  const existingEmail = await userService.findUserByEmail(pending.email);
  if (existingEmail) {
    delete req.session.pendingRegistration;
    throw new AppError("Email already exists", 400);
  }

  // Use service layer to create user
  const user = await userService.createUser(pending.username, pending.email, pending.password);

  // Emit event to decouple Firestore mirror writing (asynchronously)
  eventEmitter.emit("user:registered", user);

  req.session.regenerate(err => {
    if (err) return next(new AppError("Session error", 500));
    req.session.user = {
      id: user._id.toString(),
      email: user.email,
      isAdmin: user.isAdmin || false
    };

    logEvent(req, "user_registered", {
      registeredUserId: user._id.toString(),
      email: user.email
    });

    req.session.save(saveErr => {
      if (saveErr) return next(new AppError("Session error", 500));
      res.json({ success: true, redirect: "/index.html" });
    });
  });
});

exports.resendRegistrationOtp = asyncHandler(async (req, res, next) => {
  const pending = req.session.pendingRegistration;
  if (!pending?.email) {
    throw new AppError("No pending registration found", 400);
  }

  if (pending.otpLastSentAt && Date.now() - pending.otpLastSentAt < OTP_RESEND_COOLDOWN_MS) {
    const remainingSeconds = Math.ceil((OTP_RESEND_COOLDOWN_MS - (Date.now() - pending.otpLastSentAt)) / 1000);
    throw new AppError(`Please wait ${remainingSeconds} seconds before requesting another OTP.`, 429);
  }

  const otpCode = userService.createOtp();
  pending.otpCode = otpCode;
  pending.otpExpiresAt = Date.now() + OTP_EXPIRATION_MS;
  pending.otpAttempts = 0;
  pending.otpLastSentAt = Date.now();

  await sendOtpEmail({
    email: pending.email,
    otp: otpCode,
    username: pending.email
  });

  req.session.pendingRegistration = pending;
  req.session.save((err) => {
    if (err) return next(new AppError("Session error", 500));
    res.json({
      success: true,
      message: "A new OTP has been sent to your email.",
      expiresInSeconds: Math.round(OTP_EXPIRATION_MS / 1000)
    });
  });
});

// =========================
// LOGIN
// =========================
exports.login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;
  const normalizedEmail = (email || "").trim().toLowerCase();
  const user = await userService.findUserByEmail(normalizedEmail);

  if (!user) throw new AppError("Invalid email or password", 400);

  const match = await bcrypt.compare(password, user.password);
  if (!match) throw new AppError("Invalid email or password", 400);

  req.session.regenerate(err => {
    if (err) return next(new AppError("Session error", 500));
    req.session.user = {
      id: user._id.toString(),
      email: user.email,
      isAdmin: user.isAdmin || false
    };
    req.session.save(saveErr => {
      if (saveErr) return next(new AppError("Session error", 500));
      res.json({ redirect: user.isAdmin ? "admin.html" : "index.html" });
    });
  });
});

exports.getSession = (req, res) => {
  if (!req.session.user) return res.status(401).json({ loggedIn: false });
  res.json({ loggedIn: true, user: req.session.user });
};

exports.getDashboardStats = asyncHandler(async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser?.id) {
    throw new AppError("Not logged in", 401);
  }

  const cacheKey = `account:stats:${sessionUser.id}`;
  const stats = await getOrSetCache(cacheKey, 30 * 1000, async () => {
    const Upload = require("../models/Upload");
    const Message = require("../models/Message");

    const [uploadCount, messageCount, latestUpload] = await Promise.all([
      Upload.countDocuments({ user: sessionUser.id, archived: { $ne: true } }),
      Message.countDocuments({ user: sessionUser.id, archived: { $ne: true } }),
      Upload.findOne({ user: sessionUser.id, archived: { $ne: true } }).sort({ createdAt: -1 }).select("createdAt originalname").lean()
    ]);

    return {
      uploadCount,
      messageCount,
      latestUploadName: latestUpload?.originalname || null,
      latestUploadAt: latestUpload?.createdAt || null,
      memberSince: toObjectId(sessionUser.id)?.getTimestamp() || null
    };
  });

  res.json(stats);
});

exports.logout = (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ message: "Logout failed" });
    res.clearCookie('cloudpdf_session');
    res.json({ message: "Logged out" });
  });
};

exports.changePassword = asyncHandler(async (req, res) => {
  if (!req.session.user) throw new AppError("Not logged in", 401);
  const { currentPassword, newPassword } = req.body;

  await userService.changeUserPassword(req.session.user.id, currentPassword, newPassword);
  res.json({ success: true, message: "Password updated" });
});

exports.requestPasswordReset = asyncHandler(async (req, res) => {
  const result = await userService.requestPasswordReset(req.body.email);
  res.json({
    ...result,
    expiresInSeconds: Math.round(OTP_EXPIRATION_MS / 1000)
  });
});

exports.resetPasswordWithOtp = asyncHandler(async (req, res, next) => {
  const { email, otp, newPassword } = req.body;
  const user = await userService.resetPassword(email, otp, newPassword);

  req.session.regenerate((err) => {
    if (err) return next(new AppError("Session error", 500));
    req.session.user = {
      id: user._id.toString(),
      email: user.email,
      isAdmin: user.isAdmin || false
    };
    req.session.save((saveErr) => {
      if (saveErr) return next(new AppError("Session error", 500));
      res.json({
        success: true,
        message: "Password reset successful. Redirecting...",
        redirect: user.isAdmin ? "admin.html" : "index.html"
      });
    });
  });
});

exports.selfDestruct = asyncHandler(async (req, res, next) => {
  const sessionUser = req.session?.user;
  const userId = sessionUser?.id;

  if (!userId) {
    throw new AppError("No active session. Please log in again.", 401);
  }

  await userService.selfDestructAccount(userId);
  deleteCacheByPrefix(`account:stats:${userId}`);
  deleteCacheByPrefix(`uploads:user:${userId}:`);

  req.session.destroy((err) => {
    if (err) {
      return next(new AppError("Could not log out.", 500));
    }

    res.clearCookie("cloudpdf_session");
    logEvent({ method: req.method, originalUrl: req.originalUrl, session: { user: sessionUser } }, "account_deleted", { deletedUserId: userId });
    return res.json({ success: true, message: "Account deleted." });
  });
});
