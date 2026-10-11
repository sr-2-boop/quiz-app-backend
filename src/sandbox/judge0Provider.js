import { serviceUnavailable } from '../utils/errors.js';
import { LANGUAGES } from './languages.js';
import { truncateOutput } from './output.js';

const b64 = (s) => Buffer.from(String(s ?? ''), 'utf8').toString('base64');
const unb64 = (s) => (s ? Buffer.from(s, 'base64').toString('utf8') : '');

/**
 * Adapter for a self-hosted Judge0 CE instance (https://github.com/judge0/judge0).
 * Configure the Judge0 host with networking disabled and per-submission limits at least as strict as ours.
 */
export class Judge0Provider {
  constructor({ baseUrl, authToken }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.authToken = authToken;
  }

  /** @param {import('./SandboxClient.js').RunRequest & { limits: import('./SandboxClient.js').Limits }} request */
  async execute({ language, source, stdin, limits }) {
    const lang = LANGUAGES[language];
    let response;
    try {
      response = await fetch(`${this.baseUrl}/submissions?base64_encoded=true&wait=true`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.authToken ? { 'X-Auth-Token': this.authToken } : {}),
        },
        body: JSON.stringify({
          language_id: lang.judge0,
          source_code: b64(source),
          stdin: b64(stdin),
          cpu_time_limit: limits.cpuMs / 1000,
          wall_time_limit: limits.wallMs / 1000,
          memory_limit: limits.memoryKb,
          max_file_size: 1024,
          enable_network: false,
        }),
        signal: AbortSignal.timeout(limits.wallMs + 20_000),
      });
    } catch {
      throw serviceUnavailable('SANDBOX_UNREACHABLE', 'The code runner is unavailable');
    }
    if (!response.ok) throw serviceUnavailable('SANDBOX_ERROR', `The code runner returned ${response.status}`);

    const body = await response.json();
    return mapJudge0Result(body, limits);
  }
}

/** Map a Judge0 submission (base64 fields) to a RunResult. Exported for tests. */
export function mapJudge0Result(body, limits) {
  const cap = (s) => truncateOutput(s, limits.outputBytes);
  const statusId = body.status?.id;
  const memoryKb = Number.isFinite(body.memory) ? body.memory : null;
  const timeMs = body.time != null ? Math.round(Number(body.time) * 1000) : null;

  let verdict;
  if (statusId === 3 || statusId === 4) verdict = 'ok';
  else if (statusId === 5) verdict = 'time_limit';
  else if (statusId === 6) verdict = 'compile_error';
  else if (statusId >= 7 && statusId <= 12) {
    verdict = memoryKb != null && memoryKb >= limits.memoryKb ? 'memory_limit' : 'runtime_error';
  } else verdict = 'internal_error';

  return {
    verdict,
    stdout: cap(unb64(body.stdout)),
    stderr: cap(verdict === 'compile_error' ? unb64(body.compile_output) : unb64(body.stderr)),
    timeMs,
    memoryKb,
  };
}
