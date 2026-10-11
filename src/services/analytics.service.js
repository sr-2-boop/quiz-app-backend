import { Attempt, Participant, Question, Test } from '../models/index.js';
import { rankEntries } from '../ranking/rank.js';
import { notFound } from '../utils/errors.js';
import { toPlain } from '../utils/serialize.js';

const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Load a test with its ordered questions and (optionally section-filtered) attempts. */
export async function loadTestData(testId, { section } = {}) {
  const test = await Test.findById(testId).lean();
  if (!test) throw notFound('Test not found');
  const [questions, attempts] = await Promise.all([
    Question.find({ testId: test._id }).lean(),
    Attempt.find({ testId: test._id, ...(section ? { section } : {}) }).lean(),
  ]);
  const position = new Map((test.questionOrder ?? []).map((id, i) => [String(id), i]));
  questions.sort((a, b) => (position.get(String(a._id)) ?? 1e9) - (position.get(String(b._id)) ?? 1e9));
  return { test, questions, attempts };
}

function wrongOptionIds(question, answer) {
  if (!answer?.answered || answer.isCorrect) return [];
  if (question.type === 'mcq') {
    const correct = new Set(question.correctOptionIds);
    return (answer.response?.selected ?? []).filter((id) => !correct.has(id));
  }
  if (question.type === 'snippet' && question.answerMode === 'mcq') {
    return answer.response?.answer ? [answer.response.answer] : [];
  }
  return [];
}

/**
 * Pure analytics over loaded data: ranked participants, per-question and per-section stats.
 * @param {{ questions: any[], attempts: any[], now?: number }} data
 */
export function computeAnalytics({ questions, attempts, now = Date.now() }) {
  const answersByAttempt = new Map(
    attempts.map((a) => [String(a._id), new Map(a.answers.map((ans) => [String(ans.questionId), ans]))]),
  );

  const participants = rankEntries(
    attempts.map((a) => {
      const answers = [...answersByAttempt.get(String(a._id)).values()];
      return {
        attemptId: String(a._id),
        participantId: String(a.participantId),
        urn: a.urn,
        name: a.name,
        section: a.section ?? '',
        score: a.score ?? 0,
        status: a.status,
        startedAt: a.startedAt,
        submittedAt: a.submittedAt,
        timeTakenMs: a.timeTakenMs ?? Math.max(0, Math.min(now, a.expiresAt.getTime()) - a.startedAt.getTime()),
        answered: answers.filter((x) => x.answered).length,
        correct: answers.filter((x) => x.answered && x.isCorrect).length,
        pending: answers.filter((x) => x.status === 'pending').length,
      };
    }),
  );

  const perQuestion = questions.map((q, index) => {
    const qid = String(q._id);
    let answered = 0;
    let correct = 0;
    let pending = 0;
    let timeSum = 0;
    let timeCount = 0;
    const wrongCounts = new Map();
    for (const a of attempts) {
      const ans = answersByAttempt.get(String(a._id)).get(qid);
      if (!ans) continue;
      if (ans.timeSpentMs > 0) {
        timeSum += ans.timeSpentMs;
        timeCount++;
      }
      if (!ans.answered) continue;
      answered++;
      if (ans.status === 'pending') {
        pending++;
        continue;
      }
      if (ans.isCorrect) correct++;
      for (const id of wrongOptionIds(q, ans)) wrongCounts.set(id, (wrongCounts.get(id) ?? 0) + 1);
    }
    const graded = answered - pending;
    const [topId, topCount] = [...wrongCounts.entries()].sort((x, y) => y[1] - x[1])[0] ?? [];
    return {
      questionId: qid,
      number: index + 1,
      type: q.type,
      statement: q.statement,
      marks: q.marks,
      attempts: answered,
      correct,
      pending,
      percentCorrect: graded > 0 ? round((correct / graded) * 100, 1) : null,
      avgTimeMs: timeCount > 0 ? Math.round(timeSum / timeCount) : null,
      mostChosenWrongOption: topId
        ? { id: topId, text: q.options?.find((o) => o.id === topId)?.text ?? '', count: topCount }
        : null,
    };
  });

  const sections = new Map();
  for (const p of participants) {
    const list = sections.get(p.section) ?? [];
    list.push(p);
    sections.set(p.section, list);
  }
  const perSection = [...sections.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([section, list]) => {
      const scores = list.map((p) => p.score);
      return {
        section,
        participants: list.length,
        submitted: list.filter((p) => p.status !== 'in_progress').length,
        average: round(scores.reduce((s, v) => s + v, 0) / scores.length),
        max: Math.max(...scores),
        min: Math.min(...scores),
      };
    });

  const scores = participants.map((p) => p.score);
  return {
    totals: {
      participants: participants.length,
      submitted: participants.filter((p) => p.status !== 'in_progress').length,
      inProgress: participants.filter((p) => p.status === 'in_progress').length,
      averageScore: scores.length ? round(scores.reduce((s, v) => s + v, 0) / scores.length) : null,
      maxScore: scores.length ? Math.max(...scores) : null,
      minScore: scores.length ? Math.min(...scores) : null,
    },
    participants,
    perQuestion,
    perSection,
  };
}

/** Admin analytics endpoint (adds roster mobile numbers to each participant row). */
export async function getAnalytics(testId, { section } = {}) {
  const { test, questions, attempts } = await loadTestData(testId, { section });
  const analytics = computeAnalytics({ questions, attempts });
  const mobiles = await mobilesFor(attempts);
  for (const p of analytics.participants) p.mobile = mobiles.get(p.participantId) ?? '';
  return {
    test: { id: String(test._id), title: test.title, totalMarks: test.totalMarks, status: test.status },
    ...analytics,
  };
}

export async function mobilesFor(attempts) {
  const people = await Participant.find({ _id: { $in: attempts.map((a) => a.participantId) } })
    .select('mobile')
    .lean();
  return new Map(people.map((p) => [String(p._id), p.mobile]));
}

/** One participant's full attempt (responses + correctness) for the admin drill-down. */
export async function getAttemptDetail(testId, attemptId) {
  const attempt = await Attempt.findOne({ _id: attemptId, testId }).lean();
  if (!attempt) throw notFound('Attempt not found');
  const [participant, questions] = await Promise.all([
    Participant.findById(attempt.participantId).select('urn name mobile section isActive').lean(),
    Question.find({ _id: { $in: attempt.layout.map((l) => l.questionId) } }).lean(),
  ]);
  const byId = new Map(questions.map((q) => [String(q._id), q]));
  const answers = new Map(attempt.answers.map((a) => [String(a.questionId), a]));
  return {
    attempt: toPlain({ ...attempt, layout: undefined, answers: undefined }),
    participant: participant ? toPlain(participant) : null,
    items: attempt.layout
      .filter((l) => byId.has(String(l.questionId)))
      .map((l, i) => ({
        number: i + 1,
        question: toPlain(byId.get(String(l.questionId))),
        answer: answers.has(String(l.questionId)) ? toPlain(answers.get(String(l.questionId))) : null,
      })),
  };
}
