import { Router } from 'express';
import * as auth from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { adminGoogleBody, participantLoginBody } from '../schemas/auth.schemas.js';

/** @param {import('../middleware/rateLimit.js').RateLimiters} limiters */
export function authRoutes(limiters) {
  const router = Router();

  // Participants: mobile + URN + password only. Admins: Google only. The two never share a route.
  router.post(
    '/participant/login',
    ...limiters.participantLogin,
    validate({ body: participantLoginBody }),
    auth.participantLogin,
  );
  router.post('/admin/google', limiters.adminLogin, validate({ body: adminGoogleBody }), auth.adminGoogleLogin);
  router.post('/logout', auth.logout);
  router.get('/me', requireAuth, limiters.general, auth.me);
  router.get('/socket-token', requireAuth, limiters.general, auth.socketToken);

  return router;
}
