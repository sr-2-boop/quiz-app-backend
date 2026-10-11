import { z } from 'zod';

const bool = (fallback) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(fallback)
    .transform((v) => v === 'true' || v === '1');

const regex = (fallback) =>
  z
    .string()
    .default(fallback)
    .transform((source, ctx) => {
      try {
        return new RegExp(source);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'is not a valid regular expression' });
        return z.NEVER;
      }
    });

const csv = (value) =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(5000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    MONGODB_URI: z
      .string({ error: 'is required' })
      .regex(/^mongodb(\+srv)?:\/\//, 'must start with mongodb:// or mongodb+srv://'),

    // One origin, or several comma-separated.
    CLIENT_ORIGIN: z.string().default('http://localhost:5173').transform(csv).pipe(z.array(z.url()).min(1)),

    JWT_SECRET: z
      .string({ error: 'is required (generate one with: openssl rand -hex 32)' })
      .min(32, 'must be at least 32 characters (generate one with: openssl rand -hex 32)'),
    JWT_EXPIRES_IN: z
      .string()
      .regex(/^\d+[smhd]$/, 'must look like 30m, 6h or 1d')
      .default('6h'),
    COOKIE_SECURE: bool('false'),
    COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('lax'),

    // Express "trust proxy": a hop count (0 = no proxy), true/false, or a subnet list.
    TRUST_PROXY: z
      .string()
      .default('0')
      .transform((v) => {
        if (/^\d+$/.test(v)) return Number(v);
        if (v === 'true') return true;
        if (v === 'false') return false;
        return v;
      }),

    GOOGLE_CLIENT_ID: z.string({ error: 'is required for admin Google sign-in' }).min(1),
    // Optional: require the Google Workspace "hd" claim to match this domain.
    GOOGLE_HOSTED_DOMAIN: z.string().optional(),
    ADMIN_EMAILS: z
      .string({ error: 'is required (comma-separated admin Google emails)' })
      .transform((v) => csv(v).map((e) => e.toLowerCase()))
      .pipe(z.array(z.email()).min(1, 'must list at least one admin email')),

    URN_REGEX: regex('^[A-Z]\\d{2}[A-Z]\\d{6}$'),
    MOBILE_REGEX: regex('^[6-9]\\d{9}$'),

    CODE_EXECUTION_ENABLED: bool('false'),
    SANDBOX_PROVIDER: z.enum(['piston', 'judge0']).default('piston'),
    SANDBOX_URL: z.url().optional(),
    SANDBOX_AUTH_TOKEN: z.string().optional(),
    SANDBOX_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  })
  .superRefine((env, ctx) => {
    if (env.COOKIE_SAME_SITE === 'none' && !env.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'must be true when COOKIE_SAME_SITE=none',
      });
    }
    if (env.CODE_EXECUTION_ENABLED && !env.SANDBOX_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['SANDBOX_URL'],
        message: 'is required when CODE_EXECUTION_ENABLED=true',
      });
    }
  });

/**
 * Parse and validate environment variables. Empty strings count as "not set".
 * @param {Record<string, string | undefined>} source
 */
export function parseEnv(source) {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return Object.freeze(result.data);
}

/** @typedef {ReturnType<typeof parseEnv>} Env */

export const env = parseEnv(process.env);
