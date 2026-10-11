import mongoose from 'mongoose';

export const TEST_STATUSES = ['draft', 'published', 'live', 'ended'];
export const FEEDBACK_MODES = ['immediate', 'after_submit', 'after_test'];

const settingsSchema = new mongoose.Schema(
  {
    shuffleQuestions: { type: Boolean, default: false },
    shuffleOptions: { type: Boolean, default: false },
    feedbackMode: { type: String, enum: FEEDBACK_MODES, default: 'after_submit' },
    liveScoreVisible: { type: Boolean, default: true },
    leaderboardVisibleToParticipants: { type: Boolean, default: false },
    maxAttempts: { type: Number, default: 1, min: 1 },
    // Admin toggle: unlimited retakes while the test is open (the latest attempt counts).
    allowRetakes: { type: Boolean, default: false },
  },
  { _id: false },
);

const testSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    status: { type: String, enum: TEST_STATUSES, default: 'draft' },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    durationMinutes: { type: Number, required: true, min: 1 },
    allowedSections: { type: [String], default: [] },
    questionOrder: { type: [mongoose.Schema.Types.ObjectId], ref: 'Question', default: [] },
    totalMarks: { type: Number, default: 0 },
    settings: { type: settingsSchema, default: () => ({}) },
    createdBy: { type: String, required: true },
  },
  { timestamps: true },
);

testSchema.index({ status: 1, startsAt: 1 });
testSchema.index({ status: 1, endsAt: 1 });

export const Test = mongoose.model('Test', testSchema);
