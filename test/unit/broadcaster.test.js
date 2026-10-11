import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCoalescer } from '../../src/sockets/broadcaster.js';

describe('createCoalescer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('collapses a burst into one flush per key', async () => {
    const fn = vi.fn();
    const c = createCoalescer(fn, 500);
    for (let i = 0; i < 100; i++) c.schedule('t1');
    c.schedule('t2');
    await vi.advanceTimersByTimeAsync(499);
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls.map((c) => c[0]).sort()).toEqual(['t1', 't2']);
  });

  it('runs once more when events arrive during a flush', async () => {
    let release;
    const fn = vi.fn(() => new Promise((r) => (release = r)));
    const c = createCoalescer(fn, 100);
    c.schedule('t');
    await vi.advanceTimersByTimeAsync(100);
    c.schedule('t');
    c.schedule('t');
    release();
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('reports errors without stopping', async () => {
    const onError = vi.fn();
    const c = createCoalescer(() => Promise.reject(new Error('boom')), 10, { onError });
    c.schedule('t');
    await vi.advanceTimersByTimeAsync(10);
    expect(onError).toHaveBeenCalledOnce();
    c.schedule('t');
    expect(c.isScheduled('t')).toBe(true);
  });
});
