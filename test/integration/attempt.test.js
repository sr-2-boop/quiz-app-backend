import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { runSweep } from '../../src/jobs/sweeper.js';
import { Attempt, Test } from '../../src/models/index.js';
import { useTestDb } from '../helpers/db.js';
import { adminCookie, createParticipant, createTestWithQuestions, participantCookie } from '../helpers/factories.js';
import { allKeys, FORBIDDEN_LIVE_KEYS } from '../helpers/leaks.js';

useTestDb();

async function setup(options = {}) {
  const app = createApp();
  const participant = await createParticipant();
  const cookie = await participantCookie(participant);
  const { test, questions } = await createTestWithQuestions(options);
  const [mcq, fill, debug, snippet] = questions;
  return { app, participant, cookie, test, testId: String(test._id), mcq, fill, debug, snippet };
}

const put = (ctx, attemptId, qid, response, extra = {}) =>
  request(ctx.app)
    .put(`/api/attempts/${attemptId}/answers/${qid}`)
    .set('Cookie', ctx.cookie)
    .send({ response, ...extra });

describe('participant attempt flow', () => {
  let ctx;
  beforeEach(async () => {
    ctx = await setup();
  });

  it('lists available tests without analytics', async () => {
    const res = await request(ctx.app).get('/api/tests').set('Cookie', ctx.cookie);
    expect(res.status).toBe(200);
    expect(res.body.tests).toHaveLength(1);
    expect(res.body.tests[0]).toMatchObject({
      id: ctx.testId,
      isOpen: true,
      canStart: true,
      questionCount: 4,
      myAttempt: null,
    });
  });

  it('starts an attempt with sanitized questions and a server-computed expiry', async () => {
    const res = await request(ctx.app).post(`/api/tests/${ctx.testId}/start`).set('Cookie', ctx.cookie);
    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(4);
    const keys = allKeys(res.body);
    for (const key of FORBIDDEN_LIVE_KEYS) expect(keys.has(key), `start payload leaks ${key}`).toBe(false);
    const expiresIn = new Date(res.body.attempt.expiresAt) - new Date(res.body.serverNow);
    expect(expiresIn).toBeGreaterThan(29 * 60_000);
    expect(expiresIn).toBeLessThanOrEqual(30 * 60_000);
  });

  it('resumes the same attempt (and order) after a refresh', async () => {
    const first = await request(ctx.app).post(`/api/tests/${ctx.testId}/start`).set('Cookie', ctx.cookie);
    await put(ctx, first.body.attempt.id, ctx.mcq._id, { selected: ['B'] });
    const second = await request(ctx.app).post(`/api/tests/${ctx.testId}/start`).set('Cookie', ctx.cookie);
    expect(second.body.attempt.id).toBe(first.body.attempt.id);
    expect(second.body.questions.map((q) => q.id)).toEqual(first.body.questions.map((q) => q.id));
    expect(second.body.answers).toEqual([
      expect.objectContaining({ questionId: String(ctx.mcq._id), response: { selected: ['B'] } }),
    ]);
    expect(await Attempt.countDocuments()).toBe(1);
  });

  it('grades on save, overwrites on re-answer and keeps a live score', async () => {
    const start = await request(ctx.app).post(`/api/tests/${ctx.testId}/start`).set('Cookie', ctx.cookie);
    const id = start.body.attempt.id;

    let res = await put(ctx, id, ctx.mcq._id, { selected: ['A'] });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('isCorrect');
    expect(res.body.score).toBe(-1);

    res = await put(ctx, id, ctx.mcq._id, { selected: ['B'] });
    expect(res.body.score).toBe(2);
    res = await put(ctx, id, ctx.fill._id, { values: { b1: 'paris', b2: '5' } });
    expect(res.body.score).toBe(3);
    res = await put(ctx, id, ctx.debug._id, { answer: 's += x' });
    expect(res.body.score).toBe(6);
    res = await put(ctx, id, ctx.snippet._id, { answer: '2' });
    expect(res.body.score).toBe(7);

    const attempt = await Attempt.findById(id).lean();
    expect(attempt.answers).toHaveLength(4);
    expect(attempt.score).toBe(7);
  });

  it('stores responses as data even when they look like Mongo operators', async () => {
    const start = await request(ctx.app).post(`/api/tests/${ctx.testId}/start`).set('Cookie', ctx.cookie);
    const res = await put(ctx, start.body.attempt.id, ctx.snippet._id, { answer: '$answers' });
    expect(res.status).toBe(200);
    const attempt = await Attempt.findById(start.body.attempt.id).lean();
    expect(attempt.answers[0].response).toEqual({ answer: '$answers' });
  });

  it('validates responses against the question', async () => {
    const start = await request(ctx.app).post(`/api/tests/${ctx.testId}/start`).set('Cookie', ctx.cookie);
    const id = start.body.attempt.id;
    expect((await put(ctx, id, ctx.mcq._id, { selected: ['Z'] })).status).toBe(400);
    expect((await put(ctx, id, ctx.mcq._id, { selected: ['A', 'B'] })).status).toBe(400);
    expect((await put(ctx, id, ctx.fill._id, { values: { nope: 'x' } })).status).toBe(400);
    expect((await put(ctx, id, ctx.mcq._id, { selected: ['B'] }, { score: 100 })).status).toBe(400);
  });

  it("cannot touch another participant's attempt", async () => {
    const start = await request(ctx.app).post(`/api/tests/${ctx.testId}/start`).set('Cookie', ctx.cookie);
    const other = await createParticipant({ urn: 'E25B000002', mobile: '9000000002' });
    const otherCookie = await participantCookie(other);
    const res = await request(ctx.app)
      .put(`/api/attempts/${start.body.attempt.id}/answers/${ctx.mcq._id}`)
      .set('Cookie', otherCookie)
      .send({ response: { selected: ['B'] } });
    expect(res.status).toBe(404);
    expect(
      (await request(ctx.app).get(`/api/attempts/${start.body.attempt.id}/result`).set('Cookie', otherCookie)).status,
    ).toBe(404);
  });

  it('submits, then reveals own feedback (after_submit) without other participants data', async () => {
    const start = await request(ctx.app).post(`/api/tests/${ctx.testId}/start`).set('Cookie', ctx.cookie);
    const id = start.body.attempt.id;
    await put(ctx, id, ctx.mcq._id, { selected: ['B'] });
    await put(ctx, id, ctx.fill._id, { values: { b1: 'Rome', b2: '4' } });

    expect((await request(ctx.app).get(`/api/attempts/${id}/result`).set('Cookie', ctx.cookie)).status).toBe(409);

    const submit = await request(ctx.app).post(`/api/attempts/${id}/submit`).set('Cookie', ctx.cookie);
    expect(submit.status).toBe(200);
    expect(submit.body.attempt).toMatchObject({ status: 'submitted', score: 3, rank: 1 });
    expect(submit.body.feedbackAvailable).toBe(true);
    const mcqFeedback = submit.body.questions.find((q) => q.question.id === String(ctx.mcq._id)).feedback;
    expect(mcqFeedback).toMatchObject({ isCorrect: true, correctAnswer: { correctOptionIds: ['B'] } });
    expect(JSON.stringify(submit.body)).not.toContain('9876543210');

    // Saving after submit is rejected; submitting twice is idempotent.
    expect((await put(ctx, id, ctx.mcq._id, { selected: ['A'] })).status).toBe(409);
    expect((await request(ctx.app).post(`/api/attempts/${id}/submit`).set('Cookie', ctx.cookie)).status).toBe(200);
    // maxAttempts = 1
    const again = await request(ctx.app).post(`/api/tests/${ctx.testId}/start`).set('Cookie', ctx.cookie);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('NO_ATTEMPTS_LEFT');
  });

  it('own live score and rank', async () => {
    const start = await request(ctx.app).post(`/api/tests/${ctx.testId}/start`).set('Cookie', ctx.cookie);
    await put(ctx, start.body.attempt.id, ctx.mcq._id, { selected: ['B'] });
    const me = await request(ctx.app).get(`/api/tests/${ctx.testId}/me`).set('Cookie', ctx.cookie);
    expect(me.body).toEqual({
      testId: ctx.testId,
      attempted: true,
      visible: true,
      status: 'in_progress',
      score: 2,
      rank: 1,
    });
  });
});

describe('feedback modes and visibility', () => {
  it('after_test hides feedback until the test ends', async () => {
    const ctx = await setup({ settings: { feedbackMode: 'after_test', liveScoreVisible: false } });
    const start = await request(ctx.app).post(`/api/tests/${ctx.testId}/start`).set('Cookie', ctx.cookie);
    expect(start.body.attempt.score).toBeNull();
    const save = await put(ctx, start.body.attempt.id, ctx.mcq._id, { selected: ['B'] });
    expect(save.body).not.toHaveProperty('score');

    const submit = await request(ctx.app)
      .post(`/api/attempts/${start.body.attempt.id}/submit`)
      .set('Cookie', ctx.cookie);
    expect(submit.body.feedbackAvailable).toBe(false);
    expect(submit.body.questions).toEqual([]);
    expect(submit.body.attempt.score).toBeNull();
    expect(JSON.stringify(submit.body)).not.toContain('correctOptionIds');

    await request(ctx.app).post(`/api/admin/tests/${ctx.testId}/end`).set('Cookie', adminCookie());
    const result = await request(ctx.app)
      .get(`/api/attempts/${start.body.attempt.id}/result`)
      .set('Cookie', ctx.cookie);
    expect(result.body.feedbackAvailable).toBe(true);
    expect(result.body.attempt.score).toBe(2);
  });

  it('immediate mode reveals right/wrong per answer and locks it', async () => {
    const ctx = await setup({ settings: { feedbackMode: 'immediate' } });
    const start = await request(ctx.app).post(`/api/tests/${ctx.testId}/start`).set('Cookie', ctx.cookie);
    const id = start.body.attempt.id;
    const res = await put(ctx, id, ctx.mcq._id, { selected: ['A'] });
    expect(res.body).toMatchObject({ isCorrect: false, marksAwarded: -1 });
    // The correct answer itself is not sent during the attempt.
    expect(allKeys(res.body).has('correctOptionIds')).toBe(false);
    const again = await put(ctx, id, ctx.mcq._id, { selected: ['B'] });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ANSWER_LOCKED');
  });

  it('hides tests from other sections', async () => {
    const ctx = await setup({ allowedSections: ['B'] });
    expect((await request(ctx.app).get('/api/tests').set('Cookie', ctx.cookie)).body.tests).toEqual([]);
    expect((await request(ctx.app).post(`/api/tests/${ctx.testId}/start`).set('Cookie', ctx.cookie)).status).toBe(404);
  });

  it('does not start draft, published-but-not-started or ended tests', async () => {
    const ctx = await setup({ status: 'published' });
    const res = await request(ctx.app).post(`/api/tests/${ctx.testId}/start`).set('Cookie', ctx.cookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TEST_NOT_OPEN');
    await Test.updateOne({ _id: ctx.test._id }, { status: 'draft' });
    expect((await request(ctx.app).post(`/api/tests/${ctx.testId}/start`).set('Cookie', ctx.cookie)).status).toBe(404);
  });

  it('allows a retake when maxAttempts > 1 (latest attempt counts)', async () => {
    const ctx = await setup({ settings: { maxAttempts: 2 } });
    const first = await request(ctx.app).post(`/api/tests/${ctx.testId}/start`).set('Cookie', ctx.cookie);
    await put(ctx, first.body.attempt.id, ctx.mcq._id, { selected: ['B'] });
    await request(ctx.app).post(`/api/attempts/${first.body.attempt.id}/submit`).set('Cookie', ctx.cookie);
    const second = await request(ctx.app).post(`/api/tests/${ctx.testId}/start`).set('Cookie', ctx.cookie);
    expect(second.status).toBe(200);
    expect(second.body.attempt).toMatchObject({ attemptNumber: 2, score: 0 });
    expect(second.body.answers).toEqual([]);
    const stored = await Attempt.findById(second.body.attempt.id).lean();
    expect(stored.history).toEqual([expect.objectContaining({ attemptNumber: 1, score: 2 })]);
  });
});

describe('server-enforced time', () => {
  it('rejects saves after expiry and auto-submits', async () => {
    const ctx = await setup();
    const start = await request(ctx.app).post(`/api/tests/${ctx.testId}/start`).set('Cookie', ctx.cookie);
    const id = start.body.attempt.id;
    await put(ctx, id, ctx.mcq._id, { selected: ['B'] });
    await Attempt.updateOne({ _id: id }, { expiresAt: new Date(Date.now() - 60_000) });

    const res = await put(ctx, id, ctx.fill._id, { values: { b1: 'Paris' } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ATTEMPT_EXPIRED');
    const attempt = await Attempt.findById(id).lean();
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.score).toBe(2);
  });

  it('accepts saves within the short grace period', async () => {
    const ctx = await setup();
    const start = await request(ctx.app).post(`/api/tests/${ctx.testId}/start`).set('Cookie', ctx.cookie);
    await Attempt.updateOne({ _id: start.body.attempt.id }, { expiresAt: new Date(Date.now() - 1000) });
    expect((await put(ctx, start.body.attempt.id, ctx.mcq._id, { selected: ['B'] })).status).toBe(200);
  });

  it('the sweeper auto-submits expired attempts and ends tests past endsAt', async () => {
    const ctx = await setup();
    const start = await request(ctx.app).post(`/api/tests/${ctx.testId}/start`).set('Cookie', ctx.cookie);
    await Attempt.updateOne({ _id: start.body.attempt.id }, { expiresAt: new Date(Date.now() - 60_000) });
    const sweep = await runSweep();
    expect(sweep.autoSubmitted).toBe(1);
    const attempt = await Attempt.findById(start.body.attempt.id).lean();
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.submittedAt.getTime()).toBe(attempt.expiresAt.getTime());

    await Test.updateOne({ _id: ctx.test._id }, { endsAt: new Date(Date.now() - 1000) });
    expect((await runSweep()).ended).toBe(1);
    expect((await Test.findById(ctx.test._id).lean()).status).toBe('ended');
  });

  it('the sweeper starts published tests at startsAt', async () => {
    const { test } = await createTestWithQuestions({ status: 'published', startsAt: new Date(Date.now() - 1000) });
    expect((await runSweep()).started).toBe(1);
    expect((await Test.findById(test._id).lean()).status).toBe('live');
  });

  it('caps the attempt at the test end time', async () => {
    const ctx = await setup({ endsAt: new Date(Date.now() + 5 * 60_000) });
    const start = await request(ctx.app).post(`/api/tests/${ctx.testId}/start`).set('Cookie', ctx.cookie);
    const expiresIn = new Date(start.body.attempt.expiresAt) - new Date(start.body.serverNow);
    expect(expiresIn).toBeLessThanOrEqual(5 * 60_000);
  });
});
