/** Truncate a string to at most `maxBytes` UTF-8 bytes. */
export function truncateOutput(value, maxBytes) {
  const text = String(value ?? '');
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  return `${buf.subarray(0, maxBytes).toString('utf8')}\n…[output truncated]`;
}
