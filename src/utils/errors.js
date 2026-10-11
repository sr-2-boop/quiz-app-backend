/** Error with an HTTP status and a stable machine-readable code. Rendered as { error: { code, message } }. */
export class AppError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {unknown} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message = 'Bad request', code = 'BAD_REQUEST', details) =>
  new AppError(400, code, message, details);

export const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message);

/** The single, generic login failure. Never reveal which check failed. */
export const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');

export const forbidden = (message = 'You do not have access to this resource') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Not found') => new AppError(404, 'NOT_FOUND', message);

export const conflict = (code, message) => new AppError(409, code, message);

export const serviceUnavailable = (code, message) => new AppError(503, code, message);

/** @param {import('zod').ZodError} error */
export function validationError(error, message = 'Invalid request') {
  return badRequest(
    message,
    'VALIDATION_ERROR',
    error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  );
}
