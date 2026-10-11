import { describe, expect, it } from 'vitest';
import { rankEntries } from '../../src/ranking/rank.js';

describe('rankEntries', () => {
  it('orders by score desc, then time asc, then URN asc', () => {
    const ranked = rankEntries([
      { urn: 'C', score: 5, timeTakenMs: 100 },
      { urn: 'A', score: 7, timeTakenMs: 500 },
      { urn: 'B', score: 5, timeTakenMs: 50 },
    ]);
    expect(ranked.map((r) => r.urn)).toEqual(['A', 'B', 'C']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('gives equal score and time the same rank (1, 2, 2, 4)', () => {
    const ranked = rankEntries([
      { urn: 'D', score: 1, timeTakenMs: 10 },
      { urn: 'C', score: 5, timeTakenMs: 100 },
      { urn: 'B', score: 5, timeTakenMs: 100 },
      { urn: 'A', score: 9, timeTakenMs: 300 },
    ]);
    expect(ranked.map((r) => [r.urn, r.rank])).toEqual([
      ['A', 1],
      ['B', 2],
      ['C', 2],
      ['D', 4],
    ]);
  });

  it('ranks unknown times after known ones on equal score', () => {
    const ranked = rankEntries([
      { urn: 'A', score: 3, timeTakenMs: null },
      { urn: 'B', score: 3, timeTakenMs: 1000 },
    ]);
    expect(ranked.map((r) => [r.urn, r.rank])).toEqual([
      ['B', 1],
      ['A', 2],
    ]);
  });

  it('does not mutate the input', () => {
    const input = [
      { urn: 'B', score: 1, timeTakenMs: 1 },
      { urn: 'A', score: 2, timeTakenMs: 1 },
    ];
    rankEntries(input);
    expect(input[0].urn).toBe('B');
    expect(input[0]).not.toHaveProperty('rank');
  });
});
