import { Router } from 'express';
import * as templates from '../../controllers/admin/templates.controller.js';

export function templateRoutes() {
  const router = Router();
  router.get('/questions.json', templates.questionsJson);
  router.get('/questions.xlsx', templates.questionsXlsx);
  router.get('/roster.xlsx', templates.rosterXlsx);
  return router;
}
