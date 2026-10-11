import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const COOKIE_NAME = 'qp_token';

// Socket tokens let the Socket.IO handshake authenticate when the frontend reaches the API through a proxy on its
// own domain (so the httpOnly cookie never reaches the socket host). They are short-lived and HTTP rejects them.
const SOCKET_AUDIENCE = 'socket';
const SOCKET_TOKEN_TTL_SECONDS = 120;

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

/** @param {TokenPayload} payload */
export function signSocketToken({ sub, role, sid }) {
  return jwt.sign({ role, sid }, env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: String(sub),
    audience: SOCKET_AUDIENCE,
    expiresIn: SOCKET_TOKEN_TTL_SECONDS,
  });
}

/**
 * Verify signature and expiry. The algorithm is pinned so a token can't pick its own.
 * A socket token is accepted only when `socket` is true, and a session token only when it is false.
 * @returns {TokenPayload}
 */
export function verifyToken(token, { socket = false } = {}) {
  const payload = /** @type {any} */ (
    jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], ...(socket ? { audience: SOCKET_AUDIENCE } : {}) })
  );
  if (!socket && payload.aud !== undefined) throw new Error('Not a session token');
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
