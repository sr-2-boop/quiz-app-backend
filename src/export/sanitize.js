// Spreadsheet formula-injection guard: user-originated strings that a spreadsheet could interpret as a
// formula (=, +, -, @, and tab/CR per OWASP) are prefixed with a single quote.
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function safeText(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return FORMULA_TRIGGER.test(text) ? `'${text}` : text;
}

const EXCEL_CELL_LIMIT = 32_000;

/** safeText + truncation to fit Excel's per-cell character limit. */
export function safeCell(value) {
  const text = safeText(value);
  return text.length > EXCEL_CELL_LIMIT ? `${text.slice(0, EXCEL_CELL_LIMIT)}…` : text;
}
