import { z } from 'zod';
import { env } from '../config/env.js';
import { Participant } from '../models/index.js';
import { disconnectUserSockets } from '../sockets/hub.js';
import { badRequest, notFound } from '../utils/errors.js';
import { normalizeMobile, normalizeUrn } from '../utils/normalize.js';
import { toPlain } from '../utils/serialize.js';
import { readTable } from '../utils/tableFile.js';

const MAX_ROSTER_ROWS = 10_000;
const PREVIEW_ROWS = 200;

const rosterRow = z.object({
  urn: z
    .string()
    .transform(normalizeUrn)
    .refine((v) => env.URN_REGEX.test(v), 'URN format is invalid'),
  name: z.string().trim().min(1, 'name is required').max(120),
  mobile: z
    .string()
    .transform(normalizeMobile)
    .refine((v) => env.MOBILE_REGEX.test(v), 'mobile number is invalid'),
  section: z.string().trim().max(40).default(''),
});

/**
 * Roster import (xlsx/csv with columns URN, Name, Mobile, Section). Upserts by URN, validates every row,
 * reports row-level errors and never deletes participants missing from the file.
 * mode=preview only validates; mode=commit writes the valid rows.
 */
export async function importRoster(file, { mode }) {
  const { headers, rows } = await readTable(file, { maxRows: MAX_ROSTER_ROWS });
  const missing = ['urn', 'name', 'mobile'].filter((h) => !headers.includes(h));
  if (missing.length) {
    throw badRequest(
      `Missing column(s): ${missing.join(', ')}. Expected: URN, Name, Mobile, Section`,
      'INVALID_COLUMNS',
    );
  }

  const errors = [];
  const valid = [];
  const seen = new Map();
  for (const { rowNumber, values } of rows) {
    const parsed = rosterRow.safeParse({
      urn: values.urn ?? '',
      name: values.name ?? '',
      mobile: values.mobile ?? values.phone ?? '',
      section: values.section ?? '',
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({ row: rowNumber, field: issue.path.join('.'), message: issue.message });
      }
      continue;
    }
    if (seen.has(parsed.data.urn)) {
      errors.push({ row: rowNumber, field: 'urn', message: `duplicate of row ${seen.get(parsed.data.urn)}` });
      continue;
    }
    seen.set(parsed.data.urn, rowNumber);
    valid.push({ rowNumber, ...parsed.data });
  }

  const existing = await Participant.find({ urn: { $in: valid.map((r) => r.urn) } })
    .select('urn')
    .lean();
  const existingUrns = new Set(existing.map((p) => p.urn));
  const summary = {
    mode,
    totalRows: rows.length,
    validRows: valid.length,
    invalidRows: rows.length - valid.length,
    toCreate: valid.filter((r) => !existingUrns.has(r.urn)).length,
    toUpdate: valid.filter((r) => existingUrns.has(r.urn)).length,
    errors,
    preview: valid.slice(0, PREVIEW_ROWS).map((r) => ({ ...r, action: existingUrns.has(r.urn) ? 'update' : 'create' })),
  };

  if (mode === 'commit' && valid.length > 0) {
    await Participant.bulkWrite(
      valid.map((r) => ({
        updateOne: {
          filter: { urn: r.urn },
          update: {
            $set: { name: r.name, mobile: r.mobile, section: r.section },
            $setOnInsert: { urn: r.urn, isActive: true },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }
  return summary;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function listParticipants({ search, section, status, page, limit }) {
  const filter = {};
  if (section) filter.section = section;
  if (status === 'active') filter.isActive = true;
  if (status === 'inactive') filter.isActive = false;
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ urn: rx }, { name: rx }, { mobile: rx }];
  }
  const [items, total] = await Promise.all([
    Participant.find(filter)
      .select('-activeSessionId')
      .sort({ section: 1, urn: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Participant.countDocuments(filter),
  ]);
  return { items: toPlain(items), total, page, limit };
}

export async function listSections() {
  const sections = await Participant.distinct('section');
  return sections.filter(Boolean).sort();
}

export async function updateParticipant(id, changes) {
  const update = { ...changes };
  if (update.mobile !== undefined) {
    update.mobile = normalizeMobile(update.mobile);
    if (!env.MOBILE_REGEX.test(update.mobile)) {
      throw badRequest('Invalid request', 'VALIDATION_ERROR', [
        { path: 'mobile', message: 'mobile number is invalid' },
      ]);
    }
  }
  // Deactivating ends the current session immediately.
  if (update.isActive === false) update.activeSessionId = null;

  const participant = await Participant.findByIdAndUpdate(id, update, { returnDocument: 'after' })
    .select('-activeSessionId')
    .lean();
  if (!participant) throw notFound('Participant not found');
  if (update.isActive === false) await disconnectUserSockets(String(participant._id), { reason: 'deactivated' });
  return toPlain(participant);
}

/** Force-logout a participant (e.g. a student locked out by someone using their credentials). */
export async function endParticipantSession(id) {
  const res = await Participant.updateOne({ _id: id }, { activeSessionId: null });
  if (res.matchedCount === 0) throw notFound('Participant not found');
  await disconnectUserSockets(String(id), { reason: 'ended_by_admin' });
}
