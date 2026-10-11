import mongoose from 'mongoose';

const { ObjectId, Mixed } = mongoose.Schema.Types;

export const ATTEMPT_STATUSES = ['in_progress', 'submitted', 'auto_submitted'];

const answerSchema = new mongoose.Schema(
  {
    questionId: { type: ObjectId, required: true },
    response: { type: Mixed },
    status: { type: String, enum: ['pending', 'graded'], default: 'graded' },
    answered: { type: Boolean, default: false },
    isCorrect: { type: Boolean, default: false },
    marksAwarded: { type: Number, default: 0 },
    answeredAt: { type: Date },
    timeSpentMs: { type: Number, default: 0 },
    // code-run grading only
    passedCases: { type: Number },
    totalCases: { type: Number },
    gradingAttempts: { type: Number, default: 0 },
    gradingError: { type: String },
  },
  { _id: false },
);

// Per-attempt question order (and option order when shuffling), fixed at start so a refresh resumes identically.
const layoutSchema = new mongoose.Schema(
  {
    questionId: { type: ObjectId, required: true },
    optionOrder: { type: [String], default: undefined },
  },
  { _id: false },
);

const historySchema = new mongoose.Schema(
  {
    attemptNumber: Number,
    status: String,
    score: Number,
    startedAt: Date,
    submittedAt: Date,
    timeTakenMs: Number,
  },
  { _id: false },
);

const attemptSchema = new mongoose.Schema(
  {
    testId: { type: ObjectId, ref: 'Test', required: true },
    participantId: { type: ObjectId, ref: 'Participant', required: true },
    // Snapshot of roster fields for admin leaderboards/exports (never sent to other participants).
    urn: { type: String, required: true },
    name: { type: String, required: true },
    section: { type: String, default: '' },

    attemptNumber: { type: Number, default: 1 },
    startedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    submittedAt: { type: Date, default: null },
    status: { type: String, enum: ATTEMPT_STATUSES, default: 'in_progress' },
    layout: { type: [layoutSchema], default: [] },
    answers: { type: [answerSchema], default: [] },
    score: { type: Number, default: 0 },
    timeTakenMs: { type: Number, default: null },
    // Earlier attempts when retakes are allowed (maxAttempts > 1 or allowRetakes); the latest attempt counts.
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true },
);

attemptSchema.index({ testId: 1, participantId: 1 }, { unique: true });
attemptSchema.index({ status: 1, expiresAt: 1 });

export const Attempt = mongoose.model('Attempt', attemptSchema);
