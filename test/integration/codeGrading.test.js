import { beforeEach, describe, expect, it, vi } from 'vitest';

// A fake sandbox that "runs" programs by echoing a canned output per stdin.
const fakeRun = vi.fn();
vi.mock('../../src/sandbox/index.js', () => ({
  sandbox: { run: (...args) => fakeRun(...args), isSaturated: () => false },
}));

const { Attempt, CodeRun } = await import('../../src/models/index.js');
const { gradePendingAnswers, MAX_GRADING_ATTEMPTS } = await import('../../src/services/codeGrading.service.js');
const { useTestDb } = await import('../helpers/db.js');
const { createParticipant, createTestWithQuestions, sampleQuestions } = await import('../helpers/factories.js');

useTestDb();

async function submittedAttemptWithCode(code = 'print(sum)') {
  const { test, questions } = await createTestWithQuestions({
    questions: [sampleQuestions.mcq, sampleQuestions.debugRun],
  });
  const [mcq, run] = questions;
  const p = await createParticipant();
  const now = new Date();
  const attempt = await Attempt.create({
    testId: test._id,
    participantId: p._id,
    urn: p.urn,
    name: p.name,
    section: p.section,
    startedAt: new Date(now - 60_000),
    expiresAt: new Date(now.getTime() + 60_000),
    submittedAt: now,
    status: 'submitted',
    layout: questions.map((q) => ({ questionId: q._id })),
    answers: [
      {
        questionId: mcq._id,
        response: { selected: ['B'] },
        status: 'graded',
        answered: true,
        isCorrect: true,
        marksAwarded: 2,
      },
      { questionId: run._id, response: { code }, status: 'pending', answered: true },
    ],
    score: 2,
  });
  return { attempt, run };
}

describe('code-run grading', () => {
  beforeEach(() => {
    fakeRun.mockReset();
  });

  it('runs all cases (including hidden), grades by weight and updates the score', async () => {
    const { attempt, run } = await submittedAttemptWithCode();
    fakeRun.mockImplementation(async (req) => ({
      verdict: 'ok',
      stdout: req.stdin === '2 3' ? '5\n' : 'wrong',
      stderr: '',
      timeMs: 5,
      memoryKb: 100,
    }));

    await gradePendingAnswers(attempt._id);

    expect(fakeRun).toHaveBeenCalledTimes(2);
    expect(fakeRun.mock.calls.map((c) => c[0].stdin).sort()).toEqual(['10 -4', '2 3']);
    const graded = await Attempt.findById(attempt._id).lean();
    const answer = graded.answers.find((a) => String(a.questionId) === String(run._id));
    expect(answer).toMatchObject({
      status: 'graded',
      isCorrect: false,
      marksAwarded: 2,
      passedCases: 1,
      totalCases: 2,
    });
    expect(graded.score).toBe(4);
    const log = await CodeRun.findOne({ attemptId: attempt._id }).lean();
    expect(log).toMatchObject({ kind: 'graded', verdict: 'wrong_answer', passedCases: 1, totalCases: 2 });
  });

  it('keeps the answer pending and counts the failure when the sandbox is down', async () => {
    const { attempt } = await submittedAttemptWithCode();
    fakeRun.mockImplementation(async () => {
      throw Object.assign(new Error('down'), { code: 'SANDBOX_UNREACHABLE' });
    });
    await gradePendingAnswers(attempt._id);
    const after = await Attempt.findById(attempt._id).lean();
    expect(after.answers[1]).toMatchObject({
      status: 'pending',
      gradingAttempts: 1,
      gradingError: 'SANDBOX_UNREACHABLE',
    });
    expect(after.score).toBe(2);
  });

  it('stops retrying after the maximum number of attempts', async () => {
    const { attempt } = await submittedAttemptWithCode();
    await Attempt.updateOne({ _id: attempt._id }, { $set: { 'answers.1.gradingAttempts': MAX_GRADING_ATTEMPTS } });
    await gradePendingAnswers(attempt._id);
    expect(fakeRun).not.toHaveBeenCalled();
  });
});
