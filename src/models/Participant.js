import mongoose from 'mongoose';

const participantSchema = new mongoose.Schema(
  {
    urn: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    mobile: { type: String, required: true, trim: true },
    section: { type: String, default: '', trim: true, index: true },
    isActive: { type: Boolean, default: true },
    activeSessionId: { type: String, default: null },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const Participant = mongoose.model('Participant', participantSchema);
