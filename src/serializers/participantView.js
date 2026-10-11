// Everything a participant receives about questions goes through these functions.
// They build new objects from an explicit whitelist; never spread a question document here.
// Stripped while a test is live: correctOptionIds, acceptedAnswers, acceptedFixes, fixedCode,
// expectedOutput (snippet), hidden test cases, explanation.

function orderedOptions(options, optionOrder) {
  const list = (options ?? []).map((o) => ({ id: o.id, text: o.text }));
  if (!optionOrder?.length) return list;
  const byId = new Map(list.map((o) => [o.id, o]));
  const ordered = optionOrder.map((id) => byId.get(id)).filter(Boolean);
  // Keep any option added after the attempt started (should not happen once a test is live).
  for (const o of list) if (!optionOrder.includes(o.id)) ordered.push(o);
  return ordered;
}

/**
 * Question as a participant sees it while answering.
 * @param {any} question lean Question document
 * @param {{ optionOrder?: string[] }} [layout]
 */
export function toParticipantView(question, layout = {}) {
  const view = {
    id: String(question._id),
    type: question.type,
    statement: question.statement,
    marks: question.marks,
    negativeMarks: question.negativeMarks ?? 0,
  };

  switch (question.type) {
    case 'mcq':
      view.multiSelect = Boolean(question.multiSelect);
      view.options = orderedOptions(question.options, layout.optionOrder);
      break;
    case 'fill_blank':
      view.blanks = question.blanks.map((b) => ({ id: b.id }));
      break;
    case 'debug':
      view.language = question.language;
      view.code = question.code;
      view.grading = question.grading;
      if (question.grading === 'run') {
        view.sampleTestCases = (question.testCases ?? [])
          .filter((tc) => !tc.hidden)
          .map((tc) => ({ input: tc.input, expectedOutput: tc.expectedOutput }));
      }
      break;
    case 'snippet':
      view.language = question.language;
      view.code = question.code;
      view.answerMode = question.answerMode ?? 'text';
      if (view.answerMode === 'mcq') view.options = orderedOptions(question.options, layout.optionOrder);
      break;
    default:
      throw new Error(`Unknown question type: ${question.type}`);
  }
  return view;
}

/**
 * A saved answer as returned during an attempt. Correctness is included only in "immediate" feedback mode.
 * @param {any} answer
 * @param {{ revealCorrectness: boolean }} options
 */
export function toParticipantAnswer(answer, { revealCorrectness }) {
  const out = {
    questionId: String(answer.questionId),
    response: answer.response ?? null,
    answered: Boolean(answer.answered),
    savedAt: answer.answeredAt ?? null,
    timeSpentMs: answer.timeSpentMs ?? 0,
  };
  if (revealCorrectness) {
    out.status = answer.status;
    out.isCorrect = answer.status === 'graded' ? Boolean(answer.isCorrect) : null;
    out.marksAwarded = answer.status === 'graded' ? answer.marksAwarded : null;
  }
  return out;
}

/** The correct answer for one question, revealed only once feedback is allowed (after submit / after test). */
export function toCorrectAnswer(question) {
  switch (question.type) {
    case 'mcq':
      return { correctOptionIds: [...question.correctOptionIds] };
    case 'fill_blank':
      return { blanks: question.blanks.map((b) => ({ id: b.id, acceptedAnswers: [...b.acceptedAnswers] })) };
    case 'debug':
      // Hidden test cases are never revealed, even after the test.
      return question.grading === 'run'
        ? { fixedCode: question.fixedCode ?? '' }
        : { acceptedFixes: [...(question.acceptedFixes ?? [])] };
    case 'snippet':
      return question.answerMode === 'mcq'
        ? { correctOptionIds: [...question.correctOptionIds] }
        : { expectedOutput: question.expectedOutput ?? '' };
    default:
      return {};
  }
}

/**
 * Per-question feedback for the participant's own result page.
 * @param {any} question
 * @param {any | undefined} answer
 */
export function toParticipantFeedback(question, answer) {
  const feedback = {
    questionId: String(question._id),
    response: answer?.response ?? null,
    answered: Boolean(answer?.answered),
    status: answer ? answer.status : 'graded',
    isCorrect: answer?.status === 'graded' ? Boolean(answer.isCorrect) : answer ? null : false,
    marksAwarded: answer?.status === 'graded' ? answer.marksAwarded : answer ? null : 0,
    correctAnswer: toCorrectAnswer(question),
    explanation: question.explanation ?? '',
  };
  if (question.type === 'debug' && question.grading === 'run' && answer?.totalCases != null) {
    feedback.passedCases = answer.passedCases ?? 0;
    feedback.totalCases = answer.totalCases;
  }
  return feedback;
}
