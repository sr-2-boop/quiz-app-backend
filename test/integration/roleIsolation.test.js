import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { useTestDb } from '../helpers/db.js';
import { adminCookie, createParticipant, createTestWithQuestions, participantCookie } from '../helpers/factories.js';

useTestDb();

const ADMIN_ROUTES = [
  ['get', '/api/admin/participants'],
  ['get', '/api/admin/access-keys'],
  ['post', '/api/admin/access-keys'],
  ['get', '/api/admin/tests'],
  ['post', '/api/admin/tests'],
  ['get', '/api/admin/templates/questions.json'],
];

describe('authentication and role isolation', () => {
  let app;
  let testId;
  beforeEach(async () => {
    app = createApp();
    const { test } = await createTestWithQuestions();
    testId = String(test._id);
  });

  it('requires a JWT on every route except login and health', async () => {
    const routes = [
      ...ADMIN_ROUTES,
      ['get', `/api/admin/tests/${testId}/export.xlsx`],
      ['get', '/api/tests'],
      ['post', `/api/tests/${testId}/start`],
      ['get', '/api/auth/me'],
      ['get', '/api/anything-else'],
    ];
    for (const [method, path] of routes) {
      const res = await request(app)[method](path);
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    expect((await request(app).get('/api/health')).status).toBe(200);
  });

  it('blocks participants from every admin route', async () => {
    const cookie = await participantCookie(await createParticipant());
    const destructive = [
      ['post', `/api/admin/tests/${testId}/restart`],
      ['delete', `/api/admin/tests/${testId}`],
    ];
    for (const [method, path] of [...ADMIN_ROUTES, ...destructive]) {
      const res = await request(app)[method](path).set('Cookie', cookie);
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    expect((await request(app).post(`/api/admin/tests/${testId}/restart`)).status).toBe(401);
  });

  it('blocks admins from participant routes', async () => {
    const cookie = adminCookie();
    expect((await request(app).get('/api/tests').set('Cookie', cookie)).status).toBe(403);
    expect((await request(app).post(`/api/tests/${testId}/start`).set('Cookie', cookie)).status).toBe(403);
  });

  it('rejects admin tokens for emails no longer on the allow-list', async () => {
    const res = await request(app).get('/api/admin/tests').set('Cookie', adminCookie('removed@uni.edu'));
    expect(res.status).toBe(401);
  });

  it('rejects tokens signed with another secret or algorithm', async () => {
    const forged = jwt.sign({ role: 'admin', sid: 'x' }, 'not-the-secret-not-the-secret-123', {
      subject: 'admin@uni.edu',
    });
    expect((await request(app).get('/api/admin/tests').set('Cookie', `qp_token=${forged}`)).status).toBe(401);
    const none = jwt.sign({ role: 'admin', sid: 'x', sub: 'admin@uni.edu' }, '', { algorithm: 'none' });
    expect((await request(app).get('/api/admin/tests').set('Cookie', `qp_token=${none}`)).status).toBe(401);
  });

  it('returns JSON errors for unknown routes', async () => {
    const res = await request(app).get('/api/admin/nope').set('Cookie', adminCookie());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
