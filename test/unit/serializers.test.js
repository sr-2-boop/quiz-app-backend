import { describe, expect, it } from 'vitest';
import { toCorrectAnswer, toParticipantAnswer, toParticipantView } from '../../src/serializers/participantView.js';
import { sampleQuestions } from '../helpers/factories.js';
import { allKeys } from '../helpers/leaks.js';

const withId = (q) => ({ _id: '65f000000000000000000001', testId: 'x', ...q });

describe('toParticipantView strips solutions', () => {
  const ALWAYS_FORBIDDEN = [
    'correctOptionIds',
    'acceptedAnswers',
    'acceptedFixes',
    'fixedCode',
    'explanation',
    'testCases',
    'hidden',
    'testId',
  ];

  for (const [name, question] of Object.entries(sampleQuestions)) {
    it(`${name}: no correct answers, solutions, hidden cases or explanations`, () => {
      const view = toParticipantView(withId(question));
      const keys = allKeys(view);
      for (const key of ALWAYS_FORBIDDEN) expect(keys.has(key), `${name} leaks ${key}`).toBe(false);
    });
  }

  it('never exposes the expected output of snippet questions', () => {
    expect(allKeys(toParticipantView(withId(sampleQuestions.snippet))).has('expectedOutput')).toBe(false);
  });

  it('includes only visible sample cases for run-graded debug questions', () => {
    const view = toParticipantView(withId(sampleQuestions.debugRun));
    expect(view.sampleTestCases).toEqual([{ input: '2 3', expectedOutput: '5' }]);
    expect(JSON.stringify(view)).not.toContain('10 -4');
  });

  it('only exposes blank ids for fill_blank', () => {
    expect(toParticipantView(withId(sampleQuestions.fillBlank)).blanks).toEqual([{ id: 'b1' }, { id: 'b2' }]);
  });

  it('applies the per-attempt option order', () => {
    const view = toParticipantView(withId(sampleQuestions.mcq), { optionOrder: ['C', 'A', 'B'] });
    expect(view.options.map((o) => o.id)).toEqual(['C', 'A', 'B']);
  });
});

describe('toParticipantAnswer', () => {
  const answer = {
    questionId: 'q1',
    response: { selected: ['A'] },
    answered: true,
    status: 'graded',
    isCorrect: false,
    marksAwarded: -1,
  };

  it('hides correctness unless instant feedback is on', () => {
    expect(toParticipantAnswer(answer, { revealCorrectness: false })).not.toHaveProperty('isCorrect');
    expect(toParticipantAnswer(answer, { revealCorrectness: true })).toMatchObject({
      isCorrect: false,
      marksAwarded: -1,
    });
  });
});

describe('toCorrectAnswer', () => {
  it('never reveals hidden test cases', () => {
    const answer = toCorrectAnswer(withId(sampleQuestions.debugRun));
    expect(answer).toEqual({ fixedCode: sampleQuestions.debugRun.fixedCode });
  });
});
