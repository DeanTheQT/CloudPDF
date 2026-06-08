// services/userService.js
const User = require("../models/User");
const Upload = require("../models/Upload");
const Message = require("../models/Message");
const bcrypt = require("bcrypt");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { AppError } = require("../middleware/errorMiddleware");
const { toObjectId } = require("./securityUtils");
const eventEmitter = require("./eventEmitter");
const { sendOtpEmail, sendPasswordResetEmail } = require("./emailService");
const {
  OTP_RESEND_COOLDOWN_MS,
  OTP_MAX_VERIFY_ATTEMPTS,
  OTP_EXPIRATION_MS,
  EMAIL_REGEX
} = require("../config/constants");

const createOtp = () => String(crypto.randomInt(100000, 1000000));

async function findUserByEmail(email) {
  return User.findOne({ email: email.trim().toLowerCase(), archived: { $ne: true } });
}

async function findUserById(id) {
  const objectId = toObjectId(id);
  if (!objectId) throw new AppError("Invalid user ID", 400);
  return User.findOne({ _id: objectId, archived: { $ne: true } });
}

async function getUsersList({ page, limit, skip, search, role }) {
  const filter = { archived: { $ne: true } };
  if (search) {
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { email: { $regex: escapedSearch, $options: "i" } },
      { username: { $regex: escapedSearch, $options: "i" } }
    ];
  }
  if (role === "admin") filter.isAdmin = true;
  if (role === "user") filter.isAdmin = false;

  const [items, total] = await Promise.all([
    User.find(filter)
      .select("-password -otpCode -otpExpiresAt")
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter)
  ]);

  return { items, total };
}

async function toggleAdminRole(targetUserId, currentSessionUserId) {
  const objectId = toObjectId(targetUserId);
  if (!objectId) throw new AppError("Invalid user ID", 400);

  if (targetUserId === currentSessionUserId) {
    throw new AppError("You cannot remove admin access from your own session", 400);
  }

  const user = await User.findById(objectId);
  if (!user || user.archived) throw new AppError("User not found", 404);

  if (user.isAdmin) {
    const activeAdminCount = await User.countDocuments({ isAdmin: true, archived: { $ne: true } });
    if (activeAdminCount <= 1) {
      throw new AppError("At least one active admin is required", 400);
    }
  }

  user.isAdmin = !user.isAdmin;
  await user.save();
  return user;
}

async function deleteUserAccount(userId, currentSessionUserId) {
  const objectId = toObjectId(userId);
  if (!objectId) throw new AppError("Invalid user ID", 400);
  if (userId === currentSessionUserId) {
    throw new AppError("You cannot archive your own account while signed in", 400);
  }

  const targetUser = await User.findById(objectId).select("isAdmin archived");
  if (!targetUser || targetUser.archived) throw new AppError("User not found", 404);

  if (targetUser.isAdmin) {
    const activeAdminCount = await User.countDocuments({ isAdmin: true, archived: { $ne: true } });
    if (activeAdminCount <= 1) {
      throw new AppError("At least one active admin is required", 400);
    }
  }

  // Delete files from disk
  const uploads = await Upload.find({ user: userId, archived: { $ne: true } }).select("filename");
  for (const upload of uploads) {
    const filePath = path.join(__dirname, "../uploads", upload.filename);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error(`[ERROR] Failed to delete file ${filePath}:`, err);
      }
    }
  }

  // Use Promise.allSettled to update state concurrently as suggested by the code review
  const results = await Promise.allSettled([
    Upload.updateMany({ user: userId, archived: { $ne: true } }, { archived: true, archivedAt: new Date() }),
    Message.updateMany({ user: userId, archived: { $ne: true } }, { archived: true, archivedAt: new Date() }),
    User.findByIdAndUpdate(userId, { archived: true, archivedAt: new Date() })
  ]);

  // Log failures if any
  results.forEach((res, i) => {
    if (res.status === "rejected") {
      console.error(`[ERROR] Batch user deletion task ${i} failed:`, res.reason);
    }
  });

  return targetUser;
}

async function selfDestructAccount(userId) {
  const objectId = toObjectId(userId);
  if (!objectId) throw new AppError("Invalid user ID", 400);

  const userUploads = await Upload.find({ user: userId, archived: { $ne: true } }).select("filename");
  for (const upload of userUploads) {
    const filePath = path.join(__dirname, "../uploads", upload.filename);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error(`[ERROR] Failed to unlink file during self-destruct ${filePath}:`, err);
      }
    }
  }

  // Concurrently run operations using Promise.allSettled
  const results = await Promise.allSettled([
    Upload.updateMany({ user: userId, archived: { $ne: true } }, { archived: true, archivedAt: new Date() }),
    Message.updateMany({ user: userId, archived: { $ne: true } }, { archived: true, archivedAt: new Date() }),
    User.findByIdAndUpdate(userId, { archived: true, archivedAt: new Date() })
  ]);

  results.forEach((res, i) => {
    if (res.status === "rejected") {
      console.error(`[ERROR] Self destruct task ${i} failed:`, res.reason);
    }
  });
}

async function changeUserPassword(userId, currentPassword, newPassword) {
  if (!newPassword || newPassword.length < 8) {
    throw new AppError("Password must be at least 8 characters long", 400);
  }

  const user = await findUserById(userId);
  if (!user) throw new AppError("User not found", 404);

  const match = await bcrypt.compare(currentPassword, user.password);
  if (!match) throw new AppError("Current password incorrect", 400);

  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();
}

async function requestPasswordReset(email) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!EMAIL_REGEX.test(normalizedEmail)) {
    throw new AppError("Use a valid email address", 400);
  }

  const user = await User.findOne({ email: normalizedEmail, archived: { $ne: true } });
  if (!user) {
    // Return standard message to avoid user enumeration
    return { success: true };
  }

  const otpCode = createOtp();
  user.otpCode = otpCode;
  user.otpExpiresAt = new Date(Date.now() + OTP_EXPIRATION_MS);
  user.otpAttempts = 0;
  user.otpLastSentAt = new Date();
  await user.save();

  await sendPasswordResetEmail({ email: user.email, otp: otpCode });
  return { success: true };
}

async function resetPassword(email, otp, newPassword) {
  const normalizedEmail = email.trim().toLowerCase();
  const cleanedOtp = String(otp || "").trim();

  if (!EMAIL_REGEX.test(normalizedEmail)) {
    throw new AppError("Use a valid email address", 400);
  }
  if (!cleanedOtp) {
    throw new AppError("OTP is required", 400);
  }
  if (!newPassword || newPassword.length < 8) {
    throw new AppError("Password must be at least 8 characters long", 400);
  }

  const user = await User.findOne({ email: normalizedEmail, archived: { $ne: true } });
  if (!user) {
    throw new AppError("No account found for that email", 404);
  }

  if ((user.otpAttempts || 0) >= OTP_MAX_VERIFY_ATTEMPTS) {
    throw new AppError("Too many incorrect OTP attempts. Request a new reset code.", 429);
  }

  if (!user.otpCode || cleanedOtp !== user.otpCode) {
    user.otpAttempts = (user.otpAttempts || 0) + 1;
    await user.save();
    throw new AppError("Invalid OTP", 400);
  }

  if (!user.otpExpiresAt || Date.now() > new Date(user.otpExpiresAt).getTime()) {
    user.otpCode = null;
    user.otpExpiresAt = null;
    user.otpAttempts = 0;
    await user.save();
    throw new AppError("OTP expired. Request a new reset code.", 400);
  }

  user.password = await bcrypt.hash(newPassword, 10);
  user.otpCode = null;
  user.otpExpiresAt = null;
  user.otpAttempts = 0;
  user.otpLastSentAt = null;
  await user.save();

  return user;
}

async function createUser(username, email, password) {
  const hashedPassword = await bcrypt.hash(password, 10);
  return User.create({
    username,
    email,
    password: hashedPassword,
    emailVerified: true,
    otpCode: null,
    otpExpiresAt: null,
    otpAttempts: 0,
    otpLastSentAt: null
  });
}

async function restoreUserAccount(userId) {
  const objectId = toObjectId(userId);
  if (!objectId) throw new AppError("Invalid user ID", 400);

  const user = await User.findById(objectId);
  if (!user || !user.archived) throw new AppError("Archived user not found", 404);

  user.archived = false;
  user.archivedAt = null;
  await user.save();

  const results = await Promise.allSettled([
    Upload.updateMany({ user: user._id, archived: true }, { archived: false, archivedAt: null }),
    Message.updateMany({ user: user._id, archived: true }, { archived: false, archivedAt: null })
  ]);

  results.forEach((res, i) => {
    if (res.status === "rejected") {
      console.error(`[ERROR] User restoration task ${i} failed:`, res.reason);
    }
  });

  return user;
}

async function permanentlyDeleteUserAccount(userId) {
  const objectId = toObjectId(userId);
  if (!objectId) throw new AppError("Invalid user ID", 400);

  const user = await User.findById(objectId);
  if (!user || !user.archived) throw new AppError("Archived user not found", 404);

  const uploads = await Upload.find({ user: user._id }).select("filename");
  for (const upload of uploads) {
    const filePath = path.join(__dirname, "../uploads", upload.filename);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error(`[ERROR] Failed to unlink file during permanent delete ${filePath}:`, err);
      }
    }
  }

  const results = await Promise.allSettled([
    Upload.deleteMany({ user: user._id }),
    Message.deleteMany({ user: user._id }),
    User.deleteOne({ _id: user._id })
  ]);

  results.forEach((res, i) => {
    if (res.status === "rejected") {
      console.error(`[ERROR] Permanent deletion task ${i} failed:`, res.reason);
    }
  });

  return user;
}

module.exports = {
  findUserByEmail,
  findUserById,
  createUser,
  getUsersList,
  toggleAdminRole,
  deleteUserAccount,
  selfDestructAccount,
  changeUserPassword,
  requestPasswordReset,
  resetPassword,
  createOtp,
  restoreUserAccount,
  permanentlyDeleteUserAccount
};
