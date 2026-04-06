const crypto = require("crypto");

function ensureCsrfToken(req) {
  if (!req.session) {
    return null;
  }

  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString("hex");
  }

  return req.session.csrfToken;
}

function attachCsrfToken(req, res, next) {
  const token = ensureCsrfToken(req);
  if (token) {
    res.locals.csrfToken = token;
  }
  next();
}

function requireCsrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  const expected = ensureCsrfToken(req);
  const provided = req.get("x-csrf-token");

  if (!expected || !provided || provided !== expected) {
    return res.status(403).json({ message: "Invalid CSRF token" });
  }

  next();
}

function getCsrfToken(req, res) {
  res.json({ csrfToken: ensureCsrfToken(req) });
}

module.exports = {
  attachCsrfToken,
  requireCsrf,
  getCsrfToken,
  ensureCsrfToken
};
