import mongoose from 'mongoose';

export const QUESTION_TYPES = ['mcq', 'fill_blank', 'debug', 'snippet'];

// One collection for all four types. The Zod union in src/schemas/question.schemas.js is the
// source of truth for which fields each type carries; type-specific arrays default to undefined
// so documents only store the fields their type uses.
const optionSchema = new mongoose.Schema(
  { id: { type: String, required: true }, text: { type: String, required: true } },
  { _id: false },
);

const blankSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    acceptedAnswers: { type: [String], default: [] },
    caseSensitive: { type: Boolean, default: false },
  },
  { _id: false },
);

const testCaseSchema = new mongoose.Schema({
  input: { type: String, default: '' },
  expectedOutput: { type: String, default: '' },
  hidden: { type: Boolean, default: false },
  weight: { type: Number, default: 1 },
});

const questionSchema = new mongoose.Schema(
  {
    testId: { type: mongoose.Schema.Types.ObjectId, ref: 'Test', required: true, index: true },
    type: { type: String, enum: QUESTION_TYPES, required: true },
    statement: { type: String, required: true },
    marks: { type: Number, required: true, min: 0 },
    negativeMarks: { type: Number, default: 0, min: 0 },
    explanation: { type: String, default: '' },

    // mcq, and snippet in answerMode "mcq"
    options: { type: [optionSchema], default: undefined },
    correctOptionIds: { type: [String], default: undefined },
    multiSelect: { type: Boolean },

    // fill_blank
    blanks: { type: [blankSchema], default: undefined },

    // debug + snippet
    language: { type: String },
    code: { type: String },

    // debug
    grading: { type: String, enum: ['answer', 'run'] },
    acceptedFixes: { type: [String], default: undefined },
    testCases: { type: [testCaseSchema], default: undefined },
    fixedCode: { type: String },
    allOrNothing: { type: Boolean },

    // snippet
    answerMode: { type: String, enum: ['text', 'mcq'] },
    expectedOutput: { type: String },
  },
  { timestamps: true },
);

export const Question = mongoose.model('Question', questionSchema);
