import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/config/env.js';

const base = {
  MONGODB_URI: 'mongodb://localhost:27017/quiz',
  JWT_SECRET: 'x'.repeat(40),
  GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
  ADMIN_EMAILS: 'A@Uni.edu, b@uni.edu',
};

describe('parseEnv', () => {
  it('applies defaults and normalizes values', () => {
    const env = parseEnv(base);
    expect(env.PORT).toBe(5000);
    expect(env.ADMIN_EMAILS).toEqual(['a@uni.edu', 'b@uni.edu']);
    expect(env.URN_REGEX.test('E25B002749')).toBe(true);
    expect(env.MOBILE_REGEX.test('9876543210')).toBe(true);
    expect(env.CODE_EXECUTION_ENABLED).toBe(false);
    expect(env.TRUST_PROXY).toBe(0);
    expect(env.COOKIE_SAME_SITE).toBe('lax');
  });

  it('fails fast on missing or weak secrets', () => {
    expect(() => parseEnv({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
    expect(() => parseEnv({ ...base, JWT_SECRET: '' })).toThrow(/JWT_SECRET/);
    expect(() => parseEnv({ ...base, GOOGLE_CLIENT_ID: undefined })).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it('requires a sandbox URL when code execution is enabled', () => {
    expect(() => parseEnv({ ...base, CODE_EXECUTION_ENABLED: 'true' })).toThrow(/SANDBOX_URL/);
    expect(
      parseEnv({ ...base, CODE_EXECUTION_ENABLED: 'true', SANDBOX_URL: 'http://runner:2000' }).CODE_EXECUTION_ENABLED,
    ).toBe(true);
  });

  it('requires secure cookies for cross-site cookie mode', () => {
    expect(() => parseEnv({ ...base, COOKIE_SAME_SITE: 'none' })).toThrow(/COOKIE_SECURE/);
    expect(parseEnv({ ...base, COOKIE_SAME_SITE: 'none', COOKIE_SECURE: 'true' }).COOKIE_SAME_SITE).toBe('none');
  });

  it('reduces CLIENT_ORIGIN entries to bare origins', () => {
    const env = parseEnv({ ...base, CLIENT_ORIGIN: 'https://quiz.vercel.app/, http://localhost:5173/login' });
    expect(env.CLIENT_ORIGIN).toEqual(['https://quiz.vercel.app', 'http://localhost:5173']);
    expect(() => parseEnv({ ...base, CLIENT_ORIGIN: 'quiz.vercel.app' })).toThrow(/CLIENT_ORIGIN/);
  });

  it('rejects invalid regexes and emails', () => {
    expect(() => parseEnv({ ...base, URN_REGEX: '([' })).toThrow(/URN_REGEX/);
    expect(() => parseEnv({ ...base, ADMIN_EMAILS: 'not-an-email' })).toThrow(/ADMIN_EMAILS/);
  });
});
