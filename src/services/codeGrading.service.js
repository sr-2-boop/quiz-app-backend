import { logger } from '../config/logger.js';
import { isCasePassed, scoreRunResults } from '../grading/index.js';
import { Attempt, CodeRun, Question } from '../models/index.js';
import { sandbox } from '../sandbox/index.js';
import { truncateOutput } from '../sandbox/output.js';
import { patchPendingAnswerStage, RECOMPUTE_SCORE } from './attemptUpdates.js';
import { notifyTestActivity } from './live.service.js';

export const MAX_GRADING_ATTEMPTS = 5;
const LOG_OUTPUT_BYTES = 4096;

const gradingInFlight = new Set();

/** Run one submitted program against every test case (including hidden ones) and score it. */
async function gradeRunAnswer(attempt, question, answer) {
  const code = String(answer.response?.code ?? '');
  const cases = question.testCases ?? [];
  const runs = await Promise.all(
    cases.map((tc) => sandbox.run({ language: question.language, source: code, stdin: tc.input })),
  );
  const outcomes = runs.map((run, i) => ({
    passed: isCasePassed(run, cases[i]),
    weight: cases[i].weight ?? 1,
    verdict: run.verdict,
  }));
  const result = scoreRunResults(question, outcomes);
  const passedCases = outcomes.filter((o) => o.passed).length;
  const firstFailure = runs.find((_, i) => !outcomes[i].passed);

  await CodeRun.create({
    attemptId: attempt._id,
    questionId: question._id,
    language: question.language,
    kind: 'graded',
    verdict: firstFailure ? (firstFailure.verdict === 'ok' ? 'wrong_answer' : firstFailure.verdict) : 'passed',
    passedCases,
    totalCases: cases.length,
    stdout: truncateOutput((firstFailure ?? runs[0])?.stdout, LOG_OUTPUT_BYTES),
    stderr: truncateOutput((firstFailure ?? runs[0])?.stderr, LOG_OUTPUT_BYTES),
    timeMs: Math.max(0, ...runs.map((r) => r.timeMs ?? 0)),
    memoryKb: Math.max(0, ...runs.map((r) => r.memoryKb ?? 0)),
  });

  return { ...result, passedCases, totalCases: cases.length };
}

/**
 * Grade every pending (code-run) answer of a finished attempt via the sandbox, then update the score.
 * Safe to call repeatedly: only answers still "pending" are touched and one attempt is graded at a time.
 */
export async function gradePendingAnswers(attemptId) {
  const key = String(attemptId);
  if (gradingInFlight.has(key)) return;
  gradingInFlight.add(key);
  try {
    const attempt = await Attempt.findById(attemptId).lean();
    if (!attempt || attempt.status === 'in_progress') return;
    const pending = attempt.answers.filter(
      (a) => a.status === 'pending' && (a.gradingAttempts ?? 0) < MAX_GRADING_ATTEMPTS,
    );
    if (pending.length === 0) return;

    const questions = await Question.find({ _id: { $in: pending.map((a) => a.questionId) } }).lean();
    const byId = new Map(questions.map((q) => [String(q._id), q]));
    let changed = false;

    for (const answer of pending) {
      const question = byId.get(String(answer.questionId));
      if (!question) continue;
      try {
        const result = await gradeRunAnswer(attempt, question, answer);
        await Attempt.updateOne(
          { _id: attempt._id, attemptNumber: attempt.attemptNumber },
          [
            patchPendingAnswerStage(answer.questionId, {
              status: 'graded',
              isCorrect: result.isCorrect,
              marksAwarded: result.marksAwarded,
              passedCases: result.passedCases,
              totalCases: result.totalCases,
              gradingError: null,
            }),
            RECOMPUTE_SCORE,
          ],
          { updatePipeline: true },
        );
        changed = true;
      } catch (err) {
        logger.warn({ err, attemptId: key, questionId: String(answer.questionId) }, 'Code grading failed; will retry');
        await Attempt.updateOne(
          { _id: attempt._id },
          {
            $inc: { 'answers.$[a].gradingAttempts': 1 },
            $set: { 'answers.$[a].gradingError': String(err?.code ?? 'SANDBOX_ERROR') },
          },
          { arrayFilters: [{ 'a.questionId': answer.questionId, 'a.status': 'pending' }] },
        );
      }
    }
    if (changed) notifyTestActivity(attempt.testId);
  } finally {
    gradingInFlight.delete(key);
  }
}
