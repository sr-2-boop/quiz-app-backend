import { z } from 'zod';

// Exactly three fields; anything else (including $-operators) is rejected.
export const participantLoginBody = z.strictObject({
  mobile: z.string().min(1).max(32),
  urn: z.string().min(1).max(32),
  password: z.string().min(1).max(128),
});

export const adminGoogleBody = z.strictObject({
  credential: z.string().min(1).max(8192),
});
