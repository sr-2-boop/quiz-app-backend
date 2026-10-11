import path from 'node:path';
import multer from 'multer';
import { badRequest } from '../utils/errors.js';

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

const MIME_BY_EXT = {
  '.csv': ['text/csv', 'application/csv', 'text/x-csv', 'application/vnd.ms-excel', 'text/plain'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'],
  '.json': ['application/json', 'text/json', 'text/plain', 'application/octet-stream'],
};

/**
 * Single-file upload kept in memory (never written to disk), 2 MB max, extension + MIME allow-list.
 * File contents are still untrusted: parsers validate everything they read.
 * @param {string[]} extensions e.g. ['.csv', '.xlsx']
 */
export function uploadSingle(extensions) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5, parts: 6 },
    fileFilter(_req, file, cb) {
      const ext = path.extname(file.originalname ?? '').toLowerCase();
      if (!extensions.includes(ext) || !MIME_BY_EXT[ext]?.includes(file.mimetype)) {
        return cb(badRequest(`Unsupported file. Allowed: ${extensions.join(', ')}`, 'UNSUPPORTED_FILE'));
      }
      cb(null, true);
    },
  });

  return [
    upload.single('file'),
    (req, _res, next) => (req.file ? next() : next(badRequest('Attach a file in the "file" field', 'FILE_REQUIRED'))),
  ];
}
