import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {extractGameDetail} from '../public/game-detail.mjs';
import {smokeData} from '../desktop/smoke-data.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const moduleResult = moduleId => smokeData(['app', 'get-app-module', '--data', JSON.stringify({module_id: moduleId})]);
const basic = moduleResult('basic-info');
const assets = moduleResult('assets-upload');
const platform = moduleResult('platform-status');
const versions = smokeData(['app', 'list-app-versions']);
const apps = {ok: true, data: {result: {list: [{app_id: 20001, title: '脱敏示例游戏', page_url: 'https://developer.taptap.cn/v3/10001/app/20001/store/update'}]}}};
const html = await readFile(path.join(root, 'public/index.html'), 'utf8');
const app = await readFile(path.join(root, 'public/app.js'), 'utf8');

test('游戏详情按官方字段展示脱敏资料、素材、平台与版本', () => {
  const result = extractGameDetail({basic, assets, platform, versions, apps, appId: '20001'});
  assert.equal(result.title, '脱敏示例游戏');
  assert.equal(result.category, '角色扮演');
  assert.equal(result.screenshots.length, 2);
  assert.equal(result.banners.length, 1);
  assert.equal(result.platforms.find(item => item.id === 'region_flag_pc').value, '敬请期待');
  assert.equal(result.platforms.find(item => item.id === 'region_flag_android').value, '敬请期待');
  assert.equal(result.versions[0].status, '定时上线');
  assert.equal(result.versionTotal, 2);
  assert.equal(result.developerPageUrl, 'https://developer.taptap.cn/v3/10001/app/20001/store/update');
});

test('缺失字段保持未读取，不用空白或 0 冒充真实数据', () => {
  const result = extractGameDetail({basic: {}, assets: {}, platform: {}, versions: {}, apps: {}, appId: '1'});
  assert.equal(result.title, '');
  assert.equal(result.category, '未填写');
  assert.equal(result.screenshots.length, 0);
  assert.equal(result.platforms.length, 0);
  assert.equal(result.developerPageUrl, '');
});

test('社区发帖与游戏详情是用户可见的独立主入口', () => {
  assert.match(html, /class="nav-item" data-go="community"[^>]*>.*社区发帖/);
  assert.match(html, /class="nav-item" data-go="game-detail"[^>]*>.*游戏详情/);
  assert.match(html, /data-task="community"/);
  assert.match(html, /data-task="game-detail"/);
  assert.match(html, /id="currentGameButton"[^>]*data-go="game-detail"/);
  assert.match(html, /<section id="community" class="view"[\s\S]*id="communityCompose"[\s\S]*id="communityManage"/);
  const operations = html.match(/<section id="operations"[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(operations, /communityCompose|data-ops-tab="content"/);
  assert.match(app, /if \(view === 'community'\) await communityStudio\.activate\(\)/);
  assert.match(app, /if \(view === 'game-detail'\) await gameDetailStudio\.activate\(\)/);
  assert.match(app, /gameDetailStudio\?\.reset\(\)/);
  assert.match(app, /await go\('community'\);\s*await communityStudio\.openTemplates\('version'\)/);
});
