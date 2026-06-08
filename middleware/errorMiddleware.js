// middleware/errorMiddleware.js

class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const globalErrorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || "error";

  // In production, we don't leak stack traces for operational errors, but in development we can
  const isProd = process.env.NODE_ENV === "production";
  
  // Log the error via winston / console
  const logger = require("../services/logService");
  if (err.statusCode >= 500) {
    console.error(`[SYSTEM ERROR] ${err.stack}`);
  } else {
    console.warn(`[API WARNING] ${err.statusCode} - ${err.message}`);
  }

  res.status(err.statusCode).json({
    success: false,
    status: err.status,
    error: err.message,
    message: err.message, // Backward compatibility for both {error} and {message}
    ...(isProd ? {} : { stack: err.stack })
  });
};

module.exports = {
  AppError,
  asyncHandler,
  globalErrorHandler
};
