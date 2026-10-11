import http from 'node:http';
import request from 'supertest';
import { io as connect } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { initSockets } from '../../src/sockets/index.js';
import { setIo } from '../../src/sockets/hub.js';
import { useTestDb } from '../helpers/db.js';
import { adminCookie, createParticipant, createTestWithQuestions, participantCookie } from '../helpers/factories.js';

useTestDb();

function nextEvent(socket, event, predicate = () => true, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    const handler = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

describe('Socket.IO live updates', () => {
  let server;
  let io;
  let app;
  let url;
  const clients = [];

  beforeEach(async () => {
    app = createApp();
    server = http.createServer(app);
    io = initSockets(server);
    await new Promise((resolve) => server.listen(0, resolve));
    url = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    clients.splice(0).forEach((c) => c.close());
    await new Promise((resolve) => io.close(() => resolve()));
    setIo(null);
  });

  function client(cookie) {
    const socket = connect(url, {
      extraHeaders: cookie ? { Cookie: cookie } : {},
      transports: ['websocket'],
      reconnection: false,
    });
    clients.push(socket);
    return socket;
  }

  it('authenticates with a socket token when the cookie cannot reach the socket host', async () => {
    const p = await createParticipant();
    const cookie = await participantCookie(p);
    const issued = await request(app).get('/api/auth/socket-token').set('Cookie', cookie);
    expect(issued.status).toBe(200);
    const socket = connect(url, { auth: { token: issued.body.token }, transports: ['websocket'], reconnection: false });
    clients.push(socket);
    await nextEvent(socket, 'connect');
    const sockets = await io.fetchSockets();
    expect(sockets[0].rooms.has(`user:${p._id}`)).toBe(true);

    // The socket token is useless for HTTP, and a session token is not a socket token.
    const { COOKIE_NAME } = await import('../../src/services/token.service.js');
    expect((await request(app).get('/api/auth/me').set('Cookie', `${COOKIE_NAME}=${issued.body.token}`)).status).toBe(
      401,
    );
    const sessionToken = cookie.split('=')[1];
    const wrong = connect(url, { auth: { token: sessionToken }, transports: ['websocket'], reconnection: false });
    clients.push(wrong);
    expect((await new Promise((resolve) => wrong.on('connect_error', resolve))).message).toBe('unauthorized');
  });

  it('requires a session to get a socket token', async () => {
    expect((await request(app).get('/api/auth/socket-token')).status).toBe(401);
  });

  it('rejects unauthenticated handshakes', async () => {
    const socket = client(null);
    const err = await new Promise((resolve) => socket.on('connect_error', resolve));
    expect(err.message).toBe('unauthorized');
  });

  it('pushes the participant their own score and rank, and the admin the full leaderboard', async () => {
    const { test, questions } = await createTestWithQuestions();
    const p = await createParticipant();
    const cookie = await participantCookie(p);

    const admin = client(adminCookie());
    await nextEvent(admin, 'connect');
    const adminAck = await admin.emitWithAck('test:subscribe', { testId: String(test._id) });
    expect(adminAck).toEqual({ ok: true });

    const student = client(cookie);
    await nextEvent(student, 'connect');
    const ack = await student.emitWithAck('test:subscribe', { testId: String(test._id) });
    expect(ack).toEqual({ ok: true, leaderboard: false });

    const start = await request(app).post(`/api/tests/${test._id}/start`).set('Cookie', cookie);
    const scoreUpdate = nextEvent(student, 'score:update', (e) => e.score === 2);
    const adminUpdate = nextEvent(admin, 'leaderboard:update', (e) => e.entries[0]?.score === 2);
    await request(app)
      .put(`/api/attempts/${start.body.attempt.id}/answers/${questions[0]._id}`)
      .set('Cookie', cookie)
      .send({ response: { selected: ['B'] } });

    expect(await scoreUpdate).toEqual({ testId: String(test._id), score: 2, rank: 1 });
    const board = await adminUpdate;
    expect(board.entries[0]).toMatchObject({ urn: 'E25B002749', name: 'Asha Verma', section: 'A' });
  });

  it('sends participants only rank/name/score when the leaderboard is enabled', async () => {
    const { test } = await createTestWithQuestions({ settings: { leaderboardVisibleToParticipants: true } });
    const p = await createParticipant();
    const cookie = await participantCookie(p);
    await request(app).post(`/api/tests/${test._id}/start`).set('Cookie', cookie);

    const student = client(cookie);
    await nextEvent(student, 'connect');
    const boardPromise = nextEvent(student, 'leaderboard:update');
    expect(await student.emitWithAck('test:subscribe', { testId: String(test._id) })).toEqual({
      ok: true,
      leaderboard: true,
    });
    const board = await boardPromise;
    expect(board.entries).toEqual([{ rank: 1, displayName: 'Asha Verma', score: 0 }]);
    expect(JSON.stringify(board)).not.toMatch(/9876543210|E25B002749|"section"/);
  });

  it('does not let participants into admin rooms or other sections tests', async () => {
    const { test } = await createTestWithQuestions({ allowedSections: ['B'] });
    const cookie = await participantCookie(await createParticipant());
    const student = client(cookie);
    await nextEvent(student, 'connect');
    expect(await student.emitWithAck('test:subscribe', { testId: String(test._id) })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(await student.emitWithAck('test:subscribe', { testId: 'test:x:admin' })).toEqual({
      ok: false,
      error: 'INVALID_PAYLOAD',
    });
    const sockets = await io.fetchSockets();
    expect([...sockets[0].rooms].some((r) => r.endsWith(':admin'))).toBe(false);
  });

  it('disconnects the old socket when the participant logs in elsewhere', async () => {
    const p = await createParticipant();
    const { createAccessKey } = await import('../helpers/factories.js');
    await createAccessKey('K7Q2');
    const cookie = await participantCookie(p);
    const student = client(cookie);
    await nextEvent(student, 'connect');
    const revoked = nextEvent(student, 'session:revoked');
    await request(app)
      .post('/api/auth/participant/login')
      .send({ urn: 'E25B002749', name: 'Asha Verma', mobile: '9876543210', password: 'E25B002749K7Q2' });
    expect(await revoked).toEqual({ reason: 'session_revoked' });
  });
});
