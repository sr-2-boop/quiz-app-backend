import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { AppError } from '../utils/errors.js';
import { normalizeUrn } from '../utils/normalize.js';

// University Wi-Fi puts hundreds of students behind one IP, so limits are keyed by identity wherever
// possible and the per-IP ceiling on login is deliberately high. See CLAUDE.md §4.4.

const MINUTE = 60 * 1000;

const ipKey = (req) => ipKeyGenerator(req.ip ?? '');

// Key generators are exported so the tests can assert on them.
export const keys = {
  ipAndUrn: (req) => `${ipKey(req)}|${normalizeUrn(req.body?.urn).slice(0, 32)}`,
  urn: (req) => `urn|${normalizeUrn(req.body?.urn).slice(0, 32)}`,
  ip: (req) => ipKey(req),
  user: (req) => (req.user ? `${req.user.role}|${req.user.id}` : ipKey(req)),
};

function handler(req, res) {
  const resetTime = req.rateLimit?.resetTime;
  const retryAfter = resetTime ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000)) : 60;
  res.set('Retry-After', String(retryAfter));
  res.status(429).json({
    error: { code: 'RATE_LIMITED', message: `Too many requests. Try again in ${retryAfter} seconds.` },
  });
}

function limiter({ windowMs, limit, keyGenerator, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs,
    limit,
    keyGenerator,
    skipSuccessfulRequests,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler,
  });
}

/** Allow one in-flight request per user (code runs). */
function singleFlight() {
  const inFlight = new Set();
  return (req, res, next) => {
    const key = keys.user(req);
    if (inFlight.has(key)) {
      return next(new AppError(429, 'RUN_IN_PROGRESS', 'Your previous run is still in progress'));
    }
    inFlight.add(key);
    res.on('close', () => inFlight.delete(key));
    next();
  };
}

/** Each call creates fresh in-memory stores (one app instance = one set of limiters). */
export function createRateLimiters() {
  return {
    // Participant login: failures per IP+URN and per URN, plus a high per-IP ceiling for campus NAT.
    participantLogin: [
      limiter({ windowMs: 15 * MINUTE, limit: 300, keyGenerator: keys.ip }),
      limiter({ windowMs: 15 * MINUTE, limit: 5, keyGenerator: keys.ipAndUrn, skipSuccessfulRequests: true }),
      limiter({ windowMs: 15 * MINUTE, limit: 20, keyGenerator: keys.urn, skipSuccessfulRequests: true }),
    ],
    adminLogin: limiter({ windowMs: 15 * MINUTE, limit: 10, keyGenerator: keys.ip }),
    answerSave: limiter({ windowMs: MINUTE, limit: 60, keyGenerator: keys.user }),
    codeRun: [limiter({ windowMs: MINUTE, limit: 10, keyGenerator: keys.user }), singleFlight()],
    exportImport: limiter({ windowMs: MINUTE, limit: 5, keyGenerator: keys.user }),
    general: limiter({ windowMs: MINUTE, limit: 120, keyGenerator: keys.user }),
  };
}

/** @typedef {ReturnType<typeof createRateLimiters>} RateLimiters */
