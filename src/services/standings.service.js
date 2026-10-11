import mongoose from 'mongoose';
import { Attempt } from '../models/index.js';
import { rankEntries } from '../ranking/rank.js';

// Ranked standings per test, cached briefly so hundreds of "my score" requests don't each scan every attempt.
// The cache is invalidated whenever an attempt in that test changes (see live.service.js).
const CACHE_TTL_MS = 2000;
const cache = new Map();

/**
 * @typedef {object} Standing
 * @property {string} attemptId
 * @property {string} participantId
 * @property {string} urn
 * @property {string} name
 * @property {string} section
 * @property {number} score
 * @property {string} status
 * @property {number} timeTakenMs  final time for submitted attempts, elapsed time so far otherwise
 * @property {number} rank
 */

/** @returns {Promise<Standing[]>} */
export async function getStandings(testId, { fresh = false } = {}) {
  const key = String(testId);
  const hit = cache.get(key);
  if (!fresh && hit && hit.expires > Date.now()) return hit.standings;

  const attempts = await Attempt.find({ testId })
    .select('participantId urn name section score status startedAt expiresAt timeTakenMs')
    .lean();
  const now = Date.now();
  const standings = rankEntries(
    attempts.map((a) => ({
      attemptId: String(a._id),
      participantId: String(a.participantId),
      urn: a.urn,
      name: a.name,
      section: a.section ?? '',
      score: a.score ?? 0,
      status: a.status,
      timeTakenMs: a.timeTakenMs ?? Math.max(0, Math.min(now, a.expiresAt.getTime()) - a.startedAt.getTime()),
    })),
  );
  cache.set(key, { standings, expires: Date.now() + CACHE_TTL_MS });
  return standings;
}

export function invalidateStandings(testId) {
  cache.delete(String(testId));
}

/** Answered/correct counts per question across all attempts of a test. */
export async function getQuestionStats(testId) {
  const rows = await Attempt.aggregate([
    { $match: { testId: new mongoose.Types.ObjectId(String(testId)) } },
    { $unwind: '$answers' },
    { $match: { 'answers.answered': true } },
    {
      $group: {
        _id: '$answers.questionId',
        answered: { $sum: 1 },
        correct: { $sum: { $cond: ['$answers.isCorrect', 1, 0] } },
        pending: { $sum: { $cond: [{ $eq: ['$answers.status', 'pending'] }, 1, 0] } },
      },
    },
  ]);
  return rows.map((r) => ({
    questionId: String(r._id),
    answered: r.answered,
    correct: r.correct,
    pending: r.pending,
    correctRate: r.answered - r.pending > 0 ? r.correct / (r.answered - r.pending) : null,
  }));
}

/** Admin leaderboard payload (full PII; admin-only). */
export async function buildAdminLeaderboard(testId, { section, fresh = false } = {}) {
  const [standings, questionStats] = await Promise.all([getStandings(testId, { fresh }), getQuestionStats(testId)]);
  const entries = section ? standings.filter((s) => s.section === section) : standings;
  return {
    testId: String(testId),
    counts: {
      started: standings.length,
      inProgress: standings.filter((s) => s.status === 'in_progress').length,
      submitted: standings.filter((s) => s.status !== 'in_progress').length,
    },
    entries,
    questionStats,
    generatedAt: new Date().toISOString(),
  };
}

/** Participant-facing leaderboard: rank, display name and score only. No URN, mobile or section. */
export function toPublicBoard(standings, limit = 50) {
  return standings.slice(0, limit).map((s) => ({ rank: s.rank, displayName: s.name, score: s.score }));
}
