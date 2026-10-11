import mongoose from 'mongoose';

/**
 * Convert a lean Mongo document into a JSON-friendly object: `_id` becomes `id`,
 * ObjectIds become strings and `__v` is dropped. Used for admin-facing payloads only;
 * participant payloads go through the explicit serializers in src/serializers.
 */
export function toPlain(value) {
  if (Array.isArray(value)) return value.map(toPlain);
  if (value instanceof Date || value === null || typeof value !== 'object') return value;
  if (value instanceof mongoose.Types.ObjectId) return String(value);
  if (Buffer.isBuffer(value)) return value;

  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    if (key === '__v') continue;
    out[key === '_id' ? 'id' : key] = toPlain(inner);
  }
  return out;
}

export function idEquals(a, b) {
  return a != null && b != null && String(a) === String(b);
}
