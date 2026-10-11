import { Router } from 'express';
import * as participants from '../../controllers/admin/participants.controller.js';
import { uploadSingle } from '../../middleware/upload.js';
import { validate } from '../../middleware/validate.js';
import { importModeQuery, participantListQuery, participantUpdateBody } from '../../schemas/admin.schemas.js';
import { idParams } from '../../schemas/common.js';

/** @param {import('../../middleware/rateLimit.js').RateLimiters} limiters */
export function participantAdminRoutes(limiters) {
  const router = Router();
  router.get('/', validate({ query: participantListQuery }), participants.list);
  router.get('/sections', participants.sections);
  router.post(
    '/import',
    limiters.exportImport,
    validate({ query: importModeQuery }),
    ...uploadSingle(['.csv', '.xlsx']),
    participants.importRoster,
  );
  router.patch('/:id', validate({ params: idParams, body: participantUpdateBody }), participants.update);
  router.post('/:id/end-session', validate({ params: idParams }), participants.endSession);
  return router;
}
