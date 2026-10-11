import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { roundMarks } from '../grading/normalize.js';
import { Attempt, Question, Test } from '../models/index.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { toPlain } from '../utils/serialize.js';
import { gradePendingAnswers } from './codeGrading.service.js';
import { broadcastTestStatus, notifyTestActivity } from './live.service.js';

async function attemptCounts(testIds) {
  const rows = await Attempt.aggregate([
    { $match: { testId: { $in: testIds } } },
    {
      $group: {
        _id: '$testId',
        started: { $sum: 1 },
        submitted: { $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 0, 1] } },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), { started: r.started, submitted: r.submitted }]));
}

function presentTest(test, counts) {
  return {
    ...toPlain(test),
    questionCount: test.questionOrder?.length ?? 0,
    attempts: counts ?? { started: 0, submitted: 0 },
  };
}

export async function listTests() {
  const tests = await Test.find().sort({ createdAt: -1 }).lean();
  const counts = await attemptCounts(tests.map((t) => t._id));
  return tests.map((t) => presentTest(t, counts.get(String(t._id))));
}

export async function getTest(id) {
  const test = await Test.findById(id).lean();
  if (!test) throw notFound('Test not found');
  const counts = await attemptCounts([test._id]);
  return presentTest(test, counts.get(String(test._id)));
}

export async function createTest(input, adminEmail) {
  const test = await Test.create({ ...input, createdBy: adminEmail });
  return presentTest(test.toObject());
}

export async function updateTest(id, input) {
  const test = await Test.findById(id).lean();
  if (!test) throw notFound('Test not found');
  if (test.status === 'ended') throw conflict('TEST_ENDED', 'An ended test cannot be edited');

  const update = { ...input };
  if (input.settings) update.settings = { ...test.settings, ...input.settings };
  const startsAt = 'startsAt' in input ? input.startsAt : test.startsAt;
  const endsAt = 'endsAt' in input ? input.endsAt : test.endsAt;
  if (startsAt && endsAt && endsAt <= startsAt) {
    throw badRequest('Invalid request', 'VALIDATION_ERROR', [{ path: 'endsAt', message: 'must be after startsAt' }]);
  }

  const updated = await Test.findByIdAndUpdate(id, update, { returnDocument: 'after', runValidators: true }).lean();
  if (updated.status === 'live') notifyTestActivity(updated._id);
  return getTest(updated._id);
}

export async function deleteTest(id) {
  const test = await Test.findById(id).lean();
  if (!test) throw notFound('Test not found');
  if (await Attempt.exists({ testId: test._id })) {
    throw conflict('TEST_HAS_ATTEMPTS', 'This test already has attempts and cannot be deleted');
  }
  await Question.deleteMany({ testId: test._id });
  await Test.deleteOne({ _id: test._id });
}

/** Atomic status transition; 404 when missing, 409 when the current status doesn't allow it. */
async function transition(id, fromStatuses, update, message) {
  const updated = await Test.findOneAndUpdate({ _id: id, status: { $in: fromStatuses } }, update, {
    returnDocument: 'after',
  }).lean();
  if (updated) return updated;
  if (!(await Test.exists({ _id: id }))) throw notFound('Test not found');
  throw conflict('INVALID_STATUS', message);
}

async function assertHasQuestions(id) {
  if (!(await Question.exists({ testId: id }))) throw conflict('TEST_EMPTY', 'Add at least one question first');
}

export async function publishTest(id) {
  await assertHasQuestions(id);
  const test = await transition(id, ['draft'], { status: 'published' }, 'Only draft tests can be published');
  broadcastTestStatus(test);
  return getTest(id);
}

export async function unpublishTest(id) {
  if (await Attempt.exists({ testId: id })) {
    throw conflict('TEST_HAS_ATTEMPTS', 'This test already has attempts');
  }
  const test = await transition(id, ['published'], { status: 'draft' }, 'Only published tests can be unpublished');
  broadcastTestStatus(test);
  return getTest(id);
}

/** Open the test now (sets startsAt to now unless it is already in the past). */
export async function startTest(id, now = new Date()) {
  await assertHasQuestions(id);
  const current = await Test.findById(id).lean();
  if (!current) throw notFound('Test not found');
  if (current.endsAt && current.endsAt <= now) {
    throw conflict('INVALID_WINDOW', 'The end time is in the past. Update or clear it first.');
  }
  const startsAt = current.startsAt && current.startsAt <= now ? current.startsAt : now;
  const test = await transition(
    id,
    ['draft', 'published'],
    { status: 'live', startsAt },
    'This test is already live or ended',
  );
  broadcastTestStatus(test);
  notifyTestActivity(test._id);
  return getTest(id);
}

/** Close the test and auto-submit every attempt still in progress. */
export async function endTest(id, now = new Date()) {
  const current = await Test.findById(id).lean();
  if (!current) throw notFound('Test not found');
  const endsAt = current.endsAt && current.endsAt <= now ? current.endsAt : now;
  const test = await transition(id, ['live', 'published'], { status: 'ended', endsAt }, 'This test is not live');
  await autoSubmitWhere({ testId: test._id }, now);
  broadcastTestStatus(test);
  notifyTestActivity(test._id);
  return getTest(id);
}

/**
 * Auto-submit every in-progress attempt matching `filter` in one update. submittedAt is capped at expiresAt.
 * Used when a test ends and by the expiry sweeper.
 */
export async function autoSubmitWhere(filter, now = new Date()) {
  const affected = await Attempt.find({ ...filter, status: 'in_progress' })
    .select('_id testId answers.status')
    .lean();
  if (affected.length === 0) return 0;

  const submittedAt = { $min: [now, '$expiresAt'] };
  await Attempt.updateMany(
    { _id: { $in: affected.map((a) => a._id) }, status: 'in_progress' },
    [
      {
        $set: {
          status: 'auto_submitted',
          submittedAt,
          timeTakenMs: { $max: [0, { $subtract: [submittedAt, '$startedAt'] }] },
          updatedAt: '$$NOW',
        },
      },
    ],
    { updatePipeline: true },
  );

  for (const testId of new Set(affected.map((a) => String(a.testId)))) notifyTestActivity(testId);
  if (env.CODE_EXECUTION_ENABLED) {
    for (const a of affected.filter((x) => x.answers?.some((ans) => ans.status === 'pending'))) {
      gradePendingAnswers(a._id).catch((err) => logger.error({ err }, 'Code grading failed'));
    }
  }
  return affected.length;
}

/** Keep totalMarks and questionOrder in sync with the test's questions. */
export async function recomputeTestTotals(testId) {
  const [test, questions] = await Promise.all([
    Test.findById(testId).select('questionOrder').lean(),
    Question.find({ testId }).select('_id marks').lean(),
  ]);
  if (!test) return;
  const ids = new Set(questions.map((q) => String(q._id)));
  const order = (test.questionOrder ?? []).filter((id) => ids.has(String(id)));
  const inOrder = new Set(order.map(String));
  for (const q of questions) if (!inOrder.has(String(q._id))) order.push(q._id);
  const totalMarks = roundMarks(questions.reduce((sum, q) => sum + q.marks, 0));
  await Test.updateOne({ _id: testId }, { questionOrder: order, totalMarks });
}

export async function reorderQuestions(id, questionOrder) {
  const test = await Test.findById(id).lean();
  if (!test) throw notFound('Test not found');
  if (test.status === 'live' || test.status === 'ended') {
    throw conflict('TEST_LOCKED', 'Questions cannot be reordered after a test has started');
  }
  const existing = new Set((await Question.find({ testId: id }).select('_id').lean()).map((q) => String(q._id)));
  const unique = new Set(questionOrder);
  if (
    unique.size !== questionOrder.length ||
    unique.size !== existing.size ||
    questionOrder.some((q) => !existing.has(q))
  ) {
    throw badRequest('questionOrder must list every question of this test exactly once', 'INVALID_ORDER');
  }
  await Test.updateOne({ _id: id }, { questionOrder });
  return getTest(id);
}
