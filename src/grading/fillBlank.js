import { normalizeAnswer } from './normalize.js';
import { graded, unanswered } from './result.js';

export function isBlankCorrect(blank, value) {
  const given = normalizeAnswer(value, blank);
  if (!given) return false;
  return blank.acceptedAnswers.some((accepted) => normalizeAnswer(accepted, blank) === given);
}

/** Marks are split equally across blanks. Negative marks apply only when every answered blank is wrong. */
export function gradeFillBlank(question, response) {
  const values = response?.values ?? {};
  const blanks = question.blanks;
  const answeredCount = blanks.filter((b) => normalizeAnswer(values[b.id])).length;
  if (answeredCount === 0) return unanswered();

  const correctCount = blanks.filter((b) => isBlankCorrect(b, values[b.id])).length;
  if (correctCount === 0) return graded(false, -(question.negativeMarks ?? 0));
  return graded(correctCount === blanks.length, (question.marks * correctCount) / blanks.length);
}
