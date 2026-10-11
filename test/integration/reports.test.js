import ExcelJS from 'exceljs';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { QUESTION_JSON_TEMPLATE } from '../../src/export/templates.js';
import { questionInput } from '../../src/schemas/question.schemas.js';
import { useTestDb } from '../helpers/db.js';
import { adminCookie, createParticipant, createTestWithQuestions, participantCookie } from '../helpers/factories.js';

useTestDb();

function binaryParser(res, cb) {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

async function seed(app) {
  const { test, questions } = await createTestWithQuestions();
  const [mcq, fill, , snippet] = questions;
  const people = [
    await createParticipant({
      urn: 'E25B000001',
      name: '=HYPERLINK("http://evil")',
      mobile: '9000000001',
      section: 'A',
    }),
    await createParticipant({ urn: 'E25B000002', name: 'Ravi', mobile: '9000000002', section: 'B' }),
    await createParticipant({ urn: 'E25B000003', name: 'Meera', mobile: '9000000003', section: 'B' }),
  ];
  const answers = [
    [{ selected: ['B'] }, { values: { b1: 'Paris', b2: '4' } }],
    [{ selected: ['A'] }, { values: { b1: '+cmd', b2: '4' } }],
    [{ selected: ['C'] }, null],
  ];
  for (const [i, p] of people.entries()) {
    const cookie = await participantCookie(p);
    const start = await request(app).post(`/api/tests/${test._id}/start`).set('Cookie', cookie);
    const id = start.body.attempt.id;
    await request(app)
      .put(`/api/attempts/${id}/answers/${mcq._id}`)
      .set('Cookie', cookie)
      .send({ response: answers[i][0], timeSpentMs: 4000 });
    if (answers[i][1])
      await request(app)
        .put(`/api/attempts/${id}/answers/${fill._id}`)
        .set('Cookie', cookie)
        .send({ response: answers[i][1] });
    if (i === 2)
      await request(app)
        .put(`/api/attempts/${id}/answers/${snippet._id}`)
        .set('Cookie', cookie)
        .send({ response: { answer: '=SUM(1,2)' } });
    if (i < 2) await request(app).post(`/api/attempts/${id}/submit`).set('Cookie', cookie);
  }
  return { test, mcq };
}

describe('admin reports', () => {
  let app;
  beforeEach(() => {
    app = createApp();
  });

  it('builds a ranked leaderboard with counts and per-question stats', async () => {
    const { test, mcq } = await seed(app);
    const res = await request(app).get(`/api/admin/tests/${test._id}/leaderboard`).set('Cookie', adminCookie());
    expect(res.body.counts).toEqual({ started: 3, inProgress: 1, submitted: 2 });
    expect(res.body.entries.map((e) => [e.urn, e.score, e.rank])).toEqual([
      ['E25B000001', 4, 1],
      ['E25B000002', 0, 2],
      ['E25B000003', -1, 3],
    ]);
    const stat = res.body.questionStats.find((q) => q.questionId === String(mcq._id));
    expect(stat).toMatchObject({ answered: 3, correct: 1 });

    const sectionB = await request(app)
      .get(`/api/admin/tests/${test._id}/leaderboard?section=B`)
      .set('Cookie', adminCookie());
    expect(sectionB.body.entries.map((e) => e.urn)).toEqual(['E25B000002', 'E25B000003']);
  });

  it('computes analytics per participant, question and section', async () => {
    const { test, mcq } = await seed(app);
    const res = await request(app).get(`/api/admin/tests/${test._id}/analytics`).set('Cookie', adminCookie());
    expect(res.body.participants[0]).toMatchObject({ urn: 'E25B000001', mobile: '9000000001', correct: 2 });
    const q = res.body.perQuestion.find((x) => x.questionId === String(mcq._id));
    expect(q).toMatchObject({ attempts: 3, correct: 1, percentCorrect: 33.3, avgTimeMs: 4000 });
    expect(q.mostChosenWrongOption.count).toBe(1);
    expect(res.body.perSection).toEqual([
      { section: 'A', participants: 1, submitted: 1, average: 4, max: 4, min: 4 },
      { section: 'B', participants: 2, submitted: 1, average: -0.5, max: 0, min: -1 },
    ]);
  });

  it('exports an Excel workbook with text URN/mobile cells and formula-injection guard', async () => {
    const { test } = await seed(app);
    const res = await request(app)
      .get(`/api/admin/tests/${test._id}/export.xlsx`)
      .set('Cookie', adminCookie())
      .buffer(true)
      .parse(binaryParser);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('Round-1-results.xlsx');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Leaderboard',
      'Responses',
      'Question Analytics',
      'Section Summary',
    ]);

    const lb = wb.getWorksheet('Leaderboard');
    expect(lb.getRow(1).values.slice(1)).toEqual([
      'Rank',
      'URN',
      'Name',
      'Mobile',
      'Section',
      'Score',
      'Time Taken',
      'Status',
    ]);
    const first = lb.getRow(2);
    expect(first.getCell(2).value).toBe('E25B000001');
    expect(first.getCell(4).value).toBe('9000000001');
    expect(typeof first.getCell(4).value).toBe('string');
    expect(first.getCell(3).value).toBe(`'=HYPERLINK("http://evil")`);

    const responses = wb.getWorksheet('Responses');
    const values = [];
    responses.eachRow((row) => values.push(...row.values.filter((v) => typeof v === 'string')));
    expect(values).toContain('b1: +cmd | b2: 4');
    expect(values).toContain(`'=SUM(1,2)`);
    expect(values.some((v) => /^[=+@-]/.test(v))).toBe(false);
  });

  it('exports a single section', async () => {
    const { test } = await seed(app);
    const res = await request(app)
      .get(`/api/admin/tests/${test._id}/export.xlsx?section=B`)
      .set('Cookie', adminCookie())
      .buffer(true)
      .parse(binaryParser);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    expect(wb.getWorksheet('Leaderboard').rowCount).toBe(3);
  });

  it('shows an admin the full attempt of one participant', async () => {
    const { test } = await seed(app);
    const lb = await request(app).get(`/api/admin/tests/${test._id}/leaderboard`).set('Cookie', adminCookie());
    const res = await request(app)
      .get(`/api/admin/tests/${test._id}/attempts/${lb.body.entries[0].attemptId}`)
      .set('Cookie', adminCookie());
    expect(res.body.participant).toMatchObject({ urn: 'E25B000001', mobile: '9000000001' });
    expect(res.body.items).toHaveLength(4);
    expect(res.body.items[0].answer).toMatchObject({ isCorrect: true });
  });
});

describe('question templates', () => {
  it('the JSON template validates against the question schema', () => {
    for (const q of QUESTION_JSON_TEMPLATE.questions) {
      const parsed = questionInput.safeParse(q);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });
});
