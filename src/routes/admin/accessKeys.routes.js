import { Router } from 'express';
import * as accessKeys from '../../controllers/admin/accessKeys.controller.js';
import { validate } from '../../middleware/validate.js';
import { accessKeyCreateBody, accessKeyRotateBody, accessKeyUpdateBody } from '../../schemas/admin.schemas.js';
import { idParams } from '../../schemas/common.js';

export function accessKeyRoutes() {
  const router = Router();
  router.get('/', accessKeys.list);
  router.post('/', validate({ body: accessKeyCreateBody }), accessKeys.create);
  router.post('/:id/rotate', validate({ params: idParams, body: accessKeyRotateBody }), accessKeys.rotate);
  router.patch('/:id', validate({ params: idParams, body: accessKeyUpdateBody }), accessKeys.update);
  router.post('/:id/deactivate', validate({ params: idParams }), accessKeys.deactivate);
  return router;
}
