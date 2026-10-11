import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_LIMITS } from '../../src/sandbox/languages.js';
import { mapJudge0Result } from '../../src/sandbox/judge0Provider.js';
import { mapPistonResult } from '../../src/sandbox/pistonProvider.js';
import { SandboxClient } from '../../src/sandbox/SandboxClient.js';

const b64 = (s) => Buffer.from(s).toString('base64');

describe('Piston result mapping', () => {
  it('maps a clean run', () => {
    expect(
      mapPistonResult({ run: { stdout: '5\n', stderr: '', code: 0, signal: null } }, DEFAULT_LIMITS),
    ).toMatchObject({ verdict: 'ok', stdout: '5\n' });
  });

  it('maps compile errors, timeouts and runtime errors', () => {
    expect(mapPistonResult({ compile: { code: 1, stderr: 'err' }, run: {} }, DEFAULT_LIMITS)).toMatchObject({
      verdict: 'compile_error',
      stderr: 'err',
    });
    expect(mapPistonResult({ run: { status: 'TO', code: null, signal: 'SIGKILL' } }, DEFAULT_LIMITS).verdict).toBe(
      'time_limit',
    );
    expect(mapPistonResult({ run: { code: 1, signal: null } }, DEFAULT_LIMITS).verdict).toBe('runtime_error');
  });

  it('caps output size', () => {
    const big = 'x'.repeat(DEFAULT_LIMITS.outputBytes + 100);
    expect(mapPistonResult({ run: { stdout: big, code: 0 } }, DEFAULT_LIMITS).stdout).toContain('[output truncated]');
  });
});

describe('Judge0 result mapping', () => {
  it('maps statuses', () => {
    expect(
      mapJudge0Result({ status: { id: 3 }, stdout: b64('ok'), time: '0.01', memory: 1000 }, DEFAULT_LIMITS),
    ).toMatchObject({ verdict: 'ok', stdout: 'ok', timeMs: 10 });
    expect(mapJudge0Result({ status: { id: 5 } }, DEFAULT_LIMITS).verdict).toBe('time_limit');
    expect(mapJudge0Result({ status: { id: 6 }, compile_output: b64('bad') }, DEFAULT_LIMITS)).toMatchObject({
      verdict: 'compile_error',
      stderr: 'bad',
    });
    expect(mapJudge0Result({ status: { id: 11 } }, DEFAULT_LIMITS).verdict).toBe('runtime_error');
    expect(mapJudge0Result({ status: { id: 13 } }, DEFAULT_LIMITS).verdict).toBe('internal_error');
  });
});

describe('SandboxClient', () => {
  it('caps concurrency and rejects interactive runs when saturated', async () => {
    let active = 0;
    let maxActive = 0;
    const releases = [];
    const provider = {
      execute: vi.fn(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => releases.push(r));
        active--;
        return { verdict: 'ok', stdout: '', stderr: '', timeMs: 1, memoryKb: 1 };
      }),
    };
    const client = new SandboxClient(provider, { maxConcurrency: 2 });
    const runs = [1, 2, 3].map(() => client.run({ language: 'python', source: 'print(1)' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(maxActive).toBe(2);
    await expect(client.run({ language: 'python', source: '' }, { rejectIfBusy: true })).rejects.toMatchObject({
      code: 'SANDBOX_BUSY',
    });
    while (releases.length) {
      releases.shift()();
      await new Promise((r) => setTimeout(r, 0));
    }
    await Promise.all(runs);
    expect(provider.execute).toHaveBeenCalledTimes(3);
  });

  it('rejects unknown languages', async () => {
    const client = new SandboxClient({ execute: vi.fn() }, { maxConcurrency: 1 });
    await expect(client.run({ language: 'cobol', source: '' })).rejects.toMatchObject({ code: 'UNSUPPORTED_LANGUAGE' });
  });
});
