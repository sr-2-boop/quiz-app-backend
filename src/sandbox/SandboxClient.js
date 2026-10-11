import pLimit from 'p-limit';
import { AppError, serviceUnavailable } from '../utils/errors.js';
import { DEFAULT_LIMITS, LANGUAGES } from './languages.js';
import { Judge0Provider } from './judge0Provider.js';
import { PistonProvider } from './pistonProvider.js';

/**
 * @typedef {'ok' | 'compile_error' | 'runtime_error' | 'time_limit' | 'memory_limit' | 'output_limit' | 'internal_error'} Verdict
 * @typedef {{ cpuMs: number, wallMs: number, memoryKb: number, outputBytes: number }} Limits
 * @typedef {{ language: string, source: string, stdin?: string, limits?: Partial<Limits> }} RunRequest
 * @typedef {{ verdict: Verdict, stdout: string, stderr: string, timeMs: number | null, memoryKb: number | null }} RunResult
 * @typedef {{ execute(request: RunRequest & { limits: Limits }): Promise<RunResult> }} SandboxProvider
 */

export class SandboxBusyError extends AppError {
  constructor() {
    super(503, 'SANDBOX_BUSY', 'The code runner is busy. Please retry in a few seconds.');
  }
}

/**
 * The only way the API executes code. Untrusted code never runs in this process: every run is sent to an
 * isolated sandbox host through a provider adapter. Concurrency is capped with p-limit.
 */
export class SandboxClient {
  /**
   * @param {SandboxProvider} provider
   * @param {{ maxConcurrency: number }} options
   */
  constructor(provider, { maxConcurrency }) {
    this.provider = provider;
    this.maxConcurrency = maxConcurrency;
    this.limit = pLimit(maxConcurrency);
  }

  isSaturated() {
    return this.limit.activeCount + this.limit.pendingCount >= this.maxConcurrency;
  }

  /**
   * @param {RunRequest} request
   * @param {{ rejectIfBusy?: boolean }} [options] interactive runs fail fast instead of queueing
   * @returns {Promise<RunResult>}
   */
  async run({ language, source, stdin = '', limits = {} }, { rejectIfBusy = false } = {}) {
    if (!LANGUAGES[language]) throw new AppError(400, 'UNSUPPORTED_LANGUAGE', `Unsupported language: ${language}`);
    if (rejectIfBusy && this.isSaturated()) throw new SandboxBusyError();
    const merged = { ...DEFAULT_LIMITS, ...limits };
    return this.limit(() => this.provider.execute({ language, source, stdin, limits: merged }));
  }
}

class DisabledProvider {
  async execute() {
    throw serviceUnavailable('CODE_EXECUTION_DISABLED', 'Code execution is not enabled');
  }
}

/** @param {import('../config/env.js').Env} env */
export function createSandboxClient(env) {
  let provider;
  if (!env.CODE_EXECUTION_ENABLED) {
    provider = new DisabledProvider();
  } else {
    const options = { baseUrl: env.SANDBOX_URL, authToken: env.SANDBOX_AUTH_TOKEN };
    provider = env.SANDBOX_PROVIDER === 'judge0' ? new Judge0Provider(options) : new PistonProvider(options);
  }
  return new SandboxClient(provider, { maxConcurrency: env.SANDBOX_MAX_CONCURRENCY });
}
