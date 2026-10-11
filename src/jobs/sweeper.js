import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { Attempt, Test } from '../models/index.js';
import { SAVE_GRACE_MS } from '../services/attempt.service.js';
import { gradePendingAnswers, MAX_GRADING_ATTEMPTS } from '../services/codeGrading.service.js';
import { broadcastTestStatus } from '../services/live.service.js';
import { autoSubmitWhere, endTest } from '../services/test.service.js';

/**
 * One sweep: start scheduled tests, end tests past endsAt, auto-submit expired attempts,
 * and retry code grading that failed earlier. Uses the server clock only.
 */
export async function runSweep(now = new Date()) {
  const toStart = await Test.find({
    status: 'published',
    startsAt: { $ne: null, $lte: now },
    $or: [{ endsAt: null }, { endsAt: { $gt: now } }],
  })
    .select('_id')
    .lean();
  for (const { _id } of toStart) {
    const test = await Test.findOneAndUpdate(
      { _id, status: 'published' },
      { status: 'live' },
      { returnDocument: 'after' },
    ).lean();
    if (test) {
      logger.info({ testId: String(_id) }, 'Scheduled test started');
      broadcastTestStatus(test);
    }
  }

  const toEnd = await Test.find({ status: { $in: ['live', 'published'] }, endsAt: { $ne: null, $lte: now } })
    .select('_id')
    .lean();
  for (const { _id } of toEnd) {
    try {
      await endTest(_id, now);
      logger.info({ testId: String(_id) }, 'Scheduled test ended');
    } catch (err) {
      if (err?.code !== 'INVALID_STATUS') throw err;
    }
  }

  const expired = await autoSubmitWhere({ expiresAt: { $lt: new Date(now.getTime() - SAVE_GRACE_MS) } }, now);

  if (env.CODE_EXECUTION_ENABLED) {
    const pending = await Attempt.find({
      status: { $ne: 'in_progress' },
      answers: { $elemMatch: { status: 'pending', gradingAttempts: { $lt: MAX_GRADING_ATTEMPTS } } },
    })
      .select('_id')
      .limit(50)
      .lean();
    for (const a of pending) {
      gradePendingAnswers(a._id).catch((err) => logger.error({ err }, 'Code grading retry failed'));
    }
  }

  return { started: toStart.length, ended: toEnd.length, autoSubmitted: expired };
}

/** Run the sweep every `intervalMs` (never overlapping). Returns a stop function. */
export function startSweeper({ intervalMs = 10_000 } = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runSweep();
    } catch (err) {
      logger.error({ err }, 'Sweeper run failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  return () => clearInterval(timer);
}
