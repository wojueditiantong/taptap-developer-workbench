import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(path.join(toolRoot, 'public', 'index.html'), 'utf8');
const js = await readFile(path.join(toolRoot, 'public', 'app.js'), 'utf8');

test('页面 ID 唯一，导航目标都存在', () => {
  const ids = [...html.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, '存在重复 ID');
  for (const match of html.matchAll(/data-go="([A-Za-z0-9_-]+)"/g)) {
    assert.ok(ids.includes(match[1]), `缺少导航目标 ${match[1]}`);
  }
});

test('脚本使用的静态元素均有对应节点', () => {
  const ids = new Set([...html.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)].map(match => match[1]));
  for (const match of js.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)) {
    const dynamic = new Set(['copyLogin', 'recheckLogin']);
    assert.ok(ids.has(match[1]) || dynamic.has(match[1]), `缺少元素 #${match[1]}`);
  }
});

test('主流程隐藏技术参数，保留独立高级模式', () => {
  assert.match(html, /高级模式：官方动作与原始返回/);
  assert.match(html, /id="profileWorkspace"/);
  assert.match(html, /id="packageBindings"/);
  assert.match(html, /id="releaseMode"/);
  assert.doesNotMatch(js, /reviewFingerprint|readAppModule|profileChanges/);
  assert.match(html, /data-release-step="overview"/);
  assert.match(html, /data-ops-tab="reviews"/);
  assert.match(html, /id="previewTitle"/);
  assert.doesNotMatch(html.split('<details class="expert-block global-expert">')[0], /id="actionData"/);
});

test('账号连接在应用内完成，不再要求用户复制终端命令', () => {
  assert.match(js, /primary: '连接 TapTap'/);
  assert.match(js, /api\('\/api\/auth', \{method: 'POST'\}\)/);
  assert.match(js, /pollAuthorization/);
  assert.doesNotMatch(js, /复制授权命令|在终端运行授权命令|taptap-cli\.cmd auth login/);
});

test('使用 TapTap 品牌并提供账号退出入口', () => {
  assert.match(html, /TapTap 工作台/);
  assert.match(html, /id="accountDialog"/);
  assert.match(html, /id="logoutButton"/);
  assert.match(js, /api\('\/api\/auth\/logout', \{method: 'POST'\}\)/);
  assert.match(js, /saveContext\(\{devId: '', appId: ''\}/);
});
