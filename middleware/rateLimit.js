function createRateLimiter({
  windowMs,
  maxRequests,
  key = (req) => req.ip || "unknown",
  message = "Too many requests. Please try again later.",
  maxKeys = 10000
}) {
  const store = new Map();
  let lastCleanupAt = 0;

  function cleanup(now) {
    if (now - lastCleanupAt < windowMs) return;
    lastCleanupAt = now;

    for (const [storedKey, entry] of store.entries()) {
      if (entry.expiresAt <= now) {
        store.delete(storedKey);
      }
    }

    while (store.size > maxKeys) {
      const oldestKey = store.keys().next().value;
      store.delete(oldestKey);
    }
  }

  return (req, res, next) => {
    const now = Date.now();
    cleanup(now);

    const rateKey = key(req);
    const existing = store.get(rateKey);

    if (!existing || existing.expiresAt <= now) {
      store.set(rateKey, {
        count: 1,
        expiresAt: now + windowMs
      });
      while (store.size > maxKeys) {
        const oldestKey = store.keys().next().value;
        store.delete(oldestKey);
      }
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
