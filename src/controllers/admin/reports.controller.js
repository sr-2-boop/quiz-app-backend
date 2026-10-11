import { writeResultsWorkbook } from '../../export/resultsWorkbook.js';
import {
  computeAnalytics,
  getAnalytics,
  getAttemptDetail,
  loadTestData,
  mobilesFor,
} from '../../services/analytics.service.js';
import { buildAdminLeaderboard } from '../../services/standings.service.js';
import { getTest } from '../../services/test.service.js';

function fileSlug(value) {
  return (
    String(value)
      .replace(/[^\w-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'test'
  );
}

export async function leaderboard(req, res) {
  await getTest(req.params.id); // 404 for unknown tests
  res.json(await buildAdminLeaderboard(req.params.id, { section: req.query.section, fresh: true }));
}

export async function analytics(req, res) {
  res.json(await getAnalytics(req.params.id, { section: req.query.section }));
}

export async function attemptDetail(req, res) {
  res.json(await getAttemptDetail(req.params.id, req.params.attemptId));
}

export async function exportXlsx(req, res) {
  const { section } = req.query;
  const { test, questions, attempts } = await loadTestData(req.params.id, { section });
  const analyticsData = computeAnalytics({ questions, attempts });
  const mobiles = await mobilesFor(attempts);

  res.attachment(`${fileSlug(test.title)}${section ? `-${fileSlug(section)}` : ''}-results.xlsx`);
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await writeResultsWorkbook(res, { questions, attempts, analytics: analyticsData, mobiles });
}
