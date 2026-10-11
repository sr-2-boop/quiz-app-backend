// Keys that must never appear in a participant-facing payload while a test is live.
export const FORBIDDEN_LIVE_KEYS = [
  'correctOptionIds',
  'acceptedAnswers',
  'acceptedFixes',
  'fixedCode',
  'expectedOutput',
  'explanation',
  'testCases',
  'hidden',
  'isCorrect',
  'mobile',
];

/** Collect every object key in a JSON-like value (deep). */
export function allKeys(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}
