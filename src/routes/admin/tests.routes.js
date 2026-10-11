import { Router } from 'express';
import * as reports from '../../controllers/admin/reports.controller.js';
import * as tests from '../../controllers/admin/tests.controller.js';
import { uploadSingle } from '../../middleware/upload.js';
import { validate } from '../../middleware/validate.js';
import {
  exportQuery,
  importModeQuery,
  reorderBody,
  sectionQuery,
  testAttemptParams,
  testCreateBody,
  testQuestionParams,
  testUpdateBody,
} from '../../schemas/admin.schemas.js';
import { idParams } from '../../schemas/common.js';
import { questionInput } from '../../schemas/question.schemas.js';

/** @param {import('../../middleware/rateLimit.js').RateLimiters} limiters */
export function testAdminRoutes(limiters) {
  const router = Router();
  const byId = validate({ params: idParams });

  router.get('/', tests.list);
  router.post('/', validate({ body: testCreateBody }), tests.create);
  router.get('/:id', byId, tests.get);
  router.patch('/:id', validate({ params: idParams, body: testUpdateBody }), tests.update);
  router.delete('/:id', byId, tests.remove);
  router.post('/:id/publish', byId, tests.publish);
  router.post('/:id/unpublish', byId, tests.unpublish);
  router.post('/:id/start', byId, tests.start);
  router.post('/:id/end', byId, tests.end);
  router.post('/:id/restart', byId, tests.restart);
  router.put('/:id/question-order', validate({ params: idParams, body: reorderBody }), tests.reorder);

  router.get('/:id/questions', byId, tests.listQuestions);
  router.post('/:id/questions', validate({ params: idParams, body: questionInput }), tests.createQuestion);
  router.post(
    '/:id/questions/import',
    limiters.exportImport,
    validate({ params: idParams, query: importModeQuery }),
    ...uploadSingle(['.json', '.csv', '.xlsx']),
    tests.importQuestions,
  );
  router.get('/:id/questions/:qid', validate({ params: testQuestionParams }), tests.getQuestion);
  router.put(
    '/:id/questions/:qid',
    validate({ params: testQuestionParams, body: questionInput }),
    tests.updateQuestion,
  );
  router.delete('/:id/questions/:qid', validate({ params: testQuestionParams }), tests.deleteQuestion);

  router.get('/:id/leaderboard', validate({ params: idParams, query: sectionQuery }), reports.leaderboard);
  router.get('/:id/analytics', validate({ params: idParams, query: sectionQuery }), reports.analytics);
  router.get(
    '/:id/export.xlsx',
    limiters.exportImport,
    validate({ params: idParams, query: exportQuery }),
    reports.exportXlsx,
  );
  router.get('/:id/attempts/:attemptId', validate({ params: testAttemptParams }), reports.attemptDetail);

  return router;
}
