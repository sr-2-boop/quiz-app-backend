import { authenticateToken } from '../services/auth.service.js';
import { COOKIE_NAME } from '../services/token.service.js';
import { forbidden, unauthorized } from '../utils/errors.js';

/** Verifies the qp_token cookie and attaches req.user. */
export async function requireAuth(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) throw unauthorized();
  req.user = await authenticateToken(token);
  next();
}

/** @param {'admin' | 'participant'} role */
export function requireRole(role) {
  return (req, _res, next) => {
    if (req.user?.role !== role) return next(forbidden());
    next();
  };
}
