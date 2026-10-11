import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/googleVerifier.js', () => ({ verifyGoogleIdToken: vi.fn() }));

const { verifyGoogleIdToken } = await import('../../src/services/googleVerifier.js');
const { createApp } = await import('../../src/app.js');
const { useTestDb } = await import('../helpers/db.js');

useTestDb();

const GOOGLE = '/api/auth/admin/google';

describe('POST /api/auth/admin/google', () => {
  let app;
  beforeEach(() => {
    app = createApp();
    verifyGoogleIdToken.mockReset();
  });

  it('signs in an allow-listed, verified Google account', async () => {
    verifyGoogleIdToken.mockResolvedValue({ email: 'Admin@Uni.edu', email_verified: true, name: 'Dr Admin' });
    const res = await request(app).post(GOOGLE).send({ credential: 'id-token' });
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ role: 'admin', email: 'admin@uni.edu', name: 'Dr Admin' });
    const cookie = res.headers['set-cookie'][0].split(';')[0];
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.body.user).toMatchObject({ role: 'admin', email: 'admin@uni.edu' });
    expect(verifyGoogleIdToken).toHaveBeenCalledWith('id-token');
  });

  it('returns 403 for accounts not on the allow-list (no auto-creation)', async () => {
    verifyGoogleIdToken.mockResolvedValue({ email: 'student@uni.edu', email_verified: true });
    const res = await request(app).post(GOOGLE).send({ credential: 'id-token' });
    expect(res.status).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('returns 403 for unverified emails', async () => {
    verifyGoogleIdToken.mockResolvedValue({ email: 'admin@uni.edu', email_verified: false });
    expect((await request(app).post(GOOGLE).send({ credential: 'id-token' })).status).toBe(403);
  });

  it('returns 401 for invalid Google tokens', async () => {
    verifyGoogleIdToken.mockRejectedValue(new Error('bad signature'));
    const res = await request(app).post(GOOGLE).send({ credential: 'forged' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_GOOGLE_TOKEN');
  });

  it('never accepts a password-style body', async () => {
    const res = await request(app).post(GOOGLE).send({ email: 'admin@uni.edu', password: 'x' });
    expect(res.status).toBe(400);
    expect(verifyGoogleIdToken).not.toHaveBeenCalled();
  });

  it('rate limits admin login attempts per IP', async () => {
    verifyGoogleIdToken.mockRejectedValue(new Error('bad'));
    for (let i = 0; i < 10; i++) await request(app).post(GOOGLE).send({ credential: 'x' });
    expect((await request(app).post(GOOGLE).send({ credential: 'x' })).status).toBe(429);
  });
});
