import test from 'node:test';
import assert from 'node:assert/strict';
import {previousPeriodRange, summarizeOperations} from '../public/operations.mjs';

function metric(name, value, period = 'current') {
  const keys = {pv: 'pv_from_total', download: 'all_download_new', topic: 'topic', reserve: 'reserve'};
  return {
    label: name, action: 'stats.metric', params: {metric: name}, period,
    result: {ok: true, data: {result: {highlights: [{label: name, value: String(value)}], columns: [{key: keys[name] || name, label: name}, {key: 'index_feed', label: '首页推荐'}, {key: 'search', label: '搜索'}], series: [{timestamp: '2026-10-31', values: {[keys[name] || name]: value, ...(name === 'review' ? {score: 8.6} : {}), ...(name === 'pv' ? {index_feed: 80, search: 20} : {})}}]}}},
  };
}

test('前周期严格使用相同自然日数量并正确处理月份边界', () => {
  assert.deepEqual(previousPeriodRange({start_date: '2026-10-25', end_date: '2026-10-31'}), {start_date: '2026-10-18', end_date: '2026-10-24'});
  assert.deepEqual(previousPeriodRange({start_date: '2026-10-01', end_date: '2026-10-01'}), {start_date: '2026-09-30', end_date: '2026-09-30'});
  assert.equal(previousPeriodRange({start_date: '', end_date: ''}), null);
  assert.throws(() => previousPeriodRange({start_date: '2026-10-31', end_date: '2026-10-01'}), /不能晚于/);
  assert.throws(() => previousPeriodRange({start_date: '2026-02-30', end_date: '2026-03-01'}), /无效日期/);
});

test('经营分析提供同口径对比、来源占比、参考比和可执行动作', () => {
  const entries = [
    metric('pv', 100), metric('download', 10), metric('topic', 0), metric('reserve', 0), metric('review', 3),
    metric('pv', 80, 'previous'), metric('download', 5, 'previous'), metric('topic', 1, 'previous'), metric('reserve', 0, 'previous'),
    {action: 'feedback.reviews', period: 'current', result: {ok: true, data: {result: {list: [{score: 2, contents: '手机字体和地图看不清，界面需要优化', has_official_comment: false}, {score: 1, contents: '频繁闪退和卡顿', has_official_comment: false}]}}}},
  ];
  const summary = summarizeOperations(entries);
  assert.equal(summary.kpis.find(item => item.key === 'visits').comparison.percent, 25);
  assert.equal(summary.sources[0].label, '首页推荐');
  assert.equal(summary.sources[0].share, 80);
  assert.equal(summary.referenceRate.value, 10);
  assert.equal(summary.referenceRate.previous, 6.25);
  assert.equal(summary.reviewThemes.find(theme => theme.label === '操作与界面').count, 1);
  assert.equal(summary.reviewThemes.find(theme => theme.label === '性能与稳定性').count, 1);
  assert.equal(summary.actions[0].target, 'reviews');
  assert.match(summary.actions[0].detail, /不会自动/);
  assert.ok(summary.actions.some(action => action.title.includes('来源较集中')));
});

test('缺少前周期或总量为零时不制造增长率或转化率', () => {
  const summary = summarizeOperations([metric('pv', 0), metric('download', 0), metric('topic', 0)]);
  assert.equal(summary.kpis[0].comparison.percent, null);
  assert.equal(summary.referenceRate, null);
  assert.equal(summary.negativeReviews.length, 0);
  assert.ok(summary.actions.length > 0);
});
