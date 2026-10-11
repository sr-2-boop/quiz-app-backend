import ExcelJS from 'exceljs';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { AccessKey, Attempt, Participant, Question, Test } from '../../src/models/index.js';
import { useTestDb } from '../helpers/db.js';
import {
  adminCookie,
  createParticipant,
  createTestWithQuestions,
  participantCookie,
  sampleQuestions,
} from '../helpers/factories.js';

useTestDb();

let app;
let admin;
beforeEach(() => {
  app = createApp();
  admin = adminCookie();
});

const csv = (text) => Buffer.from(text, 'utf8');

describe('roster import', () => {
  const file = csv(
    [
      'URN,Name,Mobile,Section',
      'e25b002749,Asha Verma,+91 98765 43210,A',
      'E25B002750,Ravi Kumar,9876543211,B',
      'BAD,No Urn,9876543212,A',
      'E25B002751,,12345,A',
      'E25B002750,Dup Row,9876543213,B',
    ].join('\n'),
  );

  it('previews with row-level errors and saves nothing', async () => {
    const res = await request(app)
      .post('/api/admin/participants/import?mode=preview')
      .set('Cookie', admin)
      .attach('file', file, { filename: 'roster.csv', contentType: 'text/csv' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalRows: 5, validRows: 2, invalidRows: 3, toCreate: 2, toUpdate: 0 });
    expect(res.body.errors.map((e) => e.row)).toEqual([4, 5, 5, 6]);
    expect(await Participant.countDocuments()).toBe(0);
  });

  it('commits valid rows as an upsert by URN and never deletes missing participants', async () => {
    await createParticipant({ urn: 'E25B999999', mobile: '9999999999' });
    await createParticipant({ urn: 'E25B002749', name: 'Old Name', mobile: '9000000000' });
    const res = await request(app)
      .post('/api/admin/participants/import?mode=commit')
      .set('Cookie', admin)
      .attach('file', file, { filename: 'roster.csv', contentType: 'text/csv' });
    expect(res.body).toMatchObject({ validRows: 2, toCreate: 1, toUpdate: 1 });
    const asha = await Participant.findOne({ urn: 'E25B002749' }).lean();
    expect(asha).toMatchObject({ name: 'Asha Verma', mobile: '9876543210', section: 'A' });
    expect(await Participant.exists({ urn: 'E25B999999' })).toBeTruthy();
    expect(await Participant.countDocuments()).toBe(3);
  });

  it('reads .xlsx rosters', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Roster');
    ws.addRow(['URN', 'Name', 'Mobile', 'Section']);
    ws.addRow(['E25B002749', 'Asha Verma', 9876543210, 'A']);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const res = await request(app)
      .post('/api/admin/participants/import?mode=commit')
      .set('Cookie', admin)
      .attach('file', buffer, {
        filename: 'roster.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    expect(res.status).toBe(200);
    expect(await Participant.findOne({ urn: 'E25B002749' }).lean()).toMatchObject({ mobile: '9876543210' });
  });

  it('accepts common header spellings and mobile formats', async () => {
    const res = await request(app)
      .post('/api/admin/participants/import?mode=commit')
      .set('Cookie', admin)
      .attach(
        'file',
        csv(
          [
            'URN No.,Student Name,Mobile Number,Sec',
            'E25B002749,Asha Verma,919876543210,A',
            'E25B002750,Ravi Kumar,09876543211,B',
          ].join('\n'),
        ),
        { filename: 'roster.csv', contentType: 'text/csv' },
      );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ validRows: 2, invalidRows: 0 });
    expect(await Participant.findOne({ urn: 'E25B002749' }).lean()).toMatchObject({
      name: 'Asha Verma',
      mobile: '9876543210',
      section: 'A',
    });
    expect(await Participant.findOne({ urn: 'E25B002750' }).lean()).toMatchObject({ mobile: '9876543211' });
  });

  it('rejects unsupported or fake files', async () => {
    const exe = await request(app)
      .post('/api/admin/participants/import')
      .set('Cookie', admin)
      .attach('file', csv('MZ...'), { filename: 'roster.exe', contentType: 'application/octet-stream' });
    expect(exe.status).toBe(400);
    const fakeXlsx = await request(app)
      .post('/api/admin/participants/import')
      .set('Cookie', admin)
      .attach('file', csv('not a zip'), {
        filename: 'roster.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    expect(fakeXlsx.status).toBe(400);
    expect(fakeXlsx.body.error.code).toBe('INVALID_FILE');
  });

  it('lists participants with mobiles for admins and deactivation ends sessions', async () => {
    const p = await createParticipant();
    const cookie = await participantCookie(p);
    const list = await request(app).get('/api/admin/participants?search=asha').set('Cookie', admin);
    expect(list.body.items[0]).toMatchObject({ urn: 'E25B002749', mobile: '9876543210' });
    expect(list.body.items[0]).not.toHaveProperty('activeSessionId');

    const res = await request(app)
      .patch(`/api/admin/participants/${p._id}`)
      .set('Cookie', admin)
      .send({ isActive: false });
    expect(res.body.participant.isActive).toBe(false);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
  });
});

describe('access keys', () => {
  it('creates a key, returns it once and stores only a hash', async () => {
    const res = await request(app)
      .post('/api/admin/access-keys')
      .set('Cookie', admin)
      .send({
        label: 'Day 1',
        validFrom: new Date(Date.now() - 1000).toISOString(),
        validUntil: new Date(Date.now() + 3600_000).toISOString(),
      });
    expect(res.status).toBe(201);
    expect(res.body.key).toMatch(/^[A-Z0-9]{6}$/);
    expect(res.body.accessKey).not.toHaveProperty('keyHash');
    expect(res.body.accessKey.isCurrentlyValid).toBe(true);
    const stored = await AccessKey.findOne().select('+keyHash').lean();
    expect(stored.keyHash).not.toContain(res.body.key);

    const list = await request(app).get('/api/admin/access-keys').set('Cookie', admin);
    expect(JSON.stringify(list.body)).not.toContain(res.body.key);
  });

  it('lets participants log in with the new key and rotates it', async () => {
    await createParticipant();
    const created = await request(app)
      .post('/api/admin/access-keys')
      .set('Cookie', admin)
      .send({
        label: 'Day 1',
        key: 'Alpha1',
        validFrom: new Date(Date.now() - 1000),
        validUntil: new Date(Date.now() + 3600_000),
      });
    const login = (key) =>
      request(app)
        .post('/api/auth/participant/login')
        .send({ urn: 'E25B002749', name: 'Asha Verma', mobile: '9876543210', password: `E25B002749${key}` });
    expect((await login('Alpha1')).status).toBe(200);

    const rotated = await request(app)
      .post(`/api/admin/access-keys/${created.body.accessKey.id}/rotate`)
      .set('Cookie', admin)
      .send({});
    expect((await login('Alpha1')).status).toBe(401);
    expect((await login(rotated.body.key)).status).toBe(200);

    await request(app).post(`/api/admin/access-keys/${created.body.accessKey.id}/deactivate`).set('Cookie', admin);
    expect((await login(rotated.body.key)).status).toBe(401);
  });

  it('validates the window', async () => {
    const res = await request(app)
      .post('/api/admin/access-keys')
      .set('Cookie', admin)
      .send({ label: 'x', validFrom: new Date(), validUntil: new Date(Date.now() - 1000) });
    expect(res.status).toBe(400);
  });
});

describe('tests and questions', () => {
  async function createDraft() {
    const res = await request(app)
      .post('/api/admin/tests')
      .set('Cookie', admin)
      .send({ title: 'Quiz', durationMinutes: 20, settings: { feedbackMode: 'after_submit' } });
    expect(res.status).toBe(201);
    return res.body.test;
  }

  it('creates questions of all four types and keeps totals in sync', async () => {
    const test = await createDraft();
    for (const q of [sampleQuestions.mcq, sampleQuestions.fillBlank, sampleQuestions.debug, sampleQuestions.snippet]) {
      const res = await request(app).post(`/api/admin/tests/${test.id}/questions`).set('Cookie', admin).send(q);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    const detail = await request(app).get(`/api/admin/tests/${test.id}`).set('Cookie', admin);
    expect(detail.body.test).toMatchObject({ totalMarks: 8, questionCount: 4 });
    const list = await request(app).get(`/api/admin/tests/${test.id}/questions`).set('Cookie', admin);
    expect(list.body.questions[0]).toMatchObject({ type: 'mcq', correctOptionIds: ['B'] });
  });

  it('validates question shapes', async () => {
    const test = await createDraft();
    const bad = [
      { ...sampleQuestions.mcq, correctOptionIds: ['Z'] },
      { ...sampleQuestions.mcq, correctOptionIds: ['A', 'B'] },
      { ...sampleQuestions.fillBlank, statement: 'No blanks here' },
      { ...sampleQuestions.debug, acceptedFixes: [] },
      { ...sampleQuestions.snippet, expectedOutput: undefined },
      { ...sampleQuestions.mcq, type: 'essay' },
      { ...sampleQuestions.mcq, extra: true },
      sampleQuestions.debugRun, // code execution is disabled in tests
    ];
    for (const q of bad) {
      expect(
        (await request(app).post(`/api/admin/tests/${test.id}/questions`).set('Cookie', admin).send(q)).status,
      ).toBe(400);
    }
  });

  it('replaces a question on edit (switching type drops old fields)', async () => {
    const test = await createDraft();
    const created = await request(app)
      .post(`/api/admin/tests/${test.id}/questions`)
      .set('Cookie', admin)
      .send(sampleQuestions.mcq);
    const res = await request(app)
      .put(`/api/admin/tests/${test.id}/questions/${created.body.question.id}`)
      .set('Cookie', admin)
      .send(sampleQuestions.snippet);
    expect(res.status).toBe(200);
    const stored = await Question.findById(created.body.question.id).lean();
    expect(stored.type).toBe('snippet');
    expect(stored.correctOptionIds).toBeUndefined();
    expect(stored.createdAt).toBeInstanceOf(Date);
  });

  it('runs the lifecycle draft -> published -> live -> ended and locks questions once live', async () => {
    const test = await createDraft();
    expect((await request(app).post(`/api/admin/tests/${test.id}/publish`).set('Cookie', admin)).status).toBe(409);
    await request(app).post(`/api/admin/tests/${test.id}/questions`).set('Cookie', admin).send(sampleQuestions.mcq);
    expect((await request(app).post(`/api/admin/tests/${test.id}/publish`).set('Cookie', admin)).body.test.status).toBe(
      'published',
    );
    expect((await request(app).post(`/api/admin/tests/${test.id}/start`).set('Cookie', admin)).body.test.status).toBe(
      'live',
    );
    const locked = await request(app)
      .post(`/api/admin/tests/${test.id}/questions`)
      .set('Cookie', admin)
      .send(sampleQuestions.mcq);
    expect(locked.status).toBe(409);

    const p = await createParticipant();
    const cookie = await participantCookie(p);
    const start = await request(app).post(`/api/tests/${test.id}/start`).set('Cookie', cookie);
    expect(start.status).toBe(200);

    const ended = await request(app).post(`/api/admin/tests/${test.id}/end`).set('Cookie', admin);
    expect(ended.body.test.status).toBe('ended');
    expect((await Attempt.findById(start.body.attempt.id).lean()).status).toBe('auto_submitted');
    expect((await request(app).delete(`/api/admin/tests/${test.id}`).set('Cookie', admin)).status).toBe(409);
  });

  it('reorders questions', async () => {
    const { test, questions } = await createTestWithQuestions({ status: 'draft' });
    const reversed = questions.map((q) => String(q._id)).reverse();
    const res = await request(app)
      .put(`/api/admin/tests/${test._id}/question-order`)
      .set('Cookie', admin)
      .send({ questionOrder: reversed });
    expect(res.body.test.questionOrder).toEqual(reversed);
    const bad = await request(app)
      .put(`/api/admin/tests/${test._id}/question-order`)
      .set('Cookie', admin)
      .send({ questionOrder: reversed.slice(1) });
    expect(bad.status).toBe(400);
  });
});

describe('question bulk import', () => {
  it('previews JSON with per-row errors, then commits only on confirm', async () => {
    const { test } = await createTestWithQuestions({ status: 'draft', questions: [] });
    const body = JSON.stringify({
      questions: [sampleQuestions.mcq, { ...sampleQuestions.mcq, options: [] }, sampleQuestions.snippet],
    });
    const attach = (mode) =>
      request(app)
        .post(`/api/admin/tests/${test._id}/questions/import?mode=${mode}`)
        .set('Cookie', admin)
        .attach('file', Buffer.from(body), { filename: 'q.json', contentType: 'application/json' });

    const preview = await attach('preview');
    expect(preview.body).toMatchObject({ totalRows: 3, validRows: 2, invalidRows: 1, imported: 0 });
    expect(preview.body.errors[0]).toMatchObject({ row: 2, path: 'options' });
    expect(await Question.countDocuments()).toBe(0);

    const commit = await attach('commit');
    expect(commit.body.imported).toBe(2);
    expect((await Test.findById(test._id).lean()).totalMarks).toBe(3);
  });

  it('imports mcq and fill_blank rows from CSV', async () => {
    const { test } = await createTestWithQuestions({ status: 'draft', questions: [] });
    const file = csv(
      [
        'type,statement,marks,negativeMarks,optionA,optionB,optionC,correct,answers',
        'mcq,Pick primes,2,0,2,4,7,"A,C",',
        'fill_blank,Capital {{b1}} and {{b2}},2,0,,,,,Paris ; 4|four',
        'debug,Not allowed here,2,0,,,,,',
      ].join('\n'),
    );
    const res = await request(app)
      .post(`/api/admin/tests/${test._id}/questions/import?mode=commit`)
      .set('Cookie', admin)
      .attach('file', file, { filename: 'q.csv', contentType: 'text/csv' });
    expect(res.body).toMatchObject({ validRows: 2, invalidRows: 1, imported: 2 });
    const mcq = await Question.findOne({ type: 'mcq' }).lean();
    expect(mcq).toMatchObject({ multiSelect: true, correctOptionIds: ['A', 'C'] });
    const fill = await Question.findOne({ type: 'fill_blank' }).lean();
    expect(fill.blanks[1].acceptedAnswers).toEqual(['4', 'four']);
  });

  it('serves the templates', async () => {
    const json = await request(app).get('/api/admin/templates/questions.json').set('Cookie', admin);
    expect(json.headers['content-disposition']).toContain('questions-template.json');
    const xlsx = await request(app).get('/api/admin/templates/questions.xlsx').set('Cookie', admin).buffer(true);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
  });
});
