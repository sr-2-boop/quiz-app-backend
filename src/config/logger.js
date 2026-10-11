import pino from 'pino';
import { env } from './env.js';

// Never log tokens, passwords, access keys or mobile numbers.
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'password',
      'key',
      'mobile',
      'token',
      'credential',
      '*.password',
      '*.key',
      '*.mobile',
      '*.token',
      '*.credential',
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
    ],
    censor: '[redacted]',
  },
});
