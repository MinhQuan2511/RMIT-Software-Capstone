/**
 * Local trust boundary for the Express API.
 *
 * - Host allowlist: rejects requests whose Host header is not a loopback name,
 *   which defeats DNS-rebinding pages that resolve their own hostname to
 *   127.0.0.1.
 * - Origin allowlist: a request that carries an Origin header must come from
 *   the local frontend. CORS alone is not treated as authentication.
 * - CSRF token: every state-changing request must echo a random per-process
 *   token obtained from GET /api/session. A cross-origin page cannot read that
 *   response, so it cannot forge the header.
 *
 * This protects a single-operator local tool. It is not multi-user
 * authentication and must not be exposed beyond loopback.
 */

const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostnameOf(hostHeader) {
  if (typeof hostHeader !== 'string' || hostHeader === '') return null;
  if (hostHeader.startsWith('[')) {
    const end = hostHeader.indexOf(']');
    return end > 0 ? hostHeader.slice(0, end + 1).toLowerCase() : null;
  }
  return hostHeader.split(':')[0].toLowerCase();
}

function reject(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

function createRequestGuard({ allowedOrigins, allowedHostnames, csrfToken = crypto.randomBytes(32).toString('hex') }) {
  const origins = new Set(allowedOrigins);
  const hosts = new Set(allowedHostnames.map((h) => h.toLowerCase()));
  const tokenBuf = Buffer.from(csrfToken);

  return {
    csrfToken,
    hostCheck(req, res, next) {
      if (!hosts.has(hostnameOf(req.headers.host))) return reject(res, 403, 'HOST_NOT_ALLOWED', 'Requests must address the local service by a loopback host name.');
      return next();
    },
    originCheck(req, res, next) {
      const origin = req.headers.origin;
      if (origin !== undefined && !origins.has(origin)) return reject(res, 403, 'ORIGIN_NOT_ALLOWED', 'Requests from this origin are not accepted.');
      return next();
    },
    csrfCheck(req, res, next) {
      if (SAFE_METHODS.has(req.method)) return next();
      const supplied = req.get('x-vd-csrf');
      const buf = Buffer.from(typeof supplied === 'string' ? supplied : '');
      if (buf.length !== tokenBuf.length || !crypto.timingSafeEqual(buf, tokenBuf)) {
        return reject(res, 403, 'CSRF_TOKEN_INVALID', 'Missing or invalid request token. Reload the application.');
      }
      return next();
    },
    isAllowedOrigin: (origin) => origins.has(origin),
  };
}

/** Fixed-window limiter per bucket. The tool has one local operator, so the window is global. */
function createRateLimiter({ windowMs, max }, now = Date.now) {
  let windowStart = now();
  let count = 0;
  return function rateLimit(req, res, next) {
    const t = now();
    if (t - windowStart >= windowMs) { windowStart = t; count = 0; }
    count += 1;
    if (count > max) {
      res.set('Retry-After', String(Math.ceil((windowStart + windowMs - t) / 1000)));
      return reject(res, 429, 'RATE_LIMITED', 'Too many requests of this kind. Wait a moment and retry.');
    }
    return next();
  };
}

module.exports = { createRequestGuard, createRateLimiter, hostnameOf };
