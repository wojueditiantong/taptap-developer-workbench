import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtemp, rm} from 'node:fs/promises';
import {createStore} from '../lib/store.mjs';
import {createRunService} from '../lib/run-service.mjs';
import {fingerprintRun, parseCliOutput} from '../lib/cli.mjs';

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(toolRoot, '../..');
const context = {devId: '123', appId: '20001'};

async function fixture(t) {
  const output = await mkdtemp(path.join(toolRoot, 'tmp-test-'));
  t.after(() => rm(output, {recursive: true, force: true}));
  const calls = [];
  const store = createStore(output);
  const runCli = async args => {
    calls.push(args);
    return {ok: true, data: {received: args}};
  };
  return {service: createRunService({store, runCli, root}), store, calls};
}

test('写入先 dry-run，确认后保持业务参数和幂等键不变', async t => {
  const {service, calls} = await fixture(t);
  const input = {action: 'app.create', context, data: {title: '测试游戏', category: 'adventure', developer_role: 'developer', package_type: 'apk'}};
  const preview = await service.runAction(input);
  assert.equal(preview.status, 'awaiting_confirmation');
  assert.ok(preview.args.includes('--dry-run'));
  assert.equal(preview.args.includes('--yes'), false);
  await assert.rejects(() => service.confirmExecute(preview.id, '确认'), /确认创建游戏草稿/);
  const executed = await service.confirmExecute(preview.id, '确认创建游戏草稿');
  assert.equal(executed.status, 'succeeded');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].slice(0, -3), calls[1].slice(0, -3));
  assert.equal(calls[0].at(-1), '--dry-run');
  assert.equal(calls[1].at(-1), '--yes');
  assert.equal(calls[0].at(-2), calls[1].at(-2));
  assert.ok(calls[1].some(arg => arg.includes('测试游戏')));
});

test('同一预览重复确认返回原执行单，不再次调用 CLI', async t => {
  const {service, calls} = await fixture(t);
  const preview = await service.runAction({action: 'review.withdraw', context});
  const first = await service.confirmExecute(preview.id, '确认撤销审核');
  const second = await service.confirmExecute(preview.id, '确认撤销审核');
  assert.equal(first.id, second.id);
  assert.equal(calls.length, 2);
});

test('失败预览没有执行入口', async t => {
  const output = await mkdtemp(path.join(toolRoot, 'tmp-test-'));
  t.after(() => rm(output, {recursive: true, force: true}));
  const store = createStore(output);
  const service = createRunService({store, runCli: async () => ({ok: false, error: {type: 'validation'}}), root});
  const preview = await service.runAction({action: 'review.withdraw', context});
  assert.equal(preview.status, 'failed');
  await assert.rejects(() => service.confirmExecute(preview.id, '确认撤销审核'), /预览未成功/);
});

test('运营报告保留失败项，空日期不发送空字符串参数', async t => {
  const output = await mkdtemp(path.join(toolRoot, 'tmp-test-'));
  t.after(() => rm(output, {recursive: true, force: true}));
  const store = createStore(output);
  const calls = [];
  const service = createRunService({store, runCli: async args => {
    calls.push(args);
    return args.includes('download') || calls.length === 2
      ? {ok: false, error: {type: 'network', hint: 'offline'}}
      : {ok: true, data: {args}};
  }, root});
  const report = await service.runWorkflow('operations', {context});
  assert.equal(report.entries.length, 7);
  assert.deepEqual(report.range, {start_date: '', end_date: ''});
  assert.ok(report.entries.every(entry => entry.params));
  assert.ok(report.entries.some(entry => !entry.result.ok));
  const markdown = await store.getReport(report.id, 'markdown');
  assert.match(markdown, /offline/);
  assert.doesNotMatch(markdown, /读取成功[\s\S]*读取成功[\s\S]*读取成功[\s\S]*读取成功[\s\S]*读取成功[\s\S]*读取成功[\s\S]*读取成功/);
  const metricCall = calls.find(args => args.includes('get-dashboard-stats'));
  assert.doesNotMatch(metricCall.at(-1), /start_date/);
});

test('经营分析按相同天数读取前周期，不把周期标记发送给官方接口', async t => {
  const output = await mkdtemp(path.join(toolRoot, 'tmp-test-'));
  t.after(() => rm(output, {recursive: true, force: true}));
  const calls = [];
  const store = createStore(output);
  const service = createRunService({store, runCli: async args => { calls.push(args); return {ok: true, data: {result: {}}}; }, root});
  const report = await service.runWorkflow('operations', {context, start_date: '2026-10-25', end_date: '2026-10-31'});
  assert.equal(report.entries.length, 11);
  assert.deepEqual(report.comparisonRange, {start_date: '2026-10-18', end_date: '2026-10-24'});
  const previous = report.entries.filter(entry => entry.period === 'previous');
  assert.equal(previous.length, 4);
  assert.ok(previous.every(entry => entry.params.start_date === '2026-10-18' && entry.params.end_date === '2026-10-24'));
  assert.ok(calls.every(args => !args.includes('previous') && !args.includes('current')));
  const markdown = await store.getReport(report.id, 'markdown');
  assert.match(markdown, /对比范围：2026-10-18 至 2026-10-24/);
  const forumCall = calls.find(args => args.includes('get-forum-stats'));
  const forumInput = JSON.parse(forumCall.at(-1));
  assert.deepEqual(forumInput.type, ['forum_pv', 'forum_uv', 'content_create', 'comment_create']);
  assert.ok(forumInput.type.every(type => ['forum_pv', 'forum_uv', 'content_pv', 'forum_search', 'content_create', 'content_delete', 'content_move_label', 'comment_create'].includes(type)));
});

test('运行指纹稳定且输出中的敏感字段脱敏', () => {
  assert.equal(fingerprintRun('a', ['x']), fingerprintRun('a', ['x']));
  const parsed = parseCliOutput(JSON.stringify({ok: true, data: {access_token: 'secret', nested: {openid: 'user'}, safe: 1}}), '', 0);
  assert.equal(parsed.data.access_token, '[已脱敏]');
  assert.equal(parsed.data.nested.openid, '[已脱敏]');
  assert.equal(parsed.data.safe, 1);
});
