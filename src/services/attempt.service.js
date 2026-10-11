import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { gradeAnswer, isCasePassed } from '../grading/index.js';
import { Attempt, CodeRun, Question, Test } from '../models/index.js';
import { sandbox } from '../sandbox/index.js';
import { truncateOutput } from '../sandbox/output.js';
import { SandboxBusyError } from '../sandbox/SandboxClient.js';
import { responseSchemaFor } from '../schemas/question.schemas.js';
import { toParticipantAnswer, toParticipantFeedback, toParticipantView } from '../serializers/participantView.js';
import { badRequest, conflict, notFound, serviceUnavailable, validationError } from '../utils/errors.js';
import { shuffle } from '../utils/random.js';
import { idEquals } from '../utils/serialize.js';
import { RECOMPUTE_SCORE, upsertAnswerStage } from './attemptUpdates.js';
import { gradePendingAnswers } from './codeGrading.service.js';
import { notifyTestActivity } from './live.service.js';
import { getStandings } from './standings.service.js';

/** Saves arriving this long after expiresAt are still accepted (network latency). */
export const SAVE_GRACE_MS = 5000;
const RUN_OUTPUT_BYTES = 2000;

// ---- Rules ---------------------------------------------------------------------------------

export function isTestOpen(test, now = new Date()) {
  return test.status === 'live' && (!test.startsAt || test.startsAt <= now) && (!test.endsAt || test.endsAt > now);
}

export function isTestVisibleTo(test, user) {
  if (test.status === 'draft') return false;
  const sections = test.allowedSections ?? [];
  return sections.length === 0 || sections.includes(user.section);
}

export function isExpired(attempt, now = new Date()) {
  return now.getTime() > attempt.expiresAt.getTime() + SAVE_GRACE_MS;
}

/** Per-question right/wrong + correct answers, per the test's feedbackMode. Never during an attempt. */
export function isFeedbackRevealed(test, attempt) {
  if (!attempt || attempt.status === 'in_progress') return false;
  if (test.settings?.feedbackMode === 'after_test') return test.status === 'ended';
  return true;
}

function isScoreVisible(test, attempt) {
  return Boolean(test.settings?.liveScoreVisible) || isFeedbackRevealed(test, attempt);
}

function publicSettings(test) {
  return {
    feedbackMode: test.settings?.feedbackMode ?? 'after_submit',
    liveScoreVisible: Boolean(test.settings?.liveScoreVisible),
    leaderboardVisible: Boolean(test.settings?.leaderboardVisibleToParticipants),
    maxAttempts: test.settings?.maxAttempts ?? 1,
    allowRetakes: Boolean(test.settings?.allowRetakes),
  };
}

/** May a participant whose latest attempt is number `attemptNumber` start another one? */
function hasAttemptsLeft(test, attemptNumber) {
  return Boolean(test.settings?.allowRetakes) || attemptNumber < (test.settings?.maxAttempts ?? 1);
}

function computeExpiry(test, now) {
  const byDuration = now.getTime() + test.durationMinutes * 60 * 1000;
  return new Date(Math.min(byDuration, test.endsAt ? test.endsAt.getTime() : Number.POSITIVE_INFINITY));
}

function buildLayout(test, questions) {
  const byId = new Map(questions.map((q) => [String(q._id), q]));
  const ordered = [];
  for (const id of test.questionOrder ?? []) {
    const q = byId.get(String(id));
    if (q) {
      ordered.push(q);
      byId.delete(String(id));
    }
  }
  ordered.push(...byId.values());
  const list = test.settings?.shuffleQuestions ? shuffle(ordered) : ordered;
  return list.map((q) => ({
    questionId: q._id,
    optionOrder: test.settings?.shuffleOptions && q.options?.length ? shuffle(q.options.map((o) => o.id)) : undefined,
  }));
}

async function loadOwnAttempt(user, attemptId) {
  const attempt = await Attempt.findOne({ _id: attemptId, participantId: user.id }).lean();
  if (!attempt) throw notFound('Attempt not found');
  return attempt;
}

/**
 * Close an in-progress attempt (manual submit, expiry or test end). Idempotent.
 * @param {'submitted' | 'auto_submitted'} status
 */
export async function finalizeAttempt(attempt, status, now = new Date()) {
  const submittedAt = new Date(Math.min(now.getTime(), attempt.expiresAt.getTime()));
  const res = await Attempt.updateOne(
    { _id: attempt._id, status: 'in_progress', attemptNumber: attempt.attemptNumber },
    {
      $set: {
        status,
        submittedAt,
        timeTakenMs: Math.max(0, submittedAt.getTime() - attempt.startedAt.getTime()),
      },
    },
  );
  if (res.modifiedCount === 0) return false;
  notifyTestActivity(attempt.testId);
  if (env.CODE_EXECUTION_ENABLED) {
    gradePendingAnswers(attempt._id).catch((err) => logger.error({ err }, 'Code grading failed'));
  }
  return true;
}

async function assertWritable(attempt, now) {
  if (attempt.status !== 'in_progress') {
    throw conflict('ATTEMPT_CLOSED', 'This attempt has already been submitted');
  }
  if (isExpired(attempt, now)) {
    await finalizeAttempt(attempt, 'auto_submitted', now);
    throw conflict('ATTEMPT_EXPIRED', 'Time is up. Your answers were submitted automatically.');
  }
}

// ---- Participant operations ----------------------------------------------------------------

export async function listTestsForParticipant(user) {
  const now = new Date();
  const tests = await Test.find({
    status: { $in: ['published', 'live', 'ended'] },
    $or: [{ allowedSections: { $size: 0 } }, { allowedSections: user.section }],
  })
    .sort({ startsAt: 1, createdAt: -1 })
    .lean();
  const attempts = await Attempt.find({ participantId: user.id, testId: { $in: tests.map((t) => t._id) } })
    .select('testId status attemptNumber score expiresAt submittedAt')
    .lean();
  const byTest = new Map(attempts.map((a) => [String(a.testId), a]));

  return tests
    .filter((t) => t.status !== 'ended' || byTest.has(String(t._id)))
    .map((t) => {
      const a = byTest.get(String(t._id));
      const open = isTestOpen(t, now);
      return {
        id: String(t._id),
        title: t.title,
        description: t.description,
        status: t.status,
        startsAt: t.startsAt,
        endsAt: t.endsAt,
        durationMinutes: t.durationMinutes,
        totalMarks: t.totalMarks,
        questionCount: t.questionOrder?.length ?? 0,
        isOpen: open,
        settings: publicSettings(t),
        canStart: open && (!a || a.status === 'in_progress' || hasAttemptsLeft(t, a.attemptNumber)),
        myAttempt: a
          ? {
              id: String(a._id),
              status: a.status,
              attemptNumber: a.attemptNumber,
              expiresAt: a.expiresAt,
              submittedAt: a.submittedAt,
              score: isScoreVisible(t, a) ? a.score : null,
              feedbackAvailable: isFeedbackRevealed(t, a),
            }
          : null,
      };
    });
}

async function buildAttemptPayload(test, attempt, now, questions) {
  const list = questions ?? (await Question.find({ _id: { $in: attempt.layout.map((l) => l.questionId) } }).lean());
  const byId = new Map(list.map((q) => [String(q._id), q]));
  const immediate = test.settings?.feedbackMode === 'immediate';

  return {
    serverNow: now.toISOString(),
    test: {
      id: String(test._id),
      title: test.title,
      description: test.description,
      totalMarks: test.totalMarks,
      durationMinutes: test.durationMinutes,
      endsAt: test.endsAt,
      settings: publicSettings(test),
    },
    attempt: {
      id: String(attempt._id),
      status: attempt.status,
      attemptNumber: attempt.attemptNumber,
      startedAt: attempt.startedAt,
      expiresAt: attempt.expiresAt,
      score: test.settings?.liveScoreVisible ? attempt.score : null,
    },
    questions: attempt.layout
      .filter((l) => byId.has(String(l.questionId)))
      .map((l) => toParticipantView(byId.get(String(l.questionId)), l)),
    answers: attempt.answers.map((a) => toParticipantAnswer(a, { revealCorrectness: immediate })),
  };
}

/** Create a new attempt, or resume the in-progress one. Returns sanitized questions + server-computed expiry. */
export async function startAttempt(user, testId) {
  const now = new Date();
  const test = await Test.findById(testId).lean();
  if (!test || !isTestVisibleTo(test, user)) throw notFound('Test not found');

  let attempt = await Attempt.findOne({ testId: test._id, participantId: user.id }).lean();
  if (attempt?.status === 'in_progress' && isExpired(attempt, now)) {
    await finalizeAttempt(attempt, 'auto_submitted', now);
    attempt = await Attempt.findById(attempt._id).lean();
  }
  if (attempt?.status === 'in_progress') return buildAttemptPayload(test, attempt, now);

  if (!isTestOpen(test, now)) {
    throw conflict('TEST_NOT_OPEN', test.status === 'ended' ? 'This test has ended' : 'This test is not open yet');
  }
  const questions = await Question.find({ testId: test._id }).lean();
  if (questions.length === 0) throw conflict('TEST_EMPTY', 'This test has no questions yet');

  const fields = {
    startedAt: now,
    expiresAt: computeExpiry(test, now),
    submittedAt: null,
    status: 'in_progress',
    layout: buildLayout(test, questions),
    answers: [],
    score: 0,
    timeTakenMs: null,
  };

  if (attempt) {
    if (!hasAttemptsLeft(test, attempt.attemptNumber)) {
      throw conflict('NO_ATTEMPTS_LEFT', 'You have already submitted this test');
    }
    const retake = await Attempt.findOneAndUpdate(
      { _id: attempt._id, status: { $ne: 'in_progress' }, attemptNumber: attempt.attemptNumber },
      {
        $set: { ...fields, attemptNumber: attempt.attemptNumber + 1 },
        $push: {
          history: {
            attemptNumber: attempt.attemptNumber,
            status: attempt.status,
            score: attempt.score,
            startedAt: attempt.startedAt,
            submittedAt: attempt.submittedAt,
            timeTakenMs: attempt.timeTakenMs,
          },
        },
      },
      { returnDocument: 'after' },
    ).lean();
    attempt = retake ?? (await Attempt.findById(attempt._id).lean());
  } else {
    try {
      const created = await Attempt.create({
        testId: test._id,
        participantId: user.id,
        urn: user.urn,
        name: user.name,
        section: user.section,
        attemptNumber: 1,
        ...fields,
      });
      attempt = created.toObject();
    } catch (err) {
      if (err?.code !== 11000) throw err;
      // Double-click / two tabs: the other request created it first.
      attempt = await Attempt.findOne({ testId: test._id, participantId: user.id }).lean();
    }
  }
  if (attempt.status !== 'in_progress') throw conflict('ATTEMPT_CLOSED', 'This attempt has already been submitted');

  notifyTestActivity(test._id);
  return buildAttemptPayload(test, attempt, now, questions);
}

/** Save/overwrite one answer and grade it (non-code questions grade synchronously). */
export async function saveAnswer(user, attemptId, questionId, { response, timeSpentMs }) {
  const now = new Date();
  const attempt = await loadOwnAttempt(user, attemptId);
  await assertWritable(attempt, now);

  if (!attempt.layout.some((l) => idEquals(l.questionId, questionId))) {
    throw notFound('Question not found in this attempt');
  }
  const [question, test] = await Promise.all([
    Question.findOne({ _id: questionId, testId: attempt.testId }).lean(),
    Test.findById(attempt.testId).select('settings status').lean(),
  ]);
  if (!question || !test) throw notFound('Question not found');

  const parsed = responseSchemaFor(question).safeParse(response);
  if (!parsed.success) throw validationError(parsed.error, 'Invalid answer');

  const immediate = test.settings?.feedbackMode === 'immediate';
  const existing = attempt.answers.find((a) => idEquals(a.questionId, questionId));
  if (immediate && existing?.answered) {
    throw conflict('ANSWER_LOCKED', 'This answer is locked because its feedback was already shown');
  }

  const grade = gradeAnswer(question, parsed.data);
  const answer = {
    questionId: question._id,
    response: parsed.data,
    status: grade.status,
    answered: grade.answered,
    isCorrect: grade.isCorrect,
    marksAwarded: grade.marksAwarded,
    answeredAt: now,
    timeSpentMs: timeSpentMs ?? existing?.timeSpentMs ?? 0,
    gradingAttempts: 0,
  };

  const filter = {
    _id: attempt._id,
    attemptNumber: attempt.attemptNumber,
    status: 'in_progress',
    expiresAt: { $gt: new Date(now.getTime() - SAVE_GRACE_MS) },
  };
  if (immediate) filter.answers = { $not: { $elemMatch: { questionId: question._id, answered: true } } };

  const updated = await Attempt.findOneAndUpdate(filter, [upsertAnswerStage(question._id, answer), RECOMPUTE_SCORE], {
    updatePipeline: true,
    returnDocument: 'after',
    projection: { score: 1 },
  }).lean();
  if (!updated) throw conflict('ATTEMPT_CLOSED', 'This attempt is no longer accepting answers');

  notifyTestActivity(attempt.testId);

  const out = { questionId: String(question._id), savedAt: now, answered: grade.answered };
  if (test.settings?.liveScoreVisible) out.score = updated.score;
  if (immediate) {
    out.status = grade.status;
    out.isCorrect = grade.status === 'graded' ? grade.isCorrect : null;
    out.marksAwarded = grade.status === 'graded' ? grade.marksAwarded : null;
  }
  return out;
}

/** "Run" button: execute against the visible (sample) test cases only. Hidden cases never run here. */
export async function runSampleCases(user, attemptId, { questionId, code }) {
  if (!env.CODE_EXECUTION_ENABLED) {
    throw serviceUnavailable('CODE_EXECUTION_DISABLED', 'Code execution is not enabled for this event');
  }
  const now = new Date();
  const attempt = await loadOwnAttempt(user, attemptId);
  await assertWritable(attempt, now);
  if (!attempt.layout.some((l) => idEquals(l.questionId, questionId))) {
    throw notFound('Question not found in this attempt');
  }
  const question = await Question.findOne({ _id: questionId, testId: attempt.testId }).lean();
  if (!question) throw notFound('Question not found');
  if (question.type !== 'debug' || question.grading !== 'run') {
    throw badRequest('This question cannot be run', 'NOT_RUNNABLE');
  }

  const samples = (question.testCases ?? []).filter((tc) => !tc.hidden);
  if (samples.length === 0) return { results: [], passed: 0, total: 0 };
  if (sandbox.isSaturated()) throw new SandboxBusyError();

  const runs = await Promise.all(
    samples.map((tc) => sandbox.run({ language: question.language, source: code, stdin: tc.input })),
  );
  const results = runs.map((run, i) => {
    const passed = isCasePassed(run, samples[i]);
    return {
      case: i + 1,
      verdict: passed ? 'passed' : run.verdict === 'ok' ? 'wrong_answer' : run.verdict,
      stdout: truncateOutput(run.stdout, RUN_OUTPUT_BYTES),
      stderr: truncateOutput(run.stderr, RUN_OUTPUT_BYTES),
    };
  });
  const passed = results.filter((r) => r.verdict === 'passed').length;

  await CodeRun.create({
    attemptId: attempt._id,
    questionId: question._id,
    language: question.language,
    kind: 'sample',
    verdict: results.find((r) => r.verdict !== 'passed')?.verdict ?? 'passed',
    passedCases: passed,
    totalCases: results.length,
    stdout: truncateOutput(runs[0]?.stdout, 4096),
    stderr: truncateOutput(runs[0]?.stderr, 4096),
    timeMs: Math.max(0, ...runs.map((r) => r.timeMs ?? 0)),
    memoryKb: Math.max(0, ...runs.map((r) => r.memoryKb ?? 0)),
  });

  // Timing and memory are deliberately not returned to participants.
  return { results, passed, total: results.length };
}

export async function submitAttempt(user, attemptId) {
  const now = new Date();
  const attempt = await loadOwnAttempt(user, attemptId);
  if (attempt.status === 'in_progress') {
    await finalizeAttempt(attempt, isExpired(attempt, now) ? 'auto_submitted' : 'submitted', now);
  }
  return getAttemptResult(user, attemptId);
}

/** Own result: score/rank when visible, and per-question feedback once feedbackMode allows it. */
export async function getAttemptResult(user, attemptId) {
  const attempt = await loadOwnAttempt(user, attemptId);
  if (attempt.status === 'in_progress') {
    throw conflict('ATTEMPT_IN_PROGRESS', 'Submit the test to see your result');
  }
  const test = await Test.findById(attempt.testId).lean();
  if (!test) throw notFound('Test not found');

  const revealed = isFeedbackRevealed(test, attempt);
  const scoreVisible = isScoreVisible(test, attempt);
  let rank = null;
  if (scoreVisible) {
    const standings = await getStandings(test._id);
    rank = standings.find((s) => s.attemptId === String(attempt._id))?.rank ?? null;
  }

  const result = {
    test: {
      id: String(test._id),
      title: test.title,
      totalMarks: test.totalMarks,
      status: test.status,
      endsAt: test.endsAt,
      settings: publicSettings(test),
    },
    attempt: {
      id: String(attempt._id),
      status: attempt.status,
      attemptNumber: attempt.attemptNumber,
      submittedAt: attempt.submittedAt,
      timeTakenMs: attempt.timeTakenMs,
      score: scoreVisible ? attempt.score : null,
      rank,
      pendingCount: attempt.answers.filter((a) => a.status === 'pending').length,
    },
    feedbackAvailable: revealed,
    canRetake: isTestOpen(test) && hasAttemptsLeft(test, attempt.attemptNumber),
    questions: [],
  };

  if (revealed) {
    const questions = await Question.find({ _id: { $in: attempt.layout.map((l) => l.questionId) } }).lean();
    const byId = new Map(questions.map((q) => [String(q._id), q]));
    const answers = new Map(attempt.answers.map((a) => [String(a.questionId), a]));
    result.questions = attempt.layout
      .filter((l) => byId.has(String(l.questionId)))
      .map((l) => {
        const q = byId.get(String(l.questionId));
        return {
          question: toParticipantView(q, l),
          feedback: toParticipantFeedback(q, answers.get(String(q._id))),
        };
      });
  }
  return result;
}

/** Own live score and rank for a test (only when the test shows live scores, or feedback is out). */
export async function getMyStanding(user, testId) {
  const test = await Test.findById(testId).select('settings status allowedSections').lean();
  if (!test || !isTestVisibleTo(test, user)) throw notFound('Test not found');
  const attempt = await Attempt.findOne({ testId: test._id, participantId: user.id }).select('score status').lean();
  const base = { testId: String(test._id), attempted: Boolean(attempt), visible: false, score: null, rank: null };
  if (!attempt || !isScoreVisible(test, attempt)) return base;
  const standing = (await getStandings(test._id)).find((s) => s.participantId === user.id);
  return { ...base, visible: true, status: attempt.status, score: attempt.score, rank: standing?.rank ?? null };
}
