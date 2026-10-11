import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { AccessKey, Participant } from '../models/index.js';
import { disconnectUserSockets } from '../sockets/hub.js';
import { AppError, forbidden, invalidCredentials, unauthorized } from '../utils/errors.js';
import { NAME_PATTERN, normalizeMobile, normalizeName, normalizeUrn } from '../utils/normalize.js';
import { verifyGoogleIdToken } from './googleVerifier.js';
import { signToken, verifyToken } from './token.service.js';

// Used to spend comparable time when a login fails before any key comparison.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', 10);

// Hundreds of students log in with the same key within minutes. Remember successful bcrypt comparisons
// (by key id + hash + SHA-256 of the candidate) so each distinct correct key is only bcrypt-checked once.
const POSITIVE_CACHE_TTL_MS = 10 * 60 * 1000;
const POSITIVE_CACHE_MAX = 500;
const positiveKeyCache = new Map();

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function cacheGet(cacheKey) {
  const expires = positiveKeyCache.get(cacheKey);
  if (expires === undefined) return false;
  if (expires < Date.now()) {
    positiveKeyCache.delete(cacheKey);
    return false;
  }
  return true;
}

function cacheSet(cacheKey) {
  if (positiveKeyCache.size >= POSITIVE_CACHE_MAX) {
    positiveKeyCache.delete(positiveKeyCache.keys().next().value);
  }
  positiveKeyCache.set(cacheKey, Date.now() + POSITIVE_CACHE_TTL_MS);
}

export function clearAccessKeyCache() {
  positiveKeyCache.clear();
}

/** Is `candidate` the currently valid access key (active and inside its validity window)? Case-sensitive. */
export async function isValidAccessKey(candidate, now = new Date()) {
  const keys = await AccessKey.find({ isActive: true, validFrom: { $lte: now }, validUntil: { $gte: now } })
    .select('+keyHash')
    .lean();
  if (keys.length === 0) {
    await bcrypt.compare(candidate, DUMMY_HASH);
    return false;
  }
  const digest = sha256(candidate);
  for (const key of keys) {
    const cacheKey = `${key._id}:${key.keyHash}:${digest}`;
    if (cacheGet(cacheKey)) return true;
    if (await bcrypt.compare(candidate, key.keyHash)) {
      cacheSet(cacheKey);
      return true;
    }
  }
  return false;
}

/**
 * The participant for this URN, created on first login. The first login links the URN to its mobile number
 * (and name); later logins must use the same mobile. Admin-imported participants keep their roster details.
 */
async function findOrCreateParticipant({ urn, name, mobile }) {
  const query = () =>
    Participant.findOneAndUpdate(
      { urn },
      { $setOnInsert: { urn, name, mobile, section: '', isActive: true } },
      { upsert: true, returnDocument: 'after' },
    ).lean();
  try {
    return await query();
  } catch (err) {
    // Two first logins for the same URN at once: the other request inserted it, so this one finds it.
    if (err?.code !== 11000) throw err;
    return query();
  }
}

/**
 * Participant login: URN + name + mobile, and password = URN + the day's access key. Any student with a
 * well-formed URN, name and mobile and the right password can sign in; their first login creates them.
 * Every failure is the same generic 401.
 * @param {{ urn: string, name: string, mobile: string, password: string }} credentials
 */
export async function loginParticipant({ urn, name, mobile, password }) {
  const normUrn = normalizeUrn(urn);
  const normName = normalizeName(name);
  const normMobile = normalizeMobile(mobile);

  if (!env.URN_REGEX.test(normUrn) || !NAME_PATTERN.test(normName) || !env.MOBILE_REGEX.test(normMobile)) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw invalidCredentials();
  }

  const prefix = password.slice(0, normUrn.length).toUpperCase();
  const candidateKey = password.slice(normUrn.length);
  if (prefix !== normUrn || !candidateKey) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw invalidCredentials();
  }

  // The key is checked before anything is written, so a wrong password never creates a participant.
  if (!(await isValidAccessKey(candidateKey))) throw invalidCredentials();

  const participant = await findOrCreateParticipant({ urn: normUrn, name: normName, mobile: normMobile });
  if (!participant.isActive || participant.mobile !== normMobile) throw invalidCredentials();

  // Single active session: the new session id replaces (and thereby invalidates) any previous one.
  const sessionId = randomUUID();
  await Participant.updateOne({ _id: participant._id }, { activeSessionId: sessionId, lastLoginAt: new Date() });
  disconnectUserSockets(String(participant._id), { keepSid: sessionId }).catch(() => {});

  const { token, expiresAt } = signToken({ sub: String(participant._id), role: 'participant', sid: sessionId });
  return { token, expiresAt, user: participantIdentity(participant) };
}

/** Admin login with a Google ID token. Only allow-listed, verified emails get an admin token. */
export async function loginAdmin(credential) {
  let payload;
  try {
    payload = await verifyGoogleIdToken(credential);
  } catch {
    throw new AppError(401, 'INVALID_GOOGLE_TOKEN', 'Google sign-in failed. Please try again.');
  }
  if (!payload?.email || payload.email_verified !== true) {
    throw forbidden('Your Google account email is not verified');
  }
  const email = payload.email.toLowerCase();
  if (env.GOOGLE_HOSTED_DOMAIN && payload.hd !== env.GOOGLE_HOSTED_DOMAIN) {
    throw forbidden('This Google account is not authorized for admin access');
  }
  if (!env.ADMIN_EMAILS.includes(email)) {
    throw forbidden('This Google account is not authorized for admin access');
  }

  const { token, expiresAt } = signToken({ sub: email, role: 'admin', sid: randomUUID() });
  return { token, expiresAt, user: { role: 'admin', email, name: payload.name ?? email } };
}

function participantIdentity(p) {
  // Own URN/name/section only. Never the mobile number.
  return { role: 'participant', id: String(p._id), urn: p.urn, name: p.name, section: p.section ?? '' };
}

/**
 * Resolve a JWT into the current identity (used by HTTP middleware and the Socket.IO handshake).
 * Participant tokens are only valid for their current session id and while the participant is active.
 * @param {{ socket?: boolean }} [options] socket: verify a short-lived Socket.IO token instead of a session token
 */
export async function authenticateToken(token, { socket = false } = {}) {
  let payload;
  try {
    payload = verifyToken(token, { socket });
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.');
  }

  if (payload.role === 'admin') {
    if (!env.ADMIN_EMAILS.includes(String(payload.sub).toLowerCase())) throw unauthorized();
    return { role: 'admin', id: payload.sub, email: payload.sub, sid: payload.sid };
  }

  if (payload.role === 'participant' && mongoose.isValidObjectId(payload.sub)) {
    const p = await Participant.findById(payload.sub).select('urn name section isActive activeSessionId').lean();
    if (!p || !p.isActive || !p.activeSessionId) throw unauthorized('Your session has ended. Please sign in again.');
    if (p.activeSessionId !== payload.sid) {
      throw new AppError(
        401,
        'SESSION_REPLACED',
        'You were signed out because your account signed in on another device.',
      );
    }
    return { ...participantIdentity(p), sid: payload.sid };
  }

  throw unauthorized();
}

/** Logout: end the participant's session if this token is still the active one. */
export async function logoutToken(token) {
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return;
  }
  if (payload.role === 'participant' && mongoose.isValidObjectId(payload.sub)) {
    await Participant.updateOne({ _id: payload.sub, activeSessionId: payload.sid }, { activeSessionId: null });
    disconnectUserSockets(payload.sub, { reason: 'logged_out' }).catch(() => {});
  }
}
