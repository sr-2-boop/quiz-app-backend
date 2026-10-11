import { gradeDebug } from './debug.js';
import { gradeFillBlank } from './fillBlank.js';
import { gradeMcq } from './mcq.js';
import { gradeSnippet } from './snippet.js';

const graders = {
  mcq: gradeMcq,
  fill_blank: gradeFillBlank,
  debug: gradeDebug,
  snippet: gradeSnippet,
};

/**
 * Grade one response. Pure and idempotent: the same question + response always yields the same result.
 * @returns {import('./result.js').GradeResult}
 */
export function gradeAnswer(question, response) {
  const grader = graders[question.type];
  if (!grader) throw new Error(`No grader for question type ${question.type}`);
  return grader(question, response);
}

export { scoreRunResults, isCasePassed } from './debug.js';
