import path from 'node:path';
import ExcelJS from 'exceljs';
import { badRequest } from './errors.js';

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). Returns rows of strings. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/** "Negative Marks" -> "negativemarks", "option_a" -> "optiona". */
export function normalizeHeader(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function isZip(buffer) {
  return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

async function readXlsxRows(buffer) {
  if (!isZip(buffer)) throw badRequest('The file is not a valid .xlsx workbook', 'INVALID_FILE');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw badRequest('The file is not a valid .xlsx workbook', 'INVALID_FILE');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = [];
    for (let col = 1; col <= sheet.columnCount; col++) values.push(row.getCell(col).text ?? '');
    rows.push(values);
  });
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

/**
 * Read the first sheet of an uploaded .csv/.xlsx into header-keyed rows (all values are strings).
 * @param {{ originalname: string, buffer: Buffer }} file
 * @param {{ maxRows: number }} options
 * @returns {Promise<{ headers: string[], rows: { rowNumber: number, values: Record<string, string> }[] }>}
 */
export async function readTable(file, { maxRows }) {
  const ext = path.extname(file.originalname).toLowerCase();
  let raw;
  if (ext === '.csv') {
    const text = file.buffer.toString('utf8').replace(/^\uFEFF/, '');
    if (text.includes('\u0000')) throw badRequest('The file is not a valid CSV file', 'INVALID_FILE');
    raw = parseCsv(text);
  } else if (ext === '.xlsx') {
    raw = await readXlsxRows(file.buffer);
  } else {
    throw badRequest('Unsupported file type', 'UNSUPPORTED_FILE');
  }

  if (raw.length < 2) throw badRequest('The file has no data rows (the first row must be the header)', 'EMPTY_FILE');
  if (raw.length - 1 > maxRows) throw badRequest(`Too many rows (max ${maxRows})`, 'TOO_MANY_ROWS');

  const headers = raw[0].map(normalizeHeader);
  const rows = raw.slice(1).map((cells, i) => ({
    rowNumber: i + 2,
    values: Object.fromEntries(headers.map((h, col) => [h, String(cells[col] ?? '').trim()]).filter(([h]) => h)),
  }));
  return { headers, rows };
}
