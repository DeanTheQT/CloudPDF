// services/cacheService.js
const Redis = require("ioredis");
const { MAX_CACHE_ENTRIES } = require("../config/constants");

const cacheStore = new Map();
let redisClient = null;
let useRedis = false;

if (process.env.REDIS_URL) {
  try {
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      retryStrategy(times) {
        // Stop retrying to connect to Redis after 2 attempts to fallback to memory
        if (times > 2) {
          console.warn("[CACHE] Redis connection failed repeatedly. Falling back to in-memory cache.");
          useRedis = false;
          return null;
        }
        return 500;
      }
    });

    redisClient.on("connect", () => {
      console.log("[CACHE] Connected to Redis successfully.");
      useRedis = true;
    });

    redisClient.on("error", (err) => {
      console.error("[CACHE] Redis error occurred:", err.message);
      // Fallback if Redis goes down at runtime
      useRedis = false;
    });
  } catch (err) {
    console.error("[CACHE] Failed to initialize Redis client:", err);
    useRedis = false;
  }
}

function cleanupMapCache() {
  const now = Date.now();

  for (const [key, entry] of cacheStore.entries()) {
    if (entry.expiresAt <= now) {
      cacheStore.delete(key);
    }
  }

  while (cacheStore.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cacheStore.keys().next().value;
    cacheStore.delete(oldestKey);
  }
}

async function getCache(key) {
  if (useRedis && redisClient) {
    try {
      const data = await redisClient.get(key);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      console.error(`[CACHE] Redis get error for key "${key}":`, err.message);
      // Graceful fallback to memory Map if Redis call fails
    }
  }

  // Memory fallback
  const entry = cacheStore.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    cacheStore.delete(key);
    return null;
  }

  return entry.value;
}

async function setCache(key, value, ttlMs) {
  if (useRedis && redisClient) {
    try {
      const stringifiedValue = JSON.stringify(value);
      // ttlMs to seconds conversion
      const ttlSec = Math.max(1, Math.round(ttlMs / 1000));
      await redisClient.set(key, stringifiedValue, "EX", ttlSec);
      return;
    } catch (err) {
      console.error(`[CACHE] Redis set error for key "${key}":`, err.message);
    }
  }

  // Memory fallback
  cleanupMapCache();
  cacheStore.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

async function deleteCache(key) {
  if (useRedis && redisClient) {
    try {
      await redisClient.del(key);
      return;
    } catch (err) {
      console.error(`[CACHE] Redis del error for key "${key}":`, err.message);
    }
  }

  // Memory fallback
  cacheStore.delete(key);
}

async function deleteCacheByPrefix(prefix) {
  if (useRedis && redisClient) {
    try {
      // Use SCAN to avoid blocking Redis on large key spaces
      let cursor = "0";
      const keysToDelete = [];
      do {
        const reply = await redisClient.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100);
        cursor = reply[0];
        keysToDelete.push(...reply[1]);
      } while (cursor !== "0");

      if (keysToDelete.length > 0) {
        await redisClient.del(...keysToDelete);
      }
      return;
    } catch (err) {
      console.error(`[CACHE] Redis deleteCacheByPrefix error for prefix "${prefix}":`, err.message);
    }
  }

  // Memory fallback
  for (const key of cacheStore.keys()) {
    if (key.startsWith(prefix)) {
      cacheStore.delete(key);
    }
  }
}

async function getOrSetCache(key, ttlMs, loader) {
  const cached = await getCache(key);
  if (cached !== null) {
    return cached;
  }

  const value = await loader();
  await setCache(key, value, ttlMs);
  return value;
}

module.exports = {
  getCache,
  setCache,
  deleteCache,
  deleteCacheByPrefix,
  getOrSetCache
};
