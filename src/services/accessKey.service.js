import bcrypt from 'bcryptjs';
import { AccessKey } from '../models/index.js';
import { badRequest, notFound } from '../utils/errors.js';
import { generateAccessKey } from '../utils/random.js';
import { toPlain } from '../utils/serialize.js';
import { clearAccessKeyCache } from './auth.service.js';

const BCRYPT_ROUNDS = 10;

function present(doc, now = new Date()) {
  const plain = toPlain(doc);
  delete plain.keyHash;
  plain.isCurrentlyValid = doc.isActive && doc.validFrom <= now && doc.validUntil >= now;
  return plain;
}

/** Create the "key of the day". The plaintext key is returned once and only its bcrypt hash is stored. */
export async function createAccessKey({ label, key, validFrom, validUntil }, adminEmail) {
  const plainKey = key ?? generateAccessKey();
  const doc = await AccessKey.create({
    label,
    keyHash: await bcrypt.hash(plainKey, BCRYPT_ROUNDS),
    validFrom,
    validUntil,
    createdBy: adminEmail,
  });
  return { accessKey: present(doc.toObject()), key: plainKey };
}

export async function listAccessKeys() {
  const keys = await AccessKey.find().sort({ validFrom: -1 }).lean();
  const now = new Date();
  return keys.map((k) => present(k, now));
}

/** Replace the key value (same validity window). Returns the new plaintext key once. */
export async function rotateAccessKey(id, { key }) {
  const plainKey = key ?? generateAccessKey();
  const doc = await AccessKey.findByIdAndUpdate(
    id,
    { keyHash: await bcrypt.hash(plainKey, BCRYPT_ROUNDS), isActive: true },
    { returnDocument: 'after' },
  ).lean();
  if (!doc) throw notFound('Access key not found');
  clearAccessKeyCache();
  return { accessKey: present(doc), key: plainKey };
}

export async function updateAccessKey(id, changes) {
  const current = await AccessKey.findById(id).lean();
  if (!current) throw notFound('Access key not found');
  const validFrom = changes.validFrom ?? current.validFrom;
  const validUntil = changes.validUntil ?? current.validUntil;
  if (validUntil <= validFrom) {
    throw badRequest('Invalid request', 'VALIDATION_ERROR', [
      { path: 'validUntil', message: 'must be after validFrom' },
    ]);
  }
  const doc = await AccessKey.findByIdAndUpdate(id, changes, { returnDocument: 'after' }).lean();
  clearAccessKeyCache();
  return present(doc);
}

export async function deactivateAccessKey(id) {
  return updateAccessKey(id, { isActive: false });
}
