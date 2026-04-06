function createRateLimiter({
  windowMs,
  maxRequests,
  key = (req) => req.ip || "unknown",
  message = "Too many requests. Please try again later."
}) {
  const store = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const rateKey = key(req);
    const existing = store.get(rateKey);

    if (!existing || existing.expiresAt <= now) {
      store.set(rateKey, {
        count: 1,
        expiresAt: now + windowMs
      });
      next();
      return;
    }

    if (existing.count >= maxRequests) {
      res.status(429).json({ message });
      return;
    }

    existing.count += 1;
    next();
  };
}

module.exports = { createRateLimiter };
