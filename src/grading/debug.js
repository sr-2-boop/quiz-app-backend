import { normalizeCode, normalizeOutput } from './normalize.js';
import { allOrNothing, graded, pending, unanswered } from './result.js';

/**
 * grading "answer": normalized match against acceptedFixes.
 * grading "run": the answer is pending until the sandbox has run every test case (see scoreRunResults).
 */
export function gradeDebug(question, response) {
  if (question.grading === 'run') {
    return String(response?.code ?? '').trim() ? pending() : unanswered();
  }
  const answer = normalizeCode(response?.answer);
  if (!answer) return unanswered();
  const isCorrect = question.acceptedFixes.some((fix) => normalizeCode(fix) === answer);
  return allOrNothing(question, isCorrect);
}

/** Did one sandbox run pass its test case? */
export function isCasePassed(runResult, testCase) {
  return runResult.verdict === 'ok' && normalizeOutput(runResult.stdout) === normalizeOutput(testCase.expectedOutput);
}

/**
 * Score a run-graded debug answer from per-test-case outcomes.
 * Marks = share of passed case weights, or all-or-nothing when question.allOrNothing is set.
 * @param {any} question
 * @param {{ passed: boolean, weight?: number }[]} cases
 */
export function scoreRunResults(question, cases) {
  const total = cases.reduce((sum, c) => sum + (c.weight ?? 1), 0);
  const passed = cases.reduce((sum, c) => sum + (c.passed ? (c.weight ?? 1) : 0), 0);
  const allPassed = cases.length > 0 && cases.every((c) => c.passed);

  if (question.allOrNothing || total === 0) return allOrNothing(question, allPassed);
  if (passed === 0) return graded(false, -(question.negativeMarks ?? 0));
  return graded(allPassed, (question.marks * passed) / total);
}
