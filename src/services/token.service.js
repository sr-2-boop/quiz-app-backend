import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const COOKIE_NAME = 'qp_token';

/**
 * @typedef {{ sub: string, role: 'participant' | 'admin', sid: string }} TokenPayload
 */

/** @param {TokenPayload} payload */
export function signToken({ sub, role, sid }) {
  const token = jwt.sign({ role, sid }, env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: String(sub),
    expiresIn: /** @type {any} */ (env.JWT_EXPIRES_IN),
  });
  const { exp } = /** @type {{ exp: number }} */ (jwt.decode(token));
  return { token, expiresAt: new Date(exp * 1000) };
}

/**
 * Verify signature and expiry. The algorithm is pinned so a token can't pick its own.
 * @returns {TokenPayload}
 */
export function verifyToken(token) {
  const payload = /** @type {any} */ (jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }));
  return { sub: payload.sub, role: payload.role, sid: payload.sid };
}

export function cookieOptions() {
  return { httpOnly: true, sameSite: env.COOKIE_SAME_SITE, secure: env.COOKIE_SECURE, path: '/' };
}

/** @param {import('express').Response} res */
export function setAuthCookie(res, token, expiresAt) {
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), expires: expiresAt });
}

/** @param {import('express').Response} res */
export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}
