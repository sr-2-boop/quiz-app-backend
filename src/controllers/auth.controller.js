import { loginAdmin, loginParticipant, logoutToken } from '../services/auth.service.js';
import { clearAuthCookie, COOKIE_NAME, setAuthCookie } from '../services/token.service.js';

export async function participantLogin(req, res) {
  const { token, expiresAt, user } = await loginParticipant(req.body);
  setAuthCookie(res, token, expiresAt);
  res.json({ user });
}

export async function adminGoogleLogin(req, res) {
  const { token, expiresAt, user } = await loginAdmin(req.body.credential);
  setAuthCookie(res, token, expiresAt);
  res.json({ user });
}

export async function logout(req, res) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) await logoutToken(token);
  clearAuthCookie(res);
  res.status(204).end();
}

export function me(req, res) {
  const { sid: _sid, ...user } = req.user;
  res.json({ user });
}
