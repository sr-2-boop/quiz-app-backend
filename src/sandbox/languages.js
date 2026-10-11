// The single place where supported languages are configured.
// `piston` is the Piston runtime name, `judge0` the Judge0 CE language id.
export const LANGUAGES = Object.freeze({
  python: { label: 'Python 3', piston: 'python', judge0: 71, fileName: 'main.py' },
  c: { label: 'C', piston: 'c', judge0: 50, fileName: 'main.c' },
  cpp: { label: 'C++', piston: 'c++', judge0: 54, fileName: 'main.cpp' },
  java: { label: 'Java', piston: 'java', judge0: 62, fileName: 'Main.java' },
  javascript: { label: 'JavaScript', piston: 'javascript', judge0: 63, fileName: 'main.js' },
});

export const LANGUAGE_IDS = /** @type {[string, ...string[]]} */ (Object.keys(LANGUAGES));

// Mandatory per-run limits (see CLAUDE.md §8). The sandbox host must enforce these too.
export const DEFAULT_LIMITS = Object.freeze({
  cpuMs: 2000,
  wallMs: 5000,
  memoryKb: 256 * 1024,
  outputBytes: 64 * 1024,
});
