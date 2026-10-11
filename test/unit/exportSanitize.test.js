import { describe, expect, it } from 'vitest';
import { safeCell, safeText } from '../../src/export/sanitize.js';

describe('formula-injection guard', () => {
  it.each(['=SUM(A1:A2)', '+1+1', '-2+3', '@cmd', '\t=1', '\r=1'])('prefixes %j with a quote', (value) => {
    expect(safeText(value)).toBe(`'${value}`);
  });

  it.each(['E25B002749', 'Asha', '9876543210', 'a=b', ''])('leaves %j alone', (value) => {
    expect(safeText(value)).toBe(value);
  });

  it('handles null/undefined and truncates huge values', () => {
    expect(safeText(null)).toBe('');
    expect(safeCell('x'.repeat(40_000)).length).toBeLessThan(32_100);
  });
});
