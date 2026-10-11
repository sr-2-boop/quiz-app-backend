import { parseCookie } from 'cookie';
import { Server } from 'socket.io';
import { z } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { Test } from '../models/index.js';
import { getMyStanding, isTestVisibleTo } from '../services/attempt.service.js';
import { authenticateToken } from '../services/auth.service.js';
import { buildAdminLeaderboard, getStandings, toPublicBoard } from '../services/standings.service.js';
import { COOKIE_NAME } from '../services/token.service.js';
import { objectId } from '../schemas/common.js';
import { rooms, setIo } from './hub.js';

const testPayload = z.strictObject({ testId: objectId });

/**
 * Socket.IO with the same JWT verification as HTTP (cookie-based handshake).
 * Rooms are joined only through the server-side checks below: participants can never join admin rooms,
 * and join a test's public board only when that test enables it.
 * @param {import('node:http').Server} httpServer
 */
export function initSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.CLIENT_ORIGIN, credentials: true },
    serveClient: false,
    maxHttpBufferSize: 16 * 1024,
  });

  io.use(async (socket, next) => {
    try {
      const token = parseCookie(socket.handshake.headers.cookie ?? '')[COOKIE_NAME];
      if (!token) return next(new Error('unauthorized'));
      socket.data.user = await authenticateToken(token);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    if (user.role === 'participant') {
      socket.join([rooms.user(user.id), rooms.allParticipants, ...(user.section ? [rooms.section(user.section)] : [])]);
    } else {
      socket.join(rooms.admins);
    }

    socket.on('test:subscribe', async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const parsed = testPayload.safeParse(payload);
      if (!parsed.success) return reply({ ok: false, error: 'INVALID_PAYLOAD' });
      const { testId } = parsed.data;

      try {
        if (user.role === 'admin') {
          if (!(await Test.exists({ _id: testId }))) return reply({ ok: false, error: 'NOT_FOUND' });
          socket.join(rooms.testAdmin(testId));
          socket.emit('leaderboard:update', await buildAdminLeaderboard(testId));
          return reply({ ok: true });
        }

        const test = await Test.findById(testId).select('status allowedSections settings').lean();
        if (!test || !isTestVisibleTo(test, user)) return reply({ ok: false, error: 'NOT_FOUND' });
        const standing = await getMyStanding(user, testId);
        if (standing.visible) socket.emit('score:update', { testId, score: standing.score, rank: standing.rank });
        const board = Boolean(test.settings?.leaderboardVisibleToParticipants);
        if (board) {
          socket.join(rooms.testBoard(testId));
          socket.emit('leaderboard:update', { testId, entries: toPublicBoard(await getStandings(testId)) });
        }
        reply({ ok: true, leaderboard: board });
      } catch (err) {
        logger.warn({ err }, 'test:subscribe failed');
        reply({ ok: false, error: 'SERVER_ERROR' });
      }
    });

    socket.on('test:unsubscribe', (payload) => {
      const parsed = testPayload.safeParse(payload);
      if (!parsed.success) return;
      socket.leave(rooms.testAdmin(parsed.data.testId));
      socket.leave(rooms.testBoard(parsed.data.testId));
    });
  });

  setIo(io);
  return io;
}
