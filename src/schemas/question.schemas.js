import { z } from 'zod';
import { LANGUAGE_IDS } from '../sandbox/languages.js';

// Single source of truth for question shapes (admin input) and response shapes (participant input).

export const BLANK_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9_]{0,19})\s*\}\}/g;

/** Blank ids in the order they appear in a fill_blank statement. */
export function blankIdsIn(statement) {
  return [...String(statement).matchAll(BLANK_PATTERN)].map((m) => m[1]);
}

const optionId = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9_-]+$/, 'option ids may only contain letters, digits, _ and -');

const option = z.strictObject({
  id: optionId,
  text: z.string().trim().min(1, 'option text is required').max(5000),
});

const blankId = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,19}$/, 'blank ids look like b1, b2, answer_1');

const baseFields = {
  statement: z.string().trim().min(1, 'statement is required').max(20_000),
  marks: z.number().min(0).max(1000),
  negativeMarks: z.number().min(0).max(1000).default(0),
  explanation: z.string().max(20_000).default(''),
};

function checkOptions(q, ctx, { single }) {
  const ids = q.options.map((o) => o.id);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: 'custom', path: ['options'], message: 'option ids must be unique' });
  }
  const known = new Set(ids);
  if (new Set(q.correctOptionIds).size !== q.correctOptionIds.length) {
    ctx.addIssue({ code: 'custom', path: ['correctOptionIds'], message: 'must not repeat an option' });
  }
  for (const id of q.correctOptionIds) {
    if (!known.has(id)) {
      ctx.addIssue({ code: 'custom', path: ['correctOptionIds'], message: `"${id}" is not one of the options` });
    }
  }
  if (single && q.correctOptionIds.length !== 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['correctOptionIds'],
      message: 'single-answer questions need exactly one correct option',
    });
  }
}

export const mcqQuestion = z
  .strictObject({
    type: z.literal('mcq'),
    ...baseFields,
    options: z.array(option).min(2, 'at least two options').max(10),
    correctOptionIds: z.array(optionId).min(1, 'at least one correct option'),
    multiSelect: z.boolean().default(false),
  })
  .superRefine((q, ctx) => checkOptions(q, ctx, { single: !q.multiSelect }));

export const fillBlankQuestion = z
  .strictObject({
    type: z.literal('fill_blank'),
    ...baseFields,
    blanks: z
      .array(
        z.strictObject({
          id: blankId,
          acceptedAnswers: z.array(z.string().trim().min(1).max(500)).min(1, 'at least one accepted answer').max(50),
          caseSensitive: z.boolean().default(false),
        }),
      )
      .min(1, 'at least one blank')
      .max(50),
  })
  .superRefine((q, ctx) => {
    const inStatement = blankIdsIn(q.statement);
    const configured = q.blanks.map((b) => b.id);
    if (new Set(inStatement).size !== inStatement.length) {
      ctx.addIssue({ code: 'custom', path: ['statement'], message: 'each blank may appear only once' });
    }
    if (new Set(configured).size !== configured.length) {
      ctx.addIssue({ code: 'custom', path: ['blanks'], message: 'blank ids must be unique' });
    }
    const missing = inStatement.filter((id) => !configured.includes(id));
    const unused = configured.filter((id) => !inStatement.includes(id));
    if (missing.length) {
      ctx.addIssue({ code: 'custom', path: ['blanks'], message: `no answers configured for: ${missing.join(', ')}` });
    }
    if (unused.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['blanks'],
        message: `not used in the statement (add {{${unused[0]}}}): ${unused.join(', ')}`,
      });
    }
  });

export const debugQuestion = z
  .strictObject({
    type: z.literal('debug'),
    ...baseFields,
    language: z.enum(LANGUAGE_IDS),
    code: z.string().min(1, 'buggy code is required').max(50_000),
    grading: z.enum(['answer', 'run']),
    acceptedFixes: z.array(z.string().trim().min(1).max(20_000)).max(20).optional(),
    testCases: z
      .array(
        z.strictObject({
          input: z.string().max(100_000).default(''),
          expectedOutput: z.string().max(100_000),
          hidden: z.boolean().default(false),
          weight: z.number().positive().max(1000).default(1),
        }),
      )
      .max(50)
      .optional(),
    fixedCode: z.string().max(50_000).optional(),
    allOrNothing: z.boolean().default(false),
  })
  .superRefine((q, ctx) => {
    if (q.grading === 'answer' && !q.acceptedFixes?.length) {
      ctx.addIssue({ code: 'custom', path: ['acceptedFixes'], message: 'at least one accepted fix is required' });
    }
    if (q.grading === 'run') {
      if (!q.testCases?.length) {
        ctx.addIssue({ code: 'custom', path: ['testCases'], message: 'at least one test case is required' });
      }
      if (!q.fixedCode?.trim()) {
        ctx.addIssue({ code: 'custom', path: ['fixedCode'], message: 'reference fixed code is required' });
      }
    }
  });

export const snippetQuestion = z
  .strictObject({
    type: z.literal('snippet'),
    ...baseFields,
    language: z.enum(LANGUAGE_IDS),
    code: z.string().min(1, 'code snippet is required').max(50_000),
    answerMode: z.enum(['text', 'mcq']).default('text'),
    expectedOutput: z.string().max(20_000).optional(),
    options: z.array(option).min(2).max(10).optional(),
    correctOptionIds: z.array(optionId).optional(),
  })
  .superRefine((q, ctx) => {
    if (q.answerMode === 'text' && q.expectedOutput === undefined) {
      ctx.addIssue({ code: 'custom', path: ['expectedOutput'], message: 'expected output is required' });
    }
    if (q.answerMode === 'mcq') {
      if (!q.options?.length || !q.correctOptionIds) {
        ctx.addIssue({ code: 'custom', path: ['options'], message: 'options and correctOptionIds are required' });
        return;
      }
      checkOptions(/** @type {any} */ (q), ctx, { single: true });
    }
  });

export const questionInput = z.discriminatedUnion('type', [
  mcqQuestion,
  fillBlankQuestion,
  debugQuestion,
  snippetQuestion,
]);

export const questionImportFile = z.union([
  z.array(z.unknown()),
  z.object({ questions: z.array(z.unknown()) }).transform((v) => v.questions),
]);

// ---------------------------------------------------------------------------------------------
// Participant responses. Shapes: mcq {selected}, fill_blank {values}, debug {code}|{answer}, snippet {answer}

export const saveAnswerBody = z.strictObject({
  response: z.unknown(),
  timeSpentMs: z
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60 * 1000)
    .optional(),
});

/**
 * Build the response schema for one question (it depends on the question's options/blanks).
 * @param {any} question lean Question document
 */
export function responseSchemaFor(question) {
  switch (question.type) {
    case 'mcq': {
      const ids = new Set(question.options.map((o) => o.id));
      return z
        .strictObject({ selected: z.array(z.string().max(20)).max(question.options.length) })
        .superRefine((r, ctx) => {
          if (new Set(r.selected).size !== r.selected.length) {
            ctx.addIssue({ code: 'custom', path: ['selected'], message: 'duplicate option' });
          }
          if (r.selected.some((id) => !ids.has(id))) {
            ctx.addIssue({ code: 'custom', path: ['selected'], message: 'unknown option' });
          }
          if (!question.multiSelect && r.selected.length > 1) {
            ctx.addIssue({ code: 'custom', path: ['selected'], message: 'select at most one option' });
          }
        });
    }
    case 'fill_blank': {
      const ids = new Set(question.blanks.map((b) => b.id));
      return z.strictObject({ values: z.record(blankId, z.string().max(500)) }).superRefine((r, ctx) => {
        if (Object.keys(r.values).some((id) => !ids.has(id))) {
          ctx.addIssue({ code: 'custom', path: ['values'], message: 'unknown blank' });
        }
      });
    }
    case 'debug':
      return question.grading === 'run'
        ? z.strictObject({ code: z.string().max(50_000) })
        : z.strictObject({ answer: z.string().max(20_000) });
    case 'snippet': {
      if (question.answerMode === 'mcq') {
        const ids = new Set(question.options.map((o) => o.id));
        return z.strictObject({
          answer: z.string().refine((v) => v === '' || ids.has(v), 'unknown option'),
        });
      }
      return z.strictObject({ answer: z.string().max(20_000) });
    }
    default:
      throw new Error(`Unknown question type: ${question.type}`);
  }
}

export const runCodeBody = z.strictObject({
  questionId: z.string().regex(/^[a-f\d]{24}$/i, 'must be a valid id'),
  code: z.string().min(1).max(50_000),
});
