import { validationError } from '../utils/errors.js';

/**
 * Validate (and replace) req.params / req.query / req.body with Zod schemas.
 * Use strict object schemas so unknown keys and `$` operators are rejected before reaching Mongo.
 * @param {{ params?: import('zod').ZodType, query?: import('zod').ZodType, body?: import('zod').ZodType }} schemas
 */
export function validate(schemas) {
  return (req, _res, next) => {
    for (const part of /** @type {const} */ (['params', 'query', 'body'])) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) return next(validationError(result.error));
      // req.query is a getter in Express 5, so redefine instead of assigning.
      Object.defineProperty(req, part, { value: result.data, writable: true, configurable: true, enumerable: true });
    }
    next();
  };
}
