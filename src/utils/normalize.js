/** URN: trim + uppercase. */
export function normalizeUrn(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

/** Mobile: strip spaces, dashes, brackets and a leading +91 / 0091. */
export function normalizeMobile(value) {
  return String(value ?? '')
    .replace(/[\s\-()]/g, '')
    .replace(/^(\+91|0091)/, '');
}
