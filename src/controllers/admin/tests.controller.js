import * as questions from '../../services/question.service.js';
import * as tests from '../../services/test.service.js';

export async function list(_req, res) {
  res.json({ tests: await tests.listTests() });
}

export async function get(req, res) {
  res.json({ test: await tests.getTest(req.params.id) });
}

export async function create(req, res) {
  res.status(201).json({ test: await tests.createTest(req.body, req.user.email) });
}

export async function update(req, res) {
  res.json({ test: await tests.updateTest(req.params.id, req.body) });
}

export async function remove(req, res) {
  await tests.deleteTest(req.params.id);
  res.status(204).end();
}

export async function publish(req, res) {
  res.json({ test: await tests.publishTest(req.params.id) });
}

export async function unpublish(req, res) {
  res.json({ test: await tests.unpublishTest(req.params.id) });
}

export async function start(req, res) {
  res.json({ test: await tests.startTest(req.params.id) });
}

export async function end(req, res) {
  res.json({ test: await tests.endTest(req.params.id) });
}

export async function reorder(req, res) {
  res.json({ test: await tests.reorderQuestions(req.params.id, req.body.questionOrder) });
}

export async function listQuestions(req, res) {
  res.json({ questions: await questions.listQuestions(req.params.id) });
}

export async function getQuestion(req, res) {
  res.json({ question: await questions.getQuestion(req.params.id, req.params.qid) });
}

export async function createQuestion(req, res) {
  res.status(201).json({ question: await questions.createQuestion(req.params.id, req.body) });
}

export async function updateQuestion(req, res) {
  res.json({ question: await questions.updateQuestion(req.params.id, req.params.qid, req.body) });
}

export async function deleteQuestion(req, res) {
  await questions.deleteQuestion(req.params.id, req.params.qid);
  res.status(204).end();
}

export async function importQuestions(req, res) {
  res.json(await questions.importQuestions(req.params.id, req.file, { mode: req.query.mode }));
}
