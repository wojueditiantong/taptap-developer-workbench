import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtemp, rm} from 'node:fs/promises';
import {summarizeRelease, releaseMarkdown} from '../public/release.mjs';
import {mediaChangeFromUpload} from '../public/release-studio.js';
import {createStore} from '../lib/store.mjs';
import {createRunService} from '../lib/run-service.mjs';

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(toolRoot, '../..');
const context = {devId: '123', appId: '456'};
const success = result => ({ok: true, data: {result}});

test('发布体检把必填缺口、入口状态、未知项和资质登记分开', () => {
  const entries = [
    {action: 'app.status', label: '上架分析', result: success({blockers: [{message: '完成自测'}]})},
    {action: 'app.module.basic', label: '基础资料', result: success({fields: {title: {label: '名称', current_value: '游戏', filled: true, state: 'required'}, icon: {label: '图标', current_value: null, filled: false, state: 'required'}}})},
    {action: 'app.module.assets', label: '素材', result: success({fields: {}})},
    {action: 'app.module.platform', label: '分发', result: success({fields: {region_flag_android: {field_id: 'region_flag_android', label: 'Android', current_value: 1, value_labels: {1: '敬请期待'}}}})},
    {action: 'app.module.release', label: '发布设置', result: success({fields: {}})},
    {action: 'app.packages', label: '包体', result: success({list: [{package_id: '9', status: 'ready'}], current_bindings: [], package_slots: {main: {available: true, expected: {kind: 'none'}}}})},
    {action: 'qualification.status', label: '资质', result: success({qualifications: [{qualification_type: 'software-copyright', status: 'pending_upload'}]})},
    {action: 'app.versions', label: '版本', result: {ok: false, error: {hint: '暂时不可用'}}},
  ];
  const summary = summarizeRelease(entries);
  assert.equal(summary.conclusion, '存在明确阻断项');
  assert.ok(summary.tasks.some(item => item.title === '基础资料：图标' && item.tab === 'profile'));
  assert.ok(summary.tasks.some(item => item.detail.includes('不会自动改变')));
  assert.equal(summary.unknown.length, 1);
  assert.equal(summary.qualifications[0].status, '尚未提供材料');
  assert.ok(!summary.tasks.some(item => item.title.includes('软件著作权')));
  const markdown = releaseMarkdown({context, entries, createdAt: '2026-10-31'});
  assert.ok(markdown.indexOf('## 待处理') < markdown.indexOf('官方原始返回'));
  assert.match(markdown, /不表示所有资质都必须提交/);
});

test('图片上传返回转换为带 info 的回填，截图只追加且空值快照为空数组', () => {
  const field = {field_id: 'screenshots', input_type: 'image_array', current_value: null};
  const info = {width: 1080, height: 1920, size: 1000, format: 'png'};
  const change = mediaChangeFromUpload(field, [field], {url: 'https://example.com/game.png', info});
  assert.deepEqual(change, {field_id: 'screenshots', value: {url: 'https://example.com/game.png', info}, expected: [], op: 'append'});
  assert.throws(() => mediaChangeFromUpload({...field, input_type: 'image'}, [field], {url: 'https://example.com/game.png', info: {width: 0, height: 100}}), /宽高/);
});

test('视频只写数字 videoId，宣传片与实机录屏不能复用', () => {
  const trailer = {field_id: 'trailer', input_type: 'video', current_value: null};
  const demo = {field_id: 'gameplay_demo_video', input_type: 'video', current_value: 8123};
  assert.deepEqual(mediaChangeFromUpload(trailer, [trailer, demo], {videoId: 8124}), {field_id: 'trailer', value: 8124, expected: []});
  assert.throws(() => mediaChangeFromUpload(trailer, [trailer, demo], {videoId: 8123}), /不能使用同一个/);
  assert.throws(() => mediaChangeFromUpload(trailer, [trailer, demo], {videoId: '8124'}), /数字/);
});

test('发布工作流读取资料、包体、分发、发布设置并保留参数', async t => {
  const output = await mkdtemp(path.join(toolRoot, 'tmp-test-'));
  t.after(() => rm(output, {recursive: true, force: true}));
  const store = createStore(output);
  const service = createRunService({store, runCli: async () => success({fields: {}, list: [], qualifications: []}), root});
  const report = await service.runWorkflow('release', {context});
  assert.equal(report.entries.length, 11);
  for (const action of ['app.module.basic', 'app.module.assets', 'app.module.platform', 'app.module.release', 'app.packages']) assert.ok(report.entries.some(entry => entry.action === action));
  assert.ok(report.entries.every(entry => entry.params));
  const markdown = await store.getReport(report.id, 'markdown');
  assert.match(markdown, /## 待处理/);
});
