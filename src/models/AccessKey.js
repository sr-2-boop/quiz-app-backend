import mongoose from 'mongoose';

const accessKeySchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    keyHash: { type: String, required: true, select: false },
    validFrom: { type: Date, required: true },
    validUntil: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: String, required: true },
  },
  { timestamps: true },
);

accessKeySchema.index({ isActive: 1, validFrom: 1, validUntil: 1 });

export const AccessKey = mongoose.model('AccessKey', accessKeySchema);
