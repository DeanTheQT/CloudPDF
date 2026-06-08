// config/constants.js
module.exports = {
  // Auth Configs
  OTP_RESEND_COOLDOWN_MS: Number(process.env.OTP_RESEND_COOLDOWN_MS) || 60 * 1000,
  OTP_MAX_VERIFY_ATTEMPTS: Number(process.env.OTP_MAX_VERIFY_ATTEMPTS) || 5,
  OTP_EXPIRATION_MS: Number(process.env.OTP_EXPIRATION_MS) || 10 * 60 * 1000,
  EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]+$/i,

  // Message Configs
  SUBJECT_MAX_LENGTH: Number(process.env.SUBJECT_MAX_LENGTH) || 160,
  MESSAGE_MAX_LENGTH: Number(process.env.MESSAGE_MAX_LENGTH) || 4000,

  // Caching Configs
  MAX_CACHE_ENTRIES: Number(process.env.MAX_CACHE_ENTRIES) || 1000,

  // Upload Queue Configs
  MAX_CONCURRENT_UPLOADS: Math.max(1, Number(process.env.MAX_CONCURRENT_UPLOADS || 1)),
  POLL_INTERVAL_MS: Math.max(2000, Number(process.env.UPLOAD_QUEUE_POLL_MS || 4000)),
};
