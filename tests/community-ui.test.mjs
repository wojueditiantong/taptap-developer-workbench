import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(path.join(root, 'public', 'index.html'), 'utf8');
const script = await readFile(path.join(root, 'public', 'community-studio.js'), 'utf8');
const app = await readFile(path.join(root, 'public', 'app.js'), 'utf8');

test('社区控制器引用的静态界面都真实存在', () => {
  const ids = new Set([...html.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)].map(match => match[1]));
  for (const match of script.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)) assert.ok(ids.has(match[1]) || match[1] === 'postDraftPreview', `缺少 ${match[1]}`);
  for (const id of ['postGroup', 'postIdentity', 'postMediaFile', 'postAssets', 'postDraftBadge', 'postPublishPanel', 'momentsList', 'momentDialog']) assert.ok(ids.has(id));
});

test('发帖主流程不直接暴露 JSON，提供完整内容工作流', () => {
  assert.match(html, /data-community-view="compose"/);
  assert.match(html, /data-community-view="manage"/);
  assert.match(html, /id="postProgress"|class="post-progress"/);
  assert.match(script, /community\.options/);
  assert.match(script, /community\.uploadVideo/);
  assert.match(script, /community\.updateDraft/);
  assert.match(script, /document\}\}/);
  assert.doesNotMatch(script, /data:\s*\{draft_id:\s*local\.draft\.id\}\}/);
});

test('内容修改与切换游戏都会使旧发布状态失效', () => {
  assert.match(script, /local\.previewOpened = false/);
  assert.match(script, /local\.draft\.signature !== postContentSignature/);
  assert.match(script, /getContext\(\)\.appId/);
  assert.match(app, /releaseStudio\?\.reset\(\); communityStudio\?\.reset\(\)/);
});
