import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';

let client;

/**
 * Verify a Google Sign-In ID token (signature, expiry, issuer and audience).
 * @returns {Promise<import('google-auth-library').TokenPayload | undefined>}
 */
export async function verifyGoogleIdToken(idToken) {
  client ??= new OAuth2Client();
  const ticket = await client.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
  return ticket.getPayload();
}
