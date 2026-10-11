import { normalizeOutput } from './normalize.js';
import { allOrNothing, unanswered } from './result.js';

/** "What is the output?" questions: normalized text match, or a single option id in mcq mode. */
export function gradeSnippet(question, response) {
  const answer = String(response?.answer ?? '');

  if (question.answerMode === 'mcq') {
    if (!answer) return unanswered();
    return allOrNothing(question, question.correctOptionIds.includes(answer));
  }

  const given = normalizeOutput(answer);
  if (!given) return unanswered();
  return allOrNothing(question, given === normalizeOutput(question.expectedOutput));
}
