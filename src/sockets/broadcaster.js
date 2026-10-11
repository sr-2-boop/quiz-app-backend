/**
 * Coalesce bursts of events per key into one call of `fn(key)` at most every `delayMs`.
 * The first event schedules a flush; later events before it fire are absorbed. Events arriving during
 * a flush schedule exactly one more flush afterwards, so the last change is never lost.
 * @param {(key: string) => Promise<void> | void} fn
 * @param {number} delayMs
 * @param {{ onError?: (err: unknown, key: string) => void }} [options]
 */
export function createCoalescer(fn, delayMs, { onError } = {}) {
  const timers = new Map();
  const running = new Set();
  const dirty = new Set();

  async function flush(key) {
    timers.delete(key);
    running.add(key);
    try {
      await fn(key);
    } catch (err) {
      onError?.(err, key);
    } finally {
      running.delete(key);
      if (dirty.delete(key)) schedule(key);
    }
  }

  function schedule(key) {
    if (timers.has(key)) return;
    if (running.has(key)) {
      dirty.add(key);
      return;
    }
    const timer = setTimeout(() => flush(key), delayMs);
    timer.unref?.();
    timers.set(key, timer);
  }

  function cancelAll() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    dirty.clear();
  }

  return { schedule, cancelAll, isScheduled: (key) => timers.has(key) };
}
