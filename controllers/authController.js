const User = require("../models/User");
const Upload = require("../models/Upload");
const Message = require("../models/Message");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const { logEvent } = require("../services/logService");
const { sendOtpEmail, sendPasswordResetEmail } = require("../services/emailService");
const { getOrSetCache, deleteCacheByPrefix } = require("../services/cacheService");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const normalizeEmail = (email = "") => email.trim().toLowerCase();
const createOtp = () => String(Math.floor(100000 + Math.random() * 900000));
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_VERIFY_ATTEMPTS = 5;

const toObjectId = (id) => {
    try {
        return new mongoose.Types.ObjectId(id);
    } catch (e) {
        return null;
    }
};

// =========================
// REGISTER 
// =========================
exports.register = async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = normalizeEmail(email);

        if (!password || !normalizedEmail) {
            return res.status(400).json({ error: "Missing fields" });
        }

        if (!EMAIL_REGEX.test(normalizedEmail)) {
            return res.status(400).json({ error: "Use a valid email address" });
        }

        const existingEmail = await User.findOne({ email: normalizedEmail, archived: { $ne: true } });
        if (existingEmail) {
            return res.status(400).json({ error: "Email already exists" });
        }

        const otpCode = createOtp();
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
            otpExpiresAt: Date.now() + 10 * 60 * 1000,
            otpAttempts: 0,
            otpLastSentAt: Date.now()
        };

        req.session.save(err => {
            if (err) return res.status(500).json({ error: "Session error" });
            res.json({
                success: true,
                requiresOtp: true,
                message: "OTP sent to your email address",
                expiresInSeconds: 600
            });
        });
    } catch (err) {
        console.error("[ERROR] register:", err);
        res.status(500).json({ error: err.message || "Registration failed" });
    }
};

exports.verifyOtp = async (req, res) => {
    try {
        const { otp } = req.body;
        const pending = req.session.pendingRegistration;

        if (!pending) {
            return res.status(400).json({ error: "No pending registration found" });
        }

        if ((pending.otpAttempts || 0) >= OTP_MAX_VERIFY_ATTEMPTS) {
            delete req.session.pendingRegistration;
            return res.status(429).json({ error: "Too many incorrect OTP attempts. Please register again." });
        }

        if (!otp || otp.trim() !== pending.otpCode) {
            pending.otpAttempts = (pending.otpAttempts || 0) + 1;
            req.session.pendingRegistration = pending;
            return res.status(400).json({ error: "Invalid OTP" });
        }

        if (Date.now() > pending.otpExpiresAt) {
            delete req.session.pendingRegistration;
            return res.status(400).json({ error: "OTP expired. Please register again." });
        }

        const existingEmail = await User.findOne({ email: pending.email, archived: { $ne: true } });

        if (existingEmail) {
            delete req.session.pendingRegistration;
            return res.status(400).json({ error: "Email already exists" });
        }

        const hashedPassword = await bcrypt.hash(pending.password, 10);
        const user = await User.create({
            username: pending.username,
            email: pending.email,
            password: hashedPassword,
            emailVerified: true,
            otpCode: null,
            otpExpiresAt: null,
            otpAttempts: 0,
            otpLastSentAt: null
        });

        req.session.user = {
            id: user._id.toString(),
            email: user.email,
            isAdmin: user.isAdmin || false
        };
        delete req.session.pendingRegistration;

        req.session.save(err => {
            if (err) return res.status(500).json({ error: "Session error" });
            logEvent(req, "user_registered", {
                registeredUserId: user._id.toString(),
                email: user.email
            });
            res.json({ success: true, redirect: "/index.html" });
        });
    } catch (err) {
        console.error("[ERROR] verifyOtp:", err);
        res.status(500).json({ error: "OTP verification failed" });
    }
};

exports.resendRegistrationOtp = async (req, res) => {
    try {
        const pending = req.session.pendingRegistration;
        if (!pending?.email) {
            return res.status(400).json({ error: "No pending registration found" });
        }

        if (pending.otpLastSentAt && Date.now() - pending.otpLastSentAt < OTP_RESEND_COOLDOWN_MS) {
            const remainingSeconds = Math.ceil((OTP_RESEND_COOLDOWN_MS - (Date.now() - pending.otpLastSentAt)) / 1000);
            return res.status(429).json({ error: `Please wait ${remainingSeconds} seconds before requesting another OTP.` });
        }

        const otpCode = createOtp();
        pending.otpCode = otpCode;
        pending.otpExpiresAt = Date.now() + 10 * 60 * 1000;
        pending.otpAttempts = 0;
        pending.otpLastSentAt = Date.now();

        await sendOtpEmail({
            email: pending.email,
            otp: otpCode,
            username: pending.email
        });

        req.session.pendingRegistration = pending;
        req.session.save((err) => {
            if (err) return res.status(500).json({ error: "Session error" });
            res.json({
                success: true,
                message: "A new OTP has been sent to your email.",
                expiresInSeconds: 600
            });
        });
    } catch (err) {
        console.error("[ERROR] resendRegistrationOtp:", err);
        res.status(500).json({ error: "Could not resend OTP" });
    }
};

// =========================
// LOGIN
// =========================
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = normalizeEmail(email);
        const user = await User.findOne({ email: normalizedEmail, archived: { $ne: true } });

        if (!user) return res.status(400).json({ message: "User not found" });

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ message: "Wrong password" });

        req.session.user = {
            id: user._id.toString(),
            email: user.email,
            isAdmin: user.isAdmin || false
        };

        req.session.save(err => {
            if (err) return res.status(500).json({ error: "Session error" });
            res.json({ redirect: user.isAdmin ? "admin.html" : "index.html" });
        });
    } catch (err) {
        res.status(500).json({ message: "Login failed" });
    }
};

exports.getSession = (req, res) => {
    if (!req.session.user) return res.status(401).json({ loggedIn: false });
    res.json({ loggedIn: true, user: req.session.user, csrfToken: req.session.csrfToken });
};

exports.getDashboardStats = async (req, res) => {
    try {
        const sessionUser = req.session?.user;
        if (!sessionUser?.id) {
            return res.status(401).json({ message: "Not logged in" });
        }

        const cacheKey = `account:stats:${sessionUser.id}`;
        const stats = await getOrSetCache(cacheKey, 30 * 1000, async () => {
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
    } catch (err) {
        console.error("[ERROR] getDashboardStats:", err);
        res.status(500).json({ message: "Failed to load dashboard stats" });
    }
};

exports.logout = (req, res) => {
    const sessionUser = req.session?.user;
    req.session.destroy(err => {
        if (err) return res.status(500).json({ message: "Logout failed" });
        res.clearCookie('cloudpdf_session');
        res.json({ message: "Logged out" });
    });
};

exports.changePassword = async (req, res) => {
    try {
        if (!req.session.user) return res.status(401).json({ message: "Not logged in" });
        const { currentPassword, newPassword } = req.body;

        if (!newPassword || newPassword.length < 8) {
            return res.status(400).json({ message: "Password must be at least 8 characters long" });
        }
        
        const user = await User.findOne({ _id: toObjectId(req.session.user.id), archived: { $ne: true } });
        if (!user) return res.status(404).json({ message: "User not found" });

        const match = await bcrypt.compare(currentPassword, user.password);
        if (!match) return res.status(400).json({ message: "Current password incorrect" });

        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();
        res.json({ success: true, message: "Password updated" });
    } catch (err) {
        res.status(500).json({ message: "Update failed" });
    }
};

exports.requestPasswordReset = async (req, res) => {
    try {
        const normalizedEmail = normalizeEmail(req.body.email);
        if (!EMAIL_REGEX.test(normalizedEmail)) {
            return res.status(400).json({ error: "Use a valid email address" });
        }

        const user = await User.findOne({ email: normalizedEmail, archived: { $ne: true } });
        if (!user) {
            return res.status(404).json({ error: "No account found for that email" });
        }

        const otpCode = createOtp();
        user.otpCode = otpCode;
        user.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
        user.otpAttempts = 0;
        user.otpLastSentAt = new Date();
        await user.save();

        await sendPasswordResetEmail({ email: user.email, otp: otpCode });

        res.json({
            success: true,
            message: "Password reset OTP sent to your email.",
            expiresInSeconds: 600
        });
    } catch (err) {
        console.error("[ERROR] requestPasswordReset:", err);
        res.status(500).json({ error: err.message || "Could not send reset OTP" });
    }
};

exports.resetPasswordWithOtp = async (req, res) => {
    try {
        const normalizedEmail = normalizeEmail(req.body.email);
        const otp = String(req.body.otp || "").trim();
        const newPassword = req.body.newPassword || "";

        if (!EMAIL_REGEX.test(normalizedEmail)) {
            return res.status(400).json({ error: "Use a valid email address" });
        }

        if (!otp) {
            return res.status(400).json({ error: "OTP is required" });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ error: "Password must be at least 8 characters long" });
        }

        const user = await User.findOne({ email: normalizedEmail, archived: { $ne: true } });
        if (!user) {
            return res.status(404).json({ error: "No account found for that email" });
        }

        if ((user.otpAttempts || 0) >= OTP_MAX_VERIFY_ATTEMPTS) {
            return res.status(429).json({ error: "Too many incorrect OTP attempts. Request a new reset code." });
        }

        if (!user.otpCode || otp !== user.otpCode) {
            user.otpAttempts = (user.otpAttempts || 0) + 1;
            await user.save();
            return res.status(400).json({ error: "Invalid OTP" });
        }

        if (!user.otpExpiresAt || Date.now() > new Date(user.otpExpiresAt).getTime()) {
            user.otpCode = null;
            user.otpExpiresAt = null;
            user.otpAttempts = 0;
            await user.save();
            return res.status(400).json({ error: "OTP expired. Request a new reset code." });
        }

        user.password = await bcrypt.hash(newPassword, 10);
        user.otpCode = null;
        user.otpExpiresAt = null;
        user.otpAttempts = 0;
        user.otpLastSentAt = null;
        await user.save();

        req.session.user = {
            id: user._id.toString(),
            email: user.email,
            isAdmin: user.isAdmin || false
        };

        req.session.save((err) => {
            if (err) return res.status(500).json({ error: "Session error" });
            res.json({
                success: true,
                message: "Password reset successful. Redirecting...",
                redirect: user.isAdmin ? "admin.html" : "index.html"
            });
        });
    } catch (err) {
        console.error("[ERROR] resetPasswordWithOtp:", err);
        res.status(500).json({ error: "Password reset failed" });
    }
};


exports.selfDestruct = async (req, res) => {
    try {
        const sessionUser = req.session?.user;
        const userId = sessionUser?.id;

        if (!userId) {
            return res.status(401).json({ message: "No active session. Please log in again." });
        }

        const userUploads = await Upload.find({ user: userId, archived: { $ne: true } }).select("filename");

        for (const upload of userUploads) {
            const filePath = path.join(__dirname, "../uploads", upload.filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        await Promise.all([
            Upload.updateMany({ user: userId, archived: { $ne: true } }, { archived: true, archivedAt: new Date() }),
            Message.updateMany({ user: userId, archived: { $ne: true } }, { archived: true, archivedAt: new Date() }),
            User.findByIdAndUpdate(userId, { archived: true, archivedAt: new Date() })
        ]);
        deleteCacheByPrefix(`account:stats:${userId}`);
        deleteCacheByPrefix(`uploads:user:${userId}:`);

        req.session.destroy((err) => {
            if (err) {
                return res.status(500).json({ message: "Could not log out." });
            }

            res.clearCookie("cloudpdf_session");
            logEvent({ method: req.method, originalUrl: req.originalUrl, session: { user: sessionUser } }, "account_deleted", { deletedUserId: userId });
            return res.json({ success: true, message: "Account deleted." });
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error." });
    }
};
