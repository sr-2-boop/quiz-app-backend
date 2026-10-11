import * as attempts from '../services/attempt.service.js';

export async function listTests(req, res) {
  res.json({ tests: await attempts.listTestsForParticipant(req.user) });
}

export async function startTest(req, res) {
  res.json(await attempts.startAttempt(req.user, req.params.id));
}

export async function myStanding(req, res) {
  res.json(await attempts.getMyStanding(req.user, req.params.id));
}

export async function saveAnswer(req, res) {
  res.json(await attempts.saveAnswer(req.user, req.params.id, req.params.qid, req.body));
}

export async function runCode(req, res) {
  res.json(await attempts.runSampleCases(req.user, req.params.id, req.body));
}

export async function submit(req, res) {
  res.json(await attempts.submitAttempt(req.user, req.params.id));
}

export async function result(req, res) {
  res.json(await attempts.getAttemptResult(req.user, req.params.id));
}
