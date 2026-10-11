import { serviceUnavailable } from '../utils/errors.js';
import { LANGUAGES } from './languages.js';
import { truncateOutput } from './output.js';

/**
 * Adapter for a self-hosted Piston instance (https://github.com/engineer-man/piston).
 * Piston must run on its own host/network with networking disabled for jobs (its default).
 */
export class PistonProvider {
  constructor({ baseUrl, authToken }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.authToken = authToken;
  }

  /** @param {import('./SandboxClient.js').RunRequest & { limits: import('./SandboxClient.js').Limits }} request */
  async execute({ language, source, stdin, limits }) {
    const lang = LANGUAGES[language];
    let response;
    try {
      response = await fetch(`${this.baseUrl}/api/v2/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.authToken ? { authorization: this.authToken } : {}),
        },
        body: JSON.stringify({
          language: lang.piston,
          version: '*',
          files: [{ name: lang.fileName, content: source }],
          stdin,
          compile_timeout: 10_000,
          run_timeout: limits.wallMs,
          run_cpu_time: limits.cpuMs,
          run_memory_limit: limits.memoryKb * 1024,
        }),
        signal: AbortSignal.timeout(limits.wallMs + 20_000),
      });
    } catch {
      throw serviceUnavailable('SANDBOX_UNREACHABLE', 'The code runner is unavailable');
    }
    if (!response.ok) throw serviceUnavailable('SANDBOX_ERROR', `The code runner returned ${response.status}`);

    const body = await response.json();
    return mapPistonResult(body, limits);
  }
}

/** Map a Piston /execute response to a RunResult. Exported for tests. */
export function mapPistonResult(body, limits) {
  const cap = (s) => truncateOutput(s, limits.outputBytes);
  const compile = body.compile;
  if (compile && (compile.code !== 0 || compile.signal)) {
    return {
      verdict: 'compile_error',
      stdout: '',
      stderr: cap(compile.stderr || compile.output || ''),
      timeMs: null,
      memoryKb: null,
    };
  }

  const run = body.run ?? {};
  const timeMs = Number.isFinite(run.cpu_time) ? run.cpu_time : null;
  const memoryKb = Number.isFinite(run.memory) ? Math.round(run.memory / 1024) : null;
  let verdict = 'ok';
  if (run.status === 'TO') verdict = 'time_limit';
  else if (run.status === 'OL' || run.status === 'EL') verdict = 'output_limit';
  else if (run.status === 'XX') verdict = 'internal_error';
  else if (run.signal === 'SIGKILL' && memoryKb != null && memoryKb >= limits.memoryKb) verdict = 'memory_limit';
  else if (run.signal === 'SIGKILL' && Number.isFinite(run.wall_time) && run.wall_time >= limits.wallMs)
    verdict = 'time_limit';
  else if (run.code !== 0 || run.signal) verdict = 'runtime_error';

  return { verdict, stdout: cap(run.stdout), stderr: cap(run.stderr), timeMs, memoryKb };
}
