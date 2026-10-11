import { roundMarks } from './normalize.js';

/**
 * @typedef {object} GradeResult
 * @property {'graded' | 'pending'} status
 * @property {boolean} answered
 * @property {boolean} isCorrect
 * @property {number} marksAwarded
 */

/** @returns {GradeResult} */
export function unanswered() {
  return { status: 'graded', answered: false, isCorrect: false, marksAwarded: 0 };
}

/** @returns {GradeResult} */
export function graded(isCorrect, marksAwarded) {
  return { status: 'graded', answered: true, isCorrect, marksAwarded: roundMarks(marksAwarded) };
}

/** @returns {GradeResult} */
export function pending() {
  return { status: 'pending', answered: true, isCorrect: false, marksAwarded: 0 };
}

/** Full marks if correct, otherwise the (optional) negative marks. */
export function allOrNothing(question, isCorrect) {
  return graded(isCorrect, isCorrect ? question.marks : -(question.negativeMarks ?? 0));
}
