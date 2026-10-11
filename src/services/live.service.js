import { logger } from '../config/logger.js';
import { Test } from '../models/index.js';
import { createCoalescer } from '../sockets/broadcaster.js';
import { getIo, roomSize, rooms } from '../sockets/hub.js';
import { buildAdminLeaderboard, getStandings, invalidateStandings, toPublicBoard } from './standings.service.js';

const BROADCAST_DELAY_MS = 750;

async function flushTest(testId) {
  const io = getIo();
  if (!io) return;
  const test = await Test.findById(testId).select('settings status').lean();
  if (!test) return;

  const standings = await getStandings(testId, { fresh: true });

  const adminRoom = rooms.testAdmin(testId);
  if (roomSize(adminRoom) > 0) {
    io.to(adminRoom).emit('leaderboard:update', await buildAdminLeaderboard(testId));
  }

  if (test.settings?.liveScoreVisible) {
    for (const s of standings) {
      io.to(rooms.user(s.participantId)).emit('score:update', { testId: String(testId), score: s.score, rank: s.rank });
    }
  }

  const boardRoom = rooms.testBoard(testId);
  if (test.settings?.leaderboardVisibleToParticipants && roomSize(boardRoom) > 0) {
    io.to(boardRoom).emit('leaderboard:update', { testId: String(testId), entries: toPublicBoard(standings) });
  }
}

const coalescer = createCoalescer(flushTest, BROADCAST_DELAY_MS, {
  onError: (err, testId) => logger.error({ err, testId }, 'Live broadcast failed'),
});

/** Call after anything that changes scores/attempts in a test. Broadcasts are debounced per test. */
export function notifyTestActivity(testId) {
  invalidateStandings(testId);
  coalescer.schedule(String(testId));
}

/** Tell admins and eligible participants that a test started or ended. */
export function broadcastTestStatus(test) {
  const io = getIo();
  if (!io) return;
  const payload = {
    testId: String(test._id),
    status: test.status,
    startsAt: test.startsAt ?? null,
    endsAt: test.endsAt ?? null,
  };
  io.to(rooms.testAdmin(payload.testId)).to(rooms.admins).emit('test:status', payload);
  const sections = test.allowedSections ?? [];
  if (sections.length === 0) {
    io.to(rooms.allParticipants).emit('test:status', payload);
  } else {
    io.to(sections.map((s) => rooms.section(s))).emit('test:status', payload);
  }
}

export function stopLiveBroadcasts() {
  coalescer.cancelAll();
}
