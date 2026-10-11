import { z } from 'zod';
import { FEEDBACK_MODES } from '../models/Test.js';
import { dateInput, nullableDate, objectId } from './common.js';

// ---- Participants ---------------------------------------------------------------------------

export const participantListQuery = z.strictObject({
  search: z.string().trim().max(100).optional(),
  section: z.string().trim().max(40).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const participantUpdateBody = z
  .strictObject({
    name: z.string().trim().min(1).max(120).optional(),
    mobile: z.string().trim().min(1).max(32).optional(),
    section: z.string().trim().max(40).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'nothing to update');

export const importModeQuery = z.strictObject({
  mode: z.enum(['preview', 'commit']).default('preview'),
});

// ---- Access keys ----------------------------------------------------------------------------

const accessKeyValue = z.string().regex(/^[A-Za-z0-9]{4,32}$/, 'keys are 4-32 letters or digits');

export const accessKeyCreateBody = z
  .strictObject({
    label: z.string().trim().min(1).max(100),
    key: accessKeyValue.optional(),
    validFrom: dateInput,
    validUntil: dateInput,
  })
  .refine((v) => v.validUntil > v.validFrom, { path: ['validUntil'], message: 'must be after validFrom' });

export const accessKeyRotateBody = z.strictObject({ key: accessKeyValue.optional() });

export const accessKeyUpdateBody = z
  .strictObject({
    label: z.string().trim().min(1).max(100).optional(),
    validFrom: dateInput.optional(),
    validUntil: dateInput.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'nothing to update');

// ---- Tests ----------------------------------------------------------------------------------

const settings = z.strictObject({
  shuffleQuestions: z.boolean().optional(),
  shuffleOptions: z.boolean().optional(),
  feedbackMode: z.enum(FEEDBACK_MODES).optional(),
  liveScoreVisible: z.boolean().optional(),
  leaderboardVisibleToParticipants: z.boolean().optional(),
  maxAttempts: z.number().int().min(1).max(20).optional(),
});

const testFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10_000),
  startsAt: nullableDate,
  endsAt: nullableDate,
  durationMinutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
  allowedSections: z.array(z.string().trim().min(1).max(40)).max(200),
  settings,
};

function windowIsValid(v) {
  return !(v.startsAt && v.endsAt && v.endsAt <= v.startsAt);
}

export const testCreateBody = z
  .strictObject({
    title: testFields.title,
    description: testFields.description.default(''),
    startsAt: testFields.startsAt.default(null),
    endsAt: testFields.endsAt.default(null),
    durationMinutes: testFields.durationMinutes,
    allowedSections: testFields.allowedSections.default([]),
    settings: settings.default({}),
  })
  .refine(windowIsValid, { path: ['endsAt'], message: 'must be after startsAt' });

export const testUpdateBody = z
  .strictObject({
    title: testFields.title.optional(),
    description: testFields.description.optional(),
    startsAt: testFields.startsAt.optional(),
    endsAt: testFields.endsAt.optional(),
    durationMinutes: testFields.durationMinutes.optional(),
    allowedSections: testFields.allowedSections.optional(),
    settings: settings.optional(),
  })
  .refine(windowIsValid, { path: ['endsAt'], message: 'must be after startsAt' });

export const reorderBody = z.strictObject({ questionOrder: z.array(objectId).max(1000) });

export const testQuestionParams = z.strictObject({ id: objectId, qid: objectId });

export const testAttemptParams = z.strictObject({ id: objectId, attemptId: objectId });

export const sectionQuery = z.strictObject({
  section: z.string().trim().max(40).optional(),
});

export const exportQuery = sectionQuery;
