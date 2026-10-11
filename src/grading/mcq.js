import { allOrNothing, unanswered } from './result.js';

/** Exact set match between the selected and correct option ids. */
export function gradeMcq(question, response) {
  const selected = new Set(response?.selected ?? []);
  if (selected.size === 0) return unanswered();

  const correct = new Set(question.correctOptionIds);
  const isCorrect = selected.size === correct.size && [...selected].every((id) => correct.has(id));
  return allOrNothing(question, isCorrect);
}
