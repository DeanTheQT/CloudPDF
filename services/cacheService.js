const cacheStore = new Map();

function getCache(key) {
  const entry = cacheStore.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    cacheStore.delete(key);
    return null;
  }

  return entry.value;
}

function setCache(key, value, ttlMs) {
  cacheStore.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

function deleteCache(key) {
  cacheStore.delete(key);
}

function deleteCacheByPrefix(prefix) {
  for (const key of cacheStore.keys()) {
    if (key.startsWith(prefix)) {
      cacheStore.delete(key);
    }
  }
}

async function getOrSetCache(key, ttlMs, loader) {
  const cached = getCache(key);
  if (cached !== null) {
    return cached;
  }

  const value = await loader();
  setCache(key, value, ttlMs);
  return value;
}

module.exports = {
  getCache,
  setCache,
  deleteCache,
  deleteCacheByPrefix,
  getOrSetCache
};
