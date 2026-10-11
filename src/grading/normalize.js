/** Short free-text answers: trim, collapse whitespace, lowercase unless caseSensitive. */
export function normalizeAnswer(value, { caseSensitive = false } = {}) {
  const out = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  return caseSensitive ? out : out.toLowerCase();
}

/** Program output: normalize line endings, drop trailing whitespace on each line, trim. */
export function normalizeOutput(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim();
}

/**
 * Code fixes: normalize line endings, drop blank lines and trailing whitespace, remove the common
 * indentation, and collapse runs of spaces/tabs after the indentation. Case and relative indentation are kept.
 */
export function normalizeCode(value) {
  const lines = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [indent] = line.match(/^[ \t]*/);
      return {
        indent: indent.replace(/\t/g, '    '),
        body: line
          .slice(indent.length)
          .replace(/[ \t]+/g, ' ')
          .trimEnd(),
      };
    });
  const common = Math.min(...lines.map((l) => l.indent.length));
  return lines.map((l) => l.indent.slice(common) + l.body).join('\n');
}

export function roundMarks(value) {
  // `|| 0` turns -0 (from "minus zero negative marks") into 0.
  return Math.round(value * 100) / 100 || 0;
}
