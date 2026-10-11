import { Router } from 'express';
import { requireRole } from '../../middleware/auth.js';
import { notFoundHandler } from '../../middleware/error.js';
import { accessKeyRoutes } from './accessKeys.routes.js';
import { participantAdminRoutes } from './participants.routes.js';
import { templateRoutes } from './templates.routes.js';
import { testAdminRoutes } from './tests.routes.js';

/** @param {import('../../middleware/rateLimit.js').RateLimiters} limiters */
export function adminRoutes(limiters) {
  const router = Router();
  router.use(requireRole('admin'), limiters.general);
  router.use('/participants', participantAdminRoutes(limiters));
  router.use('/access-keys', accessKeyRoutes());
  router.use('/tests', testAdminRoutes(limiters));
  router.use('/templates', templateRoutes());
  router.use(notFoundHandler);
  return router;
}
