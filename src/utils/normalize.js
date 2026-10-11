/** URN: trim + uppercase. */
export function normalizeUrn(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

/** Name: Unicode-normalized, trimmed, inner whitespace collapsed to single spaces. */
export function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ');
}

/** A participant's display name: 2-80 characters, starting with a letter; letters, spaces, . ' - only. */
export const NAME_PATTERN = /^\p{L}[\p{L}\p{M} .'-]{1,79}$/u;

/**
 * Mobile: strip spaces, dashes, brackets and a leading +91 / 0091. A 12-digit "91XXXXXXXXXX" (spreadsheets drop
 * the "+") and an 11-digit trunk-prefixed "0XXXXXXXXXX" are reduced to the 10-digit number too.
 */
export function normalizeMobile(value) {
  const digits = String(value ?? '')
    .replace(/[\s\-()]/g, '')
    .replace(/^(\+91|0091)/, '');
  if (/^91\d{10}$/.test(digits)) return digits.slice(2);
  if (/^0\d{10}$/.test(digits)) return digits.slice(1);
  return digits;
}
