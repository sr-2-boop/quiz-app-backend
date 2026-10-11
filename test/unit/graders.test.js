import { describe, expect, it } from 'vitest';
import { gradeAnswer, scoreRunResults } from '../../src/grading/index.js';
import { normalizeAnswer, normalizeCode, normalizeOutput } from '../../src/grading/normalize.js';
import { sampleQuestions } from '../helpers/factories.js';

describe('normalizers', () => {
  it('normalizes short answers', () => {
    expect(normalizeAnswer('  New   York ')).toBe('new york');
    expect(normalizeAnswer(' New York', { caseSensitive: true })).toBe('New York');
  });

  it('normalizes program output', () => {
    expect(normalizeOutput('a  \r\nb\t\r\n\n')).toBe('a\nb');
  });

  it('normalizes code but keeps relative indentation and case', () => {
    expect(normalizeCode('\n  s  +=   x  \r\n\n')).toBe('s += x');
    expect(normalizeCode('    if x:\n        y()')).toBe('if x:\n    y()');
    expect(normalizeCode('S += x')).not.toBe(normalizeCode('s += x'));
    expect(normalizeCode('')).toBe('');
  });
});

describe('mcq grader', () => {
  const q = sampleQuestions.mcq;

  it('awards marks for the exact correct set', () => {
    expect(gradeAnswer(q, { selected: ['B'] })).toEqual({
      status: 'graded',
      answered: true,
      isCorrect: true,
      marksAwarded: 2,
    });
  });

  it('applies negative marks for a wrong answer', () => {
    expect(gradeAnswer(q, { selected: ['A'] })).toMatchObject({ isCorrect: false, marksAwarded: -1 });
  });

  it('scores unanswered as 0 without negative marks', () => {
    expect(gradeAnswer(q, { selected: [] })).toEqual({
      status: 'graded',
      answered: false,
      isCorrect: false,
      marksAwarded: 0,
    });
  });

  it('requires an exact set match for multi-select', () => {
    const multi = { ...q, multiSelect: true, correctOptionIds: ['A', 'C'] };
    expect(gradeAnswer(multi, { selected: ['C', 'A'] }).isCorrect).toBe(true);
    expect(gradeAnswer(multi, { selected: ['A'] }).isCorrect).toBe(false);
    expect(gradeAnswer(multi, { selected: ['A', 'B', 'C'] }).isCorrect).toBe(false);
  });
});

describe('fill_blank grader', () => {
  const q = sampleQuestions.fillBlank;

  it('matches any accepted answer after normalization', () => {
    expect(gradeAnswer(q, { values: { b1: '  paris ', b2: 'FOUR' } })).toMatchObject({
      isCorrect: true,
      marksAwarded: 2,
    });
  });

  it('splits marks equally across blanks', () => {
    expect(gradeAnswer(q, { values: { b1: 'Paris', b2: '5' } })).toMatchObject({ isCorrect: false, marksAwarded: 1 });
  });

  it('respects caseSensitive', () => {
    const cs = { ...q, blanks: [{ id: 'b1', acceptedAnswers: ['Paris'], caseSensitive: true }], statement: '{{b1}}' };
    expect(gradeAnswer(cs, { values: { b1: 'paris' } }).isCorrect).toBe(false);
    expect(gradeAnswer(cs, { values: { b1: 'Paris' } }).isCorrect).toBe(true);
  });

  it('applies negative marks only when every answered blank is wrong', () => {
    const neg = { ...q, negativeMarks: 0.5 };
    expect(gradeAnswer(neg, { values: { b1: 'Rome' } }).marksAwarded).toBe(-0.5);
    expect(gradeAnswer(neg, { values: {} })).toMatchObject({ answered: false, marksAwarded: 0 });
  });
});

describe('debug grader', () => {
  it('matches accepted fixes with normalized whitespace', () => {
    expect(gradeAnswer(sampleQuestions.debug, { answer: '  s  +=  x ' }).isCorrect).toBe(true);
    expect(gradeAnswer(sampleQuestions.debug, { answer: 's = x' }).isCorrect).toBe(false);
  });

  it('marks run-graded answers as pending', () => {
    expect(gradeAnswer(sampleQuestions.debugRun, { code: 'print(1)' }).status).toBe('pending');
    expect(gradeAnswer(sampleQuestions.debugRun, { code: '   ' })).toMatchObject({ status: 'graded', answered: false });
  });

  it('scores run results by passed weights', () => {
    const q = { ...sampleQuestions.debugRun, marks: 4 };
    expect(
      scoreRunResults(q, [
        { passed: true, weight: 1 },
        { passed: false, weight: 3 },
      ]).marksAwarded,
    ).toBe(1);
    expect(
      scoreRunResults(q, [
        { passed: true, weight: 1 },
        { passed: true, weight: 3 },
      ]),
    ).toMatchObject({ isCorrect: true, marksAwarded: 4 });
  });

  it('supports all-or-nothing run grading', () => {
    const q = { ...sampleQuestions.debugRun, marks: 4, allOrNothing: true };
    expect(scoreRunResults(q, [{ passed: true }, { passed: false }]).marksAwarded).toBe(0);
    expect(scoreRunResults(q, [{ passed: true }, { passed: true }]).marksAwarded).toBe(4);
  });
});

describe('snippet grader', () => {
  it('compares normalized output text', () => {
    expect(gradeAnswer(sampleQuestions.snippet, { answer: ' 2 \r\n' }).isCorrect).toBe(true);
    expect(gradeAnswer(sampleQuestions.snippet, { answer: '3' }).isCorrect).toBe(false);
    expect(gradeAnswer(sampleQuestions.snippet, { answer: '' }).answered).toBe(false);
  });

  it('grades option answers in mcq mode', () => {
    const q = {
      ...sampleQuestions.snippet,
      answerMode: 'mcq',
      options: [
        { id: 'A', text: '2' },
        { id: 'B', text: '11' },
      ],
      correctOptionIds: ['A'],
    };
    expect(gradeAnswer(q, { answer: 'A' }).isCorrect).toBe(true);
    expect(gradeAnswer(q, { answer: 'B' }).isCorrect).toBe(false);
  });
});

describe('grading is idempotent', () => {
  it('returns the same result for the same input', () => {
    const r = { values: { b1: 'Paris', b2: '4' } };
    expect(gradeAnswer(sampleQuestions.fillBlank, r)).toEqual(gradeAnswer(sampleQuestions.fillBlank, r));
  });
});
