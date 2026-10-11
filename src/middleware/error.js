import multer from 'multer';
import { ZodError } from 'zod';
import { logger } from '../config/logger.js';
import { AppError, validationError } from '../utils/errors.js';

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

function toAppError(err) {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) return validationError(err);
  if (err instanceof multer.MulterError) {
    return err.code === 'LIMIT_FILE_SIZE'
      ? new AppError(413, 'FILE_TOO_LARGE', 'File is too large (max 2 MB)')
      : new AppError(400, 'UPLOAD_ERROR', 'Upload rejected');
  }
  if (err?.type === 'entity.too.large') return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  if (err?.type === 'entity.parse.failed') return new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  if (err?.name === 'CastError') return new AppError(400, 'INVALID_ID', 'Invalid id');
  if (err?.code === 11000) return new AppError(409, 'DUPLICATE', 'A record with the same unique value already exists');
  if (err?.name === 'ValidationError') return new AppError(400, 'VALIDATION_ERROR', 'Invalid data');
  return null;
}

/** Central error handler. Responses are always { error: { code, message, details? } }. */
export function errorHandler(err, req, res, _next) {
  const appError = toAppError(err);
  const log = req.log ?? logger;

  if (!appError || appError.status >= 500) {
    log.error({ err }, 'Request failed');
  }

  if (res.headersSent) {
    // A streamed response (e.g. Excel export) failed midway; nothing sensible can be sent.
    res.destroy();
    return;
  }

  const status = appError?.status ?? 500;
  const body = {
    code: appError?.code ?? 'INTERNAL_ERROR',
    message: appError?.message ?? 'Something went wrong',
  };
  if (appError?.details) body.details = appError.details;
  res.status(status).json({ error: body });
}
