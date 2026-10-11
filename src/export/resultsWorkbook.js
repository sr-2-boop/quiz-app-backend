import ExcelJS from 'exceljs';
import { safeCell } from './sanitize.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const TEXT = '@';
const DURATION = '[h]:mm:ss';
const HEADER_STYLE = {
  font: { bold: true },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } },
};

const STATUS_LABELS = { in_progress: 'In progress', submitted: 'Submitted', auto_submitted: 'Auto-submitted' };
const TYPE_LABELS = { mcq: 'MCQ', fill_blank: 'Fill in the blank', debug: 'Debug', snippet: 'Snippet' };

function preview(text, max = 150) {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Human-readable response for the Responses sheet. */
export function formatResponse(question, response) {
  if (!response) return '';
  switch (question.type) {
    case 'mcq':
      return (response.selected ?? [])
        .map((id) => `${id}) ${question.options?.find((o) => o.id === id)?.text ?? ''}`)
        .join('; ');
    case 'fill_blank':
      return Object.entries(response.values ?? {})
        .map(([id, value]) => `${id}: ${value}`)
        .join(' | ');
    case 'debug':
      return response.code ?? response.answer ?? '';
    case 'snippet':
      if (question.answerMode === 'mcq' && response.answer) {
        return `${response.answer}) ${question.options?.find((o) => o.id === response.answer)?.text ?? ''}`;
      }
      return response.answer ?? '';
    default:
      return '';
  }
}

function resultLabel(answer) {
  if (!answer || !answer.answered) return 'Unanswered';
  if (answer.status === 'pending') return 'Pending';
  if (answer.isCorrect) return 'Correct';
  return answer.marksAwarded > 0 ? 'Partial' : 'Wrong';
}

function styleHeader(sheet) {
  sheet.getRow(1).eachCell((cell) => {
    cell.font = HEADER_STYLE.font;
    cell.fill = /** @type {any} */ (HEADER_STYLE.fill);
  });
}

function addSheet(workbook, name, columns) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns;
  styleHeader(sheet);
  return sheet;
}

/**
 * Stream the results workbook (Leaderboard, Responses, Question Analytics, Section Summary) to `stream`.
 * Every user-originated string goes through safeCell (formula-injection guard); URN and Mobile are text cells.
 * @param {import('node:stream').Writable} stream
 * @param {{ questions: any[], attempts: any[], analytics: ReturnType<typeof import('../services/analytics.service.js').computeAnalytics>, mobiles: Map<string, string> }} data
 */
export async function writeResultsWorkbook(stream, { questions, attempts, analytics, mobiles }) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });

  // 1. Leaderboard
  const leaderboard = addSheet(workbook, 'Leaderboard', [
    { header: 'Rank', key: 'rank', width: 7 },
    { header: 'URN', key: 'urn', width: 16, style: { numFmt: TEXT } },
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Mobile', key: 'mobile', width: 14, style: { numFmt: TEXT } },
    { header: 'Section', key: 'section', width: 12 },
    { header: 'Score', key: 'score', width: 9 },
    { header: 'Time Taken', key: 'time', width: 12, style: { numFmt: DURATION } },
    { header: 'Status', key: 'status', width: 15 },
  ]);
  for (const p of analytics.participants) {
    leaderboard
      .addRow({
        rank: p.rank,
        urn: safeCell(p.urn),
        name: safeCell(p.name),
        mobile: safeCell(mobiles.get(p.participantId) ?? ''),
        section: safeCell(p.section),
        score: p.score,
        time: p.timeTakenMs / DAY_MS,
        status: STATUS_LABELS[p.status] ?? p.status,
      })
      .commit();
  }
  leaderboard.commit();

  // 2. Responses: one row per participant per question
  const responses = addSheet(workbook, 'Responses', [
    { header: 'Rank', key: 'rank', width: 7 },
    { header: 'URN', key: 'urn', width: 16, style: { numFmt: TEXT } },
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Section', key: 'section', width: 12 },
    { header: 'Q#', key: 'number', width: 5 },
    { header: 'Type', key: 'type', width: 16 },
    { header: 'Question', key: 'question', width: 40 },
    { header: 'Response', key: 'response', width: 40 },
    { header: 'Result', key: 'result', width: 12 },
    { header: 'Marks', key: 'marks', width: 8 },
    { header: 'Time Spent', key: 'time', width: 11, style: { numFmt: DURATION } },
  ]);
  const attemptsById = new Map(attempts.map((a) => [String(a._id), a]));
  for (const p of analytics.participants) {
    const attempt = attemptsById.get(p.attemptId);
    const answers = new Map(attempt.answers.map((a) => [String(a.questionId), a]));
    questions.forEach((q, i) => {
      const answer = answers.get(String(q._id));
      responses
        .addRow({
          rank: p.rank,
          urn: safeCell(p.urn),
          name: safeCell(p.name),
          section: safeCell(p.section),
          number: i + 1,
          type: TYPE_LABELS[q.type],
          question: safeCell(preview(q.statement)),
          response: safeCell(formatResponse(q, answer?.response)),
          result: resultLabel(answer),
          marks: answer?.status === 'graded' ? answer.marksAwarded : null,
          time: answer?.timeSpentMs ? answer.timeSpentMs / DAY_MS : null,
        })
        .commit();
    });
  }
  responses.commit();

  // 3. Question analytics
  const questionSheet = addSheet(workbook, 'Question Analytics', [
    { header: 'Q#', key: 'number', width: 5 },
    { header: 'Type', key: 'type', width: 16 },
    { header: 'Question', key: 'question', width: 50 },
    { header: 'Marks', key: 'marks', width: 8 },
    { header: 'Attempts', key: 'attempts', width: 10 },
    { header: 'Correct', key: 'correct', width: 9 },
    { header: '% Correct', key: 'percent', width: 10 },
    { header: 'Avg Time', key: 'avgTime', width: 10, style: { numFmt: DURATION } },
    { header: 'Most-chosen Wrong Option', key: 'wrong', width: 30 },
    { header: 'Times Chosen', key: 'wrongCount', width: 12 },
  ]);
  for (const q of analytics.perQuestion) {
    questionSheet
      .addRow({
        number: q.number,
        type: TYPE_LABELS[q.type],
        question: safeCell(preview(q.statement, 300)),
        marks: q.marks,
        attempts: q.attempts,
        correct: q.correct,
        percent: q.percentCorrect,
        avgTime: q.avgTimeMs != null ? q.avgTimeMs / DAY_MS : null,
        wrong: q.mostChosenWrongOption
          ? safeCell(`${q.mostChosenWrongOption.id}) ${q.mostChosenWrongOption.text}`)
          : '',
        wrongCount: q.mostChosenWrongOption?.count ?? null,
      })
      .commit();
  }
  questionSheet.commit();

  // 4. Section summary
  const sectionSheet = addSheet(workbook, 'Section Summary', [
    { header: 'Section', key: 'section', width: 14 },
    { header: 'Participants', key: 'participants', width: 13 },
    { header: 'Submitted', key: 'submitted', width: 11 },
    { header: 'Average', key: 'average', width: 10 },
    { header: 'Max', key: 'max', width: 8 },
    { header: 'Min', key: 'min', width: 8 },
  ]);
  for (const s of analytics.perSection) {
    sectionSheet
      .addRow({
        section: safeCell(s.section || '(no section)'),
        participants: s.participants,
        submitted: s.submitted,
        average: s.average,
        max: s.max,
        min: s.min,
      })
      .commit();
  }
  sectionSheet.commit();

  await workbook.commit();
}
