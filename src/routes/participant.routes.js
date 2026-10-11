import { Router } from 'express';
import * as participant from '../controllers/participant.controller.js';
import { requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { idParams } from '../schemas/common.js';
import { testQuestionParams } from '../schemas/admin.schemas.js';
import { runCodeBody, saveAnswerBody } from '../schemas/question.schemas.js';

/** @param {import('../middleware/rateLimit.js').RateLimiters} limiters */
export function participantRoutes(limiters) {
  const router = Router();
  router.use(requireRole('participant'));

  const general = limiters.general;
  router.get('/tests', general, participant.listTests);
  router.post('/tests/:id/start', general, validate({ params: idParams }), participant.startTest);
  router.get('/tests/:id/me', general, validate({ params: idParams }), participant.myStanding);
  router.put(
    '/attempts/:id/answers/:qid',
    limiters.answerSave,
    validate({ params: testQuestionParams, body: saveAnswerBody }),
    participant.saveAnswer,
  );
  router.post(
    '/attempts/:id/run',
    ...limiters.codeRun,
    validate({ params: idParams, body: runCodeBody }),
    participant.runCode,
  );
  router.post('/attempts/:id/submit', general, validate({ params: idParams }), participant.submit);
  router.get('/attempts/:id/result', general, validate({ params: idParams }), participant.result);

  return router;
}
