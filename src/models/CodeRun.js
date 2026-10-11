import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

// Audit/debug log of sandbox executions. stdout/stderr are truncated before saving.
const codeRunSchema = new mongoose.Schema(
  {
    attemptId: { type: ObjectId, ref: 'Attempt', required: true, index: true },
    questionId: { type: ObjectId, ref: 'Question', required: true },
    language: { type: String, required: true },
    kind: { type: String, enum: ['sample', 'graded'], required: true },
    verdict: { type: String, required: true },
    passedCases: { type: Number, default: 0 },
    totalCases: { type: Number, default: 0 },
    stdout: { type: String, default: '' },
    stderr: { type: String, default: '' },
    timeMs: { type: Number, default: null },
    memoryKb: { type: Number, default: null },
  },
  { timestamps: true },
);

export const CodeRun = mongoose.model('CodeRun', codeRunSchema);
