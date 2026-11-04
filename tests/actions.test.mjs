import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildActionArgs, getAction, publicCatalog} from '../lib/actions.mjs';

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(toolRoot, '../..');
const context = {devId: '123', appId: '20001'};

test('只读动作使用显式上下文且不包含写入确认参数', () => {
  const {args} = buildActionArgs({action: 'app.status', context}, root);
  assert.deepEqual(args, ['app', 'analyze-app-status', '--dev-id', '123', '--app-id', '20001']);
  assert.equal(getAction('app.status').risk, 'read');
});

test('发帖选项只传官方接受的游戏 ID，不多传开发者 ID', () => {
  const {args} = buildActionArgs({action: 'community.options', context}, root);
  assert.deepEqual(args, ['community-management', 'get-community-forum-publish-options', '--app-id', '20001']);
});

test('资料写入要求 expected 且禁止 force 绕过', () => {
  assert.throws(() => buildActionArgs({action: 'app.saveChanges', context, data: {changes: [{field_id: 'title', value: 'x'}]}}, root), /expected/);
  assert.throws(() => buildActionArgs({action: 'app.saveChanges', context, data: {changes: [{field_id: 'title', value: 'x', force: true}]}}, root), /expected|force/);
  const {args} = buildActionArgs({action: 'app.saveChanges', context, data: {changes: [{field_id: 'title', expected: '旧', value: '新'}]}}, root);
  assert.equal(JSON.parse(args.at(-1)).changes[0].expected, '旧');
});

test('文件动作不能把路径指到工作区外', () => {
  assert.throws(() => buildActionArgs({action: 'upload.apk', context, file: '../outside.apk'}, root), /工作区/);
  const {args} = buildActionArgs({action: 'upload.apk', context, file: 'artifacts/game.apk'}, root);
  assert.equal(args[1], path.join(root, 'artifacts/game.apk'));
  assert.ok(args.includes('--app-id'));
});

test('提审预检与提交只接受一致的合法上线方式', () => {
  assert.throws(() => buildActionArgs({action: 'review.submit', context, data: {}}, root), /业务参数|release_schedule/);
  assert.throws(() => buildActionArgs({action: 'review.submit', context, data: {review_fingerprint: 'fp-1'}}, root), /release_schedule/);
  assert.throws(() => buildActionArgs({action: 'review.precheck', context, data: {release_schedule: {kind: 'scheduled_exact', release_time: Math.floor(Date.now() / 1000) + 60}}}, root), /6 小时/);
  const schedule = {kind: 'scheduled_exact', release_time: Math.floor(Date.now() / 1000) + 7 * 3600};
  const {args} = buildActionArgs({action: 'review.submit', context, data: {release_schedule: schedule}}, root);
  assert.deepEqual(JSON.parse(args.at(-1)), {release_schedule: schedule});
});

test('上传专用参数序列化为 flags，不塞进业务 data', () => {
  const pc = buildActionArgs({action: 'upload.pc', context, file: 'game.zip', data: {launch_exe: 'game/Game.exe', version: '1.2.0', windows_branch: 1}}, root);
  assert.ok(pc.args.includes('--launch-exe') && pc.args.includes('game/Game.exe'));
  assert.ok(pc.args.includes('--windows-branch') && pc.args.includes('1'));
  assert.ok(!pc.args.includes('--data'));
  assert.throws(() => buildActionArgs({action: 'upload.pc', context, file: 'game.zip', data: {launch_exe: 'Game.exe'}}, root), /版本号/);
  const video = buildActionArgs({action: 'upload.video', context, file: 'demo.mp4', data: {scene: 'trailer'}}, root);
  assert.ok(video.args.includes('--scene') && video.args.includes('trailer'));
  assert.ok(!video.args.includes('--data'));
  assert.throws(() => buildActionArgs({action: 'upload.video', context, file: 'demo.mp4', data: {scene: 'other'}}, root), /取值/);
  const h5 = buildActionArgs({action: 'upload.h5', context, file: 'h5.zip', data: {screen_orientation: 1}}, root);
  assert.ok(h5.args.includes('--screen-orientation') && h5.args.includes('1'));
});

test('包体绑定保留快照和候选类型，禁止补造或覆盖', () => {
  assert.throws(() => buildActionArgs({action: 'app.selectPackage', context, data: {slot: 'main', package: {type: 'apk', id: '123'}}}, root), /expected/);
  assert.throws(() => buildActionArgs({action: 'app.clearPackage', context, data: {slot: 'main'}}, root), /expected/);
  const data = {slot: 'windows', package: {type: 'windows', id: '456', branch: 1}, expected: {kind: 'none'}};
  const {args} = buildActionArgs({action: 'app.selectPackage', context, data}, root);
  assert.deepEqual(JSON.parse(args.at(-1)), data);
  assert.throws(() => buildActionArgs({action: 'app.selectPackage', context, data: {...data, package: {type: 'h5', id: '456', branch: 1}}}, root), /参数/);
});

test('普通资料保存不能修改上线方式，每批最多十项', () => {
  assert.throws(() => buildActionArgs({action: 'app.saveChanges', context, data: {changes: [{field_id: 'release_time', value: 1, expected: []}]}}, root), /审核上线/);
  const changes = Array.from({length: 11}, (_, index) => ({field_id: `field_${index}`, value: 'x', expected: ''}));
  assert.throws(() => buildActionArgs({action: 'app.saveChanges', context, data: {changes}}, root), /1–10/);
});

test('社区发布拒绝缺少完整文档的草稿 ID', () => {
  assert.throws(() => buildActionArgs({action: 'community.publishDraft', context, data: {draft_id: ''}}, root), /draft_id/);
  assert.throws(() => buildActionArgs({action: 'community.publishDraft', context, data: {draft_id: '90071992547409931234'}}, root), /文档/);
});

test('玩家评价分页不允许越过官方深分页边界', () => {
  assert.throws(() => buildActionArgs({action: 'feedback.reviews', context, data: {page: 101, page_size: 100}}, root), /10000/);
  assert.throws(() => buildActionArgs({action: 'feedback.reviews', context, data: {page: 1, page_size: 101}}, root), /10000/);
});

test('目录只暴露白名单动作，没有任意 shell 入口', () => {
  const catalog = publicCatalog();
  assert.ok(catalog.length >= 30);
  assert.equal(catalog.find(action => action.id === 'schema').risk, 'read');
  assert.equal(typeof catalog[0].command[0], 'string');
});
