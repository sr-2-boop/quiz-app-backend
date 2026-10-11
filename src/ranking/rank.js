/**
 * @typedef {object} RankInput
 * @property {number} score
 * @property {number | null | undefined} timeTakenMs
 * @property {string} urn
 */

const timeOf = (entry) => (Number.isFinite(entry.timeTakenMs) ? entry.timeTakenMs : Number.POSITIVE_INFINITY);

/** score desc, then time taken asc, then URN asc (for a deterministic order). */
export function compareEntries(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  const ta = timeOf(a);
  const tb = timeOf(b);
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (a.urn === b.urn) return 0;
  return a.urn < b.urn ? -1 : 1;
}

/**
 * Sort and assign competition ranks: equal score and equal time share a rank (1, 2, 2, 4).
 * @template {RankInput} T
 * @param {T[]} entries
 * @returns {(T & { rank: number })[]}
 */
export function rankEntries(entries) {
  const sorted = [...entries].sort(compareEntries);
  let rank = 0;
  return sorted.map((entry, index) => {
    const prev = sorted[index - 1];
    if (!prev || prev.score !== entry.score || timeOf(prev) !== timeOf(entry)) rank = index + 1;
    return { ...entry, rank };
  });
}
