import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeOperations, operationsMarkdown} from '../lib/operations.mjs';
import {smokeData} from '../desktop/smoke-data.mjs';

const labels = {pv: '商店页访问', download: '下载', reserve: '预约', review: '评价趋势', topic: '社区帖子'};
const metricResult = (metric, endDate) => smokeData(['dashboard-stats', 'get-dashboard-stats', '--data', JSON.stringify({metric, start_date: '2026-10-25', end_date: endDate})]);
const entries = Object.entries(labels).flatMap(([metric, label]) => [
  {action: 'stats.metric', label, params: {metric}, result: metricResult(metric, '2999-01-07')},
  ...(['pv', 'download', 'reserve', 'review'].includes(metric) ? [{action: 'stats.metric', label, params: {metric}, period: 'previous', result: metricResult(metric, '2000-01-07')}] : []),
]);
entries.push(
  {action: 'feedback.reviews', label: '近期差评', result: smokeData(['player-feedback', 'list-reviews'])},
  {action: 'stats.forum', label: '论坛趋势', result: {ok: false, error: {hint: '当前账号没有论坛统计权限'}}},
);
const report = {
  kind: 'operations',
  context: {devId: '10001', appId: '20001'},
  range: {start_date: '2026-10-25', end_date: '2026-10-31'},
  comparisonRange: {start_date: '2026-10-18', end_date: '2026-10-24'},
  entries,
};

test('脱敏周报提取指标、趋势、来源和差评，而不是只显示读取状态', () => {
  const result = summarizeOperations(report.entries);
  assert.equal(result.kpis.find(item => item.key === 'visits').value, 8640);
  assert.equal(result.kpis.find(item => item.key === 'downloads').value, 1560);
  assert.equal(result.visitTrend.length, 7);
  assert.equal(result.downloadTrend.at(-1).value, 251);
  assert.equal(result.sources[0].label, '首页推荐');
  assert.equal(result.negativeReviews.length, 1);
  assert.equal(result.warnings.length, 1);
});

test('周报正文先展示摘要，原始返回折叠到附录', () => {
  const markdown = operationsMarkdown({...report, createdAt: '2026-10-31'});
  assert.match(markdown, /## 本期概览/);
  assert.match(markdown, /\| 商店页访问 \| 8,640 \|/);
  assert.match(markdown, /## 每日趋势/);
  assert.match(markdown, /<details><summary>官方原始返回（附录）<\/summary>/);
  assert.ok(markdown.indexOf('## 本期概览') < markdown.indexOf('官方原始返回（附录）'));
});
