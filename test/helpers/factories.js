import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { AccessKey, Participant, Question, Test } from '../../src/models/index.js';
import { clearAccessKeyCache } from '../../src/services/auth.service.js';
import { COOKIE_NAME, signToken } from '../../src/services/token.service.js';

const HOUR = 60 * 60 * 1000;

export const ADMIN_EMAIL = 'admin@uni.edu';

export async function createParticipant(overrides = {}) {
  return Participant.create({
    urn: 'E25B002749',
    name: 'Asha Verma',
    mobile: '9876543210',
    section: 'A',
    ...overrides,
  });
}

export async function createAccessKey(key = 'K7Q2', overrides = {}) {
  clearAccessKeyCache();
  return AccessKey.create({
    label: 'Day 1',
    keyHash: await bcrypt.hash(key, 4),
    validFrom: new Date(Date.now() - HOUR),
    validUntil: new Date(Date.now() + HOUR),
    createdBy: ADMIN_EMAIL,
    ...overrides,
  });
}

export function adminCookie(email = ADMIN_EMAIL) {
  const { token } = signToken({ sub: email, role: 'admin', sid: randomUUID() });
  return `${COOKIE_NAME}=${token}`;
}

/** Give the participant an active session and return a matching auth cookie. */
export async function participantCookie(participant) {
  const sid = randomUUID();
  await Participant.updateOne({ _id: participant._id }, { activeSessionId: sid });
  const { token } = signToken({ sub: String(participant._id), role: 'participant', sid });
  return `${COOKIE_NAME}=${token}`;
}

export const sampleQuestions = {
  mcq: {
    type: 'mcq',
    statement: 'Which structure is LIFO?',
    marks: 2,
    negativeMarks: 1,
    options: [
      { id: 'A', text: 'Queue' },
      { id: 'B', text: 'Stack' },
      { id: 'C', text: 'Heap' },
    ],
    correctOptionIds: ['B'],
    multiSelect: false,
    explanation: 'Stacks pop the newest element.',
  },
  fillBlank: {
    type: 'fill_blank',
    statement: 'Capital of France is {{b1}}; 2+2 = {{b2}}.',
    marks: 2,
    negativeMarks: 0,
    blanks: [
      { id: 'b1', acceptedAnswers: ['Paris'], caseSensitive: false },
      { id: 'b2', acceptedAnswers: ['4', 'four'], caseSensitive: false },
    ],
    explanation: 'Geography and arithmetic.',
  },
  debug: {
    type: 'debug',
    statement: 'Fix the accumulator line.',
    marks: 3,
    negativeMarks: 0,
    language: 'python',
    code: 'for x in xs:\n    s = x',
    grading: 'answer',
    acceptedFixes: ['s += x', 's = s + x'],
    explanation: 'Add, do not assign.',
  },
  snippet: {
    type: 'snippet',
    statement: 'What does this print?',
    marks: 1,
    negativeMarks: 0,
    language: 'javascript',
    code: 'console.log(1 + 1)',
    answerMode: 'text',
    expectedOutput: '2',
    explanation: 'One plus one.',
  },
  debugRun: {
    type: 'debug',
    statement: 'Fix the sum program.',
    marks: 4,
    negativeMarks: 0,
    language: 'python',
    code: 'a, b = input().split()\nprint(a + b)',
    grading: 'run',
    testCases: [
      { input: '2 3', expectedOutput: '5', hidden: false, weight: 1 },
      { input: '10 -4', expectedOutput: '6', hidden: true, weight: 1 },
    ],
    fixedCode: 'a, b = map(int, input().split())\nprint(a + b)',
    allOrNothing: false,
    explanation: 'Convert to int.',
  },
};

/** A test plus questions (mcq, fill_blank, debug, snippet by default). */
export async function createTestWithQuestions({
  status = 'live',
  settings = {},
  questions = [sampleQuestions.mcq, sampleQuestions.fillBlank, sampleQuestions.debug, sampleQuestions.snippet],
  ...overrides
} = {}) {
  const test = await Test.create({
    title: 'Round 1',
    description: 'Warm-up round',
    status,
    startsAt: status === 'live' ? new Date(Date.now() - 60_000) : null,
    durationMinutes: 30,
    createdBy: ADMIN_EMAIL,
    settings,
    ...overrides,
  });
  const created = await Question.insertMany(questions.map((q) => ({ ...q, testId: test._id })));
  test.questionOrder = created.map((q) => q._id);
  test.totalMarks = created.reduce((s, q) => s + q.marks, 0);
  await test.save();
  return { test, questions: created };
}
