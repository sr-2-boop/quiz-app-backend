import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { Participant } from '../../src/models/index.js';
import { useTestDb } from '../helpers/db.js';
import { createAccessKey, createParticipant } from '../helpers/factories.js';

useTestDb();

const LOGIN = '/api/auth/participant/login';
const GENERIC = { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } };
const good = { urn: 'E25B002749', mobile: '9876543210', password: 'E25B002749K7Q2' };

describe('POST /api/auth/participant/login', () => {
  let app;
  beforeEach(async () => {
    app = createApp();
    await createParticipant();
    await createAccessKey('K7Q2');
  });

  it('logs in with mobile + URN + (URN + key) and sets an httpOnly cookie', async () => {
    const res = await request(app).post(LOGIN).send(good);
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      role: 'participant',
      id: expect.any(String),
      urn: 'E25B002749',
      name: 'Asha Verma',
      section: 'A',
    });
    expect(res.body.user).not.toHaveProperty('mobile');
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/^qp_token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('normalizes URN case/spacing and mobile formatting', async () => {
    const res = await request(app)
      .post(LOGIN)
      .send({ urn: ' e25b002749 ', mobile: '+91 98765-43210', password: 'e25b002749K7Q2' });
    expect(res.status).toBe(200);
  });

  const failures = {
    'unknown URN': { ...good, urn: 'E25B000001', password: 'E25B000001K7Q2' },
    'malformed URN': { ...good, urn: 'NOT-A-URN', password: 'NOT-A-URNK7Q2' },
    'malformed mobile': { ...good, mobile: '12345' },
    'mobile not matching the roster': { ...good, mobile: '9123456780' },
    'wrong key': { ...good, password: 'E25B002749WRONG' },
    'key with wrong case': { ...good, password: 'E25B002749k7q2' },
    'password without the URN prefix': { ...good, password: 'K7Q2' },
    'password that is only the URN': { ...good, password: 'E25B002749' },
    "another participant's URN prefix": { ...good, password: 'E25B002750K7Q2' },
  };

  for (const [name, body] of Object.entries(failures)) {
    it(`rejects ${name} with the same generic 401`, async () => {
      const res = await request(app).post(LOGIN).send(body);
      expect(res.status).toBe(401);
      expect(res.body).toEqual(GENERIC);
      expect(res.headers['set-cookie']).toBeUndefined();
    });
  }

  it('rejects an inactive participant generically', async () => {
    await Participant.updateOne({ urn: 'E25B002749' }, { isActive: false });
    const res = await request(app).post(LOGIN).send(good);
    expect(res.status).toBe(401);
    expect(res.body).toEqual(GENERIC);
  });

  it('rejects an expired or deactivated key generically', async () => {
    await createAccessKey('OLD1', {
      validFrom: new Date(Date.now() - 7200_000),
      validUntil: new Date(Date.now() - 3600_000),
    });
    await createAccessKey('OFF1', { isActive: false });
    for (const key of ['OLD1', 'OFF1']) {
      const res = await request(app)
        .post(LOGIN)
        .send({ ...good, password: `E25B002749${key}` });
      expect(res.status).toBe(401);
      expect(res.body).toEqual(GENERIC);
    }
  });

  it('rejects extra fields and operator injection', async () => {
    expect(
      (
        await request(app)
          .post(LOGIN)
          .send({ ...good, role: 'admin' })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post(LOGIN)
          .send({ ...good, urn: { $gt: '' } })
      ).status,
    ).toBe(400);
  });

  it('keeps a single active session: a new login invalidates the old token', async () => {
    const first = await request(app).post(LOGIN).send(good);
    const firstCookie = first.headers['set-cookie'][0].split(';')[0];
    expect((await request(app).get('/api/auth/me').set('Cookie', firstCookie)).status).toBe(200);

    const second = await request(app).post(LOGIN).send(good);
    const secondCookie = second.headers['set-cookie'][0].split(';')[0];

    const stale = await request(app).get('/api/auth/me').set('Cookie', firstCookie);
    expect(stale.status).toBe(401);
    expect(stale.body.error.code).toBe('SESSION_REPLACED');
    expect((await request(app).get('/api/auth/me').set('Cookie', secondCookie)).status).toBe(200);
  });

  it('logout clears the cookie and ends the session', async () => {
    const login = await request(app).post(LOGIN).send(good);
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const out = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(out.status).toBe(204);
    expect(out.headers['set-cookie'][0]).toMatch(/qp_token=;/);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('rate limits repeated failures per IP + URN without blocking other students on the same IP', async () => {
    for (let i = 0; i < 5; i++) {
      expect(
        (
          await request(app)
            .post(LOGIN)
            .send({ ...good, password: 'E25B002749BAD' })
        ).status,
      ).toBe(401);
    }
    const blocked = await request(app).post(LOGIN).send(good);
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.body.error.code).toBe('RATE_LIMITED');

    await createParticipant({ urn: 'E25B002750', mobile: '9876543211' });
    const other = await request(app)
      .post(LOGIN)
      .send({ urn: 'E25B002750', mobile: '9876543211', password: 'E25B002750K7Q2' });
    expect(other.status).toBe(200);
  });

  it('does not count successful logins towards the failure limit', async () => {
    for (let i = 0; i < 8; i++) {
      expect((await request(app).post(LOGIN).send(good)).status).toBe(200);
    }
  });
});
