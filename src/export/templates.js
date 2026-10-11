import ExcelJS from 'exceljs';

// Downloadable import templates for admins.

export const QUESTION_JSON_TEMPLATE = {
  questions: [
    {
      type: 'mcq',
      statement: 'Which data structure uses **LIFO** order?',
      marks: 2,
      negativeMarks: 0.5,
      options: [
        { id: 'A', text: 'Queue' },
        { id: 'B', text: 'Stack' },
        { id: 'C', text: 'Heap' },
        { id: 'D', text: 'Graph' },
      ],
      correctOptionIds: ['B'],
      multiSelect: false,
      explanation: 'A stack pops the most recently pushed element first.',
    },
    {
      type: 'fill_blank',
      statement: 'Binary search runs in {{b1}} time, and $2^{10}$ equals {{b2}}.',
      marks: 2,
      blanks: [
        { id: 'b1', acceptedAnswers: ['O(log n)', 'O(logn)'], caseSensitive: false },
        { id: 'b2', acceptedAnswers: ['1024'] },
      ],
      explanation: '',
    },
    {
      type: 'debug',
      statement: 'Fix the bug so the function returns the sum of the list. Write the corrected line.',
      marks: 3,
      language: 'python',
      code: 'def total(xs):\n    s = 0\n    for x in xs:\n        s = x\n    return s',
      grading: 'answer',
      acceptedFixes: ['s += x', 's = s + x'],
      explanation: 'The accumulator must add each element.',
    },
    {
      type: 'debug',
      statement: 'Fix the program so it prints the sum of two integers read from input.',
      marks: 5,
      language: 'python',
      code: 'a, b = input().split()\nprint(a + b)',
      grading: 'run',
      testCases: [
        { input: '2 3', expectedOutput: '5', hidden: false, weight: 1 },
        { input: '-4 10', expectedOutput: '6', hidden: true, weight: 2 },
      ],
      fixedCode: 'a, b = map(int, input().split())\nprint(a + b)',
      allOrNothing: false,
      explanation: 'input() returns strings; convert them to integers first.',
    },
    {
      type: 'snippet',
      statement: 'What is the output of this program?',
      marks: 2,
      language: 'c',
      code: '#include <stdio.h>\nint main() {\n  int i = 5;\n  printf("%d", i++ + ++i);\n  return 0;\n}',
      answerMode: 'mcq',
      options: [
        { id: 'A', text: '11' },
        { id: 'B', text: '12' },
        { id: 'C', text: 'Undefined behaviour' },
      ],
      correctOptionIds: ['C'],
      explanation: 'Modifying i twice without a sequence point is undefined behaviour.',
    },
    {
      type: 'snippet',
      statement: 'What does this print?',
      marks: 1,
      language: 'javascript',
      code: 'console.log([1, 2, 3].map((x) => x * 2).join("-"));',
      answerMode: 'text',
      expectedOutput: '2-4-6',
    },
  ],
};

const QUESTION_COLUMNS = [
  'type',
  'statement',
  'marks',
  'negativeMarks',
  'explanation',
  'optionA',
  'optionB',
  'optionC',
  'optionD',
  'optionE',
  'optionF',
  'correct',
  'multiSelect',
  'answers',
  'caseSensitive',
];

function textColumns(sheet, count) {
  for (let i = 1; i <= count; i++) sheet.getColumn(i).numFmt = '@';
}

export async function questionXlsxTemplate() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Questions');
  sheet.columns = QUESTION_COLUMNS.map((header) => ({ header, key: header, width: header === 'statement' ? 50 : 16 }));
  textColumns(sheet, QUESTION_COLUMNS.length);
  sheet.getRow(1).font = { bold: true };
  sheet.addRow({
    type: 'mcq',
    statement: 'Which of these are prime numbers?',
    marks: '2',
    negativeMarks: '0',
    optionA: '2',
    optionB: '4',
    optionC: '7',
    optionD: '9',
    correct: 'A,C',
    multiSelect: 'TRUE',
  });
  sheet.addRow({
    type: 'fill_blank',
    statement: 'The capital of France is {{b1}} and 2 + 2 = {{b2}}.',
    marks: '2',
    answers: 'Paris ; 4|four',
    caseSensitive: 'FALSE',
  });

  const help = workbook.addWorksheet('Instructions');
  help.getColumn(1).width = 110;
  [
    'Spreadsheet import supports "mcq" and "fill_blank" questions. Use the JSON template for debug/snippet questions.',
    'The first sheet is imported. Keep the header row; one question per row.',
    'statement / explanation: Markdown. Math with $inline$ or $$block$$ LaTeX.',
    'mcq: fill optionA..optionF (at least two). "correct" lists the correct letters, e.g. B or A,C.',
    'mcq: multiSelect TRUE allows several answers (default: TRUE when more than one letter is correct).',
    'fill_blank: mark blanks in the statement as {{b1}}, {{b2}} ... in order.',
    'fill_blank: "answers" has one group per blank separated by ";", alternatives separated by "|" (e.g. Paris ; 4|four).',
    'fill_blank: caseSensitive TRUE makes matching case-sensitive (default FALSE). Marks are split equally across blanks.',
    'negativeMarks is optional (default 0). Unanswered questions score 0.',
  ].forEach((line) => help.addRow([line]));

  return workbook.xlsx.writeBuffer();
}

export async function rosterXlsxTemplate() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Roster');
  sheet.columns = [
    { header: 'URN', key: 'urn', width: 16 },
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Mobile', key: 'mobile', width: 14 },
    { header: 'Section', key: 'section', width: 12 },
  ];
  textColumns(sheet, 4);
  sheet.getRow(1).font = { bold: true };
  sheet.addRow({ urn: 'E25B002749', name: 'Example Student', mobile: '9876543210', section: 'A' });
  return workbook.xlsx.writeBuffer();
}
