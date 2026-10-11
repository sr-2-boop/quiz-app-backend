import path from 'node:path';
import { env } from '../config/env.js';
import { Question, Test } from '../models/index.js';
import { blankIdsIn, questionImportFile, questionInput } from '../schemas/question.schemas.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { toPlain } from '../utils/serialize.js';
import { readTable } from '../utils/tableFile.js';
import { recomputeTestTotals } from './test.service.js';

const MAX_IMPORT_QUESTIONS = 500;

async function loadEditableTest(testId) {
  const test = await Test.findById(testId).lean();
  if (!test) throw notFound('Test not found');
  if (test.status === 'live' || test.status === 'ended') {
    throw conflict('TEST_LOCKED', 'Questions cannot be changed after a test has started');
  }
  return test;
}

function runGradingProblem(question) {
  if (question.type === 'debug' && question.grading === 'run' && !env.CODE_EXECUTION_ENABLED) {
    return 'code execution is disabled on this server (CODE_EXECUTION_ENABLED=false); use grading "answer"';
  }
  return null;
}

function assertGradable(question) {
  const problem = runGradingProblem(question);
  if (problem) throw badRequest(problem, 'CODE_EXECUTION_DISABLED');
}

/** Admin view: full questions (including solutions), in test order. */
export async function listQuestions(testId) {
  const test = await Test.findById(testId).select('questionOrder').lean();
  if (!test) throw notFound('Test not found');
  const questions = await Question.find({ testId }).lean();
  const position = new Map((test.questionOrder ?? []).map((id, i) => [String(id), i]));
  questions.sort((a, b) => (position.get(String(a._id)) ?? 1e9) - (position.get(String(b._id)) ?? 1e9));
  return toPlain(questions);
}

export async function getQuestion(testId, questionId) {
  const question = await Question.findOne({ _id: questionId, testId }).lean();
  if (!question) throw notFound('Question not found');
  return toPlain(question);
}

export async function createQuestion(testId, input) {
  await loadEditableTest(testId);
  assertGradable(input);
  const question = await Question.create({ ...input, testId });
  await Test.updateOne({ _id: testId }, { $push: { questionOrder: question._id } });
  await recomputeTestTotals(testId);
  return toPlain(question.toObject());
}

export async function updateQuestion(testId, questionId, input) {
  await loadEditableTest(testId);
  assertGradable(input);
  const question = await Question.findOne({ _id: questionId, testId });
  if (!question) throw notFound('Question not found');
  // Full replacement so fields from a previous type don't linger.
  question.overwrite({ ...input, testId: question.testId, createdAt: question.get('createdAt') });
  await question.save();
  await recomputeTestTotals(testId);
  return toPlain(question.toObject());
}

export async function deleteQuestion(testId, questionId) {
  await loadEditableTest(testId);
  const res = await Question.deleteOne({ _id: questionId, testId });
  if (res.deletedCount === 0) throw notFound('Question not found');
  await Test.updateOne({ _id: testId }, { $pull: { questionOrder: questionId } });
  await recomputeTestTotals(testId);
}

// ---- Bulk import ----------------------------------------------------------------------------

const OPTION_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];

function parseBool(value) {
  if (value === undefined || value === '') return undefined;
  const v = value.toLowerCase();
  if (['true', 'yes', 'y', '1'].includes(v)) return true;
  if (['false', 'no', 'n', '0'].includes(v)) return false;
  return value; // let the schema report it
}

function parseNumber(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}

/**
 * One spreadsheet row -> question input (mcq and fill_blank only).
 * Columns: type, statement, marks, negativeMarks, explanation, optionA..optionF, correct, multiSelect,
 * answers (blanks separated by ";" or new lines, alternatives by "|"), caseSensitive.
 * @returns {{ data: unknown } | { error: string }}
 */
export function spreadsheetRowToQuestion(values) {
  const type = (values.type ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const base = {
    type,
    statement: values.statement ?? '',
    marks: parseNumber(values.marks, undefined),
    negativeMarks: parseNumber(values.negativemarks, 0),
    explanation: values.explanation ?? '',
  };

  if (type === 'mcq') {
    const options = OPTION_LETTERS.map((l) => ({ id: l.toUpperCase(), text: values[`option${l}`] ?? '' })).filter((o) =>
      o.text.trim(),
    );
    const correct = (values.correct ?? '')
      .split(/[\s,;|]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const multiSelect = parseBool(values.multiselect);
    return { data: { ...base, options, correctOptionIds: correct, multiSelect: multiSelect ?? correct.length > 1 } };
  }

  if (type === 'fill_blank') {
    const ids = blankIdsIn(base.statement);
    const groups = (values.answers ?? '')
      .split(/\r?\n|;/)
      .map((g) =>
        g
          .split('|')
          .map((s) => s.trim())
          .filter(Boolean),
      )
      .filter((g) => g.length);
    if (groups.length !== ids.length) {
      return {
        error: `the statement has ${ids.length} blank(s) but "answers" has ${groups.length} group(s). Separate blanks with ";" and alternatives with "|"`,
      };
    }
    const caseSensitive = parseBool(values.casesensitive) ?? false;
    return { data: { ...base, blanks: ids.map((id, i) => ({ id, acceptedAnswers: groups[i], caseSensitive })) } };
  }

  return {
    error: type
      ? `type "${type}" is not supported in spreadsheets (use the JSON template for debug and snippet questions)`
      : 'type is required (mcq or fill_blank)',
  };
}

async function readCandidates(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.json') {
    let json;
    try {
      json = JSON.parse(file.buffer.toString('utf8').replace(/^\uFEFF/, ''));
    } catch {
      throw badRequest('The file is not valid JSON', 'INVALID_FILE');
    }
    const list = questionImportFile.safeParse(json);
    if (!list.success) throw badRequest('Expected an array of questions or { "questions": [...] }', 'INVALID_FILE');
    if (list.data.length > MAX_IMPORT_QUESTIONS) {
      throw badRequest(`Too many questions (max ${MAX_IMPORT_QUESTIONS})`, 'TOO_MANY_ROWS');
    }
    return list.data.map((data, i) => ({ row: i + 1, data }));
  }
  const { rows } = await readTable(file, { maxRows: MAX_IMPORT_QUESTIONS });
  return rows.map((r) => ({ row: r.rowNumber, ...spreadsheetRowToQuestion(r.values) }));
}

/**
 * Bulk import. mode=preview validates every row and saves nothing; mode=commit (after the admin confirms)
 * re-validates the same file and inserts the valid questions.
 */
export async function importQuestions(testId, file, { mode }) {
  await loadEditableTest(testId);
  const candidates = await readCandidates(file);

  const valid = [];
  const errors = [];
  for (const candidate of candidates) {
    if ('error' in candidate) {
      errors.push({ row: candidate.row, path: '', message: candidate.error });
      continue;
    }
    const parsed = questionInput.safeParse(candidate.data);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({ row: candidate.row, path: issue.path.join('.'), message: issue.message });
      }
      continue;
    }
    const problem = runGradingProblem(parsed.data);
    if (problem) {
      errors.push({ row: candidate.row, path: 'grading', message: problem });
      continue;
    }
    valid.push({ row: candidate.row, question: parsed.data });
  }

  const summary = {
    mode,
    totalRows: candidates.length,
    validRows: valid.length,
    invalidRows: candidates.length - valid.length,
    errors,
    preview: valid,
    imported: 0,
  };

  if (mode === 'commit' && valid.length > 0) {
    const created = await Question.insertMany(valid.map((v) => ({ ...v.question, testId })));
    await Test.updateOne({ _id: testId }, { $push: { questionOrder: { $each: created.map((q) => q._id) } } });
    await recomputeTestTotals(testId);
    summary.imported = created.length;
  }
  return summary;
}
