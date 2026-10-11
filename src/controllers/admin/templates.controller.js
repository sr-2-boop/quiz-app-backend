import { QUESTION_JSON_TEMPLATE, questionXlsxTemplate, rosterXlsxTemplate } from '../../export/templates.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function questionsJson(_req, res) {
  res.attachment('questions-template.json');
  res.type('application/json').send(JSON.stringify(QUESTION_JSON_TEMPLATE, null, 2));
}

export async function questionsXlsx(_req, res) {
  res.attachment('questions-template.xlsx');
  res.type(XLSX).send(Buffer.from(await questionXlsxTemplate()));
}

export async function rosterXlsx(_req, res) {
  res.attachment('roster-template.xlsx');
  res.type(XLSX).send(Buffer.from(await rosterXlsxTemplate()));
}
