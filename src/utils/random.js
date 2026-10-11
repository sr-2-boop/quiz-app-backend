import { randomInt } from 'node:crypto';

/** Fisher-Yates shuffle (returns a new array). */
export function shuffle(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// No 0/O/1/I/L so keys can be read out loud or written on a board.
const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateAccessKey(length = 6) {
  let key = '';
  for (let i = 0; i < length; i++) key += KEY_ALPHABET[randomInt(KEY_ALPHABET.length)];
  return key;
}
