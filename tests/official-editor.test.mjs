import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isOfficialEditorDocument, officialEditorNeedsLoad, officialEditorUrl, OFFICIAL_EDITOR_URL} from '../lib/official-editor-url.mjs';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const studio = await readFile(new URL('../public/community-studio.js', import.meta.url), 'utf8');
const desktop = await readFile(new URL('../desktop/official-editor.mjs', import.meta.url), 'utf8');
const main = await readFile(new URL('../desktop/main.mjs', import.meta.url), 'utf8');

test('官方编辑器只接受指定 HTTPS 页面和数字草稿 ID', () => {
  assert.equal(officialEditorUrl(), OFFICIAL_EDITOR_URL);
  assert.equal(officialEditorUrl(`${OFFICIAL_EDITOR_URL}?draft_id=60001`), `${OFFICIAL_EDITOR_URL}?draft_id=60001`);
  for (const value of ['https://example.com/moment-editor', 'http://www.taptap.cn/moment-editor', 'https://www.taptap.cn/moment/1', `${OFFICIAL_EDITOR_URL}?draft_id=abc`, `${OFFICIAL_EDITOR_URL}?url=https://example.com`, `${OFFICIAL_EDITOR_URL}#javascript:alert(1)`, 'not-a-url']) {
    assert.throws(() => officialEditorUrl(value), value);
  }
});

test('实际跳到账号页时必须返回编辑器，而不是误用旧目标地址', () => {
  const target = OFFICIAL_EDITOR_URL;
  assert.equal(isOfficialEditorDocument(target), true);
  assert.equal(isOfficialEditorDocument(`${target}?draft_id=60001`), true);
  assert.equal(isOfficialEditorDocument('https://accounts.taptap.cn/account/authorization'), false);
  assert.equal(officialEditorNeedsLoad({target, loadedUrl: target, actualUrl: target}), false);
  assert.equal(officialEditorNeedsLoad({target, loadedUrl: target, actualUrl: 'https://accounts.taptap.cn/account/authorization'}), true);
  assert.equal(officialEditorNeedsLoad({target: `${target}?draft_id=60001`, loadedUrl: target, actualUrl: target}), true);
  assert.equal(officialEditorNeedsLoad({target, loadedUrl: target, actualUrl: 'file:///validation/official-editor-smoke.html', smokeTest: true}), false);
});

test('官方编辑器在应用原生视图中承载，不使用 iframe 或任意脚本接口', () => {
  assert.match(html, /id="officialEditorHost"/);
  assert.match(html, /data-community-view="drafts"/);
  assert.doesNotMatch(html, /<iframe/i);
  assert.match(main, /officialEditor\.attach\(mainWindow\)/);
  assert.match(main, /officialEditor\.destroy\(\)/);
  assert.match(desktop, /new WebContentsView/);
  assert.match(main, /event\.sender !== mainWindow\.webContents/);
  assert.doesNotMatch(desktop, /executeJavaScript\(input/);
  assert.match(studio, /action: 'list-drafts'/);
  assert.match(studio, /action: 'edit-draft'/);
  assert.match(html, /id="communityDrafts" class="hidden"/);
  assert.doesNotMatch(studio, /action: 'drafts'/);
  assert.match(studio, /deactivate/);
  assert.match(studio, /new ResizeObserver/);
  assert.match(studio, /ensureOptions/);
});

test('官方编辑器与辅助编辑器按需协作，保留实时预览与发布门禁', () => {
  assert.match(html, /<details id="communityAssistant"[^>]*>/);
  assert.doesNotMatch(studio, /if \(view === 'compose' && local\.optionsKey !== contextKey\(\)\) return loadOptions\(\)/);
  assert.match(studio, /showOfficialEditor\(url\)/);
  assert.match(studio, /local\.previewOpened = true/);
  assert.match(studio, /!local\.previewOpened/);
  assert.match(studio, /addEventListener\('input', markDirty\)/);
});
