import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {officialDraftDrawerVisible, officialDraftItems, officialDraftsProbeSource, officialDraftsSnapshotSource, officialEditDraftSource} from '../lib/official-drafts.mjs';

function drawer({visible = true} = {}) {
  return {
    textContent: '草稿箱',
    getBoundingClientRect: () => ({width: visible ? 420 : 0, height: visible ? 760 : 0}),
  };
}

function documentWith({button = null, layers = []} = {}) {
  return {
    querySelector: selector => selector === '.moment-editor-header-actions__draft-entry' ? button : null,
    querySelectorAll: selector => selector === 'button' ? (button ? [button] : []) : layers,
  };
}

function draftItem({title = '草稿标题', summary = '正文摘要', placeholder = false, forum = '示例游戏 · 开发日志', modified = '2026-11-01 08:00', cover = ''} = {}) {
  const summaryElement = {textContent: summary, classList: {contains: name => name === 'draft-item__summary--placeholder' && placeholder}};
  const image = cover ? {getAttribute: name => name === 'src' ? cover : null} : null;
  const fields = {
    '.draft-item__title-content': {textContent: title},
    '.draft-item__summary': summaryElement,
    '.draft-item__meta': {textContent: forum},
    '.draft-item__time .tap-time': {textContent: modified},
    '.draft-item__time': {textContent: modified},
    '.draft-item__compact-media img': image,
  };
  return {
    clicks: 0,
    querySelector: selector => fields[selector] || null,
    click() { this.clicks += 1; },
  };
}

function draftDocument({items = [draftItem()], declared = items.length, visible = true} = {}) {
  const state = {closeClicks: 0};
  const close = {click: () => { state.closeClicks += 1; state.visible = false; }};
  state.visible = visible;
  const layer = {
    textContent: `草稿箱（${declared}）${items.map(item => item.querySelector('.draft-item__title-content').textContent).join('')}`,
    getBoundingClientRect: () => ({width: state.visible ? 420 : 0, height: state.visible ? 760 : 0}),
    querySelectorAll: selector => selector === 'div.draft-item[role="button"]' ? items : [],
    querySelector: selector => selector === '.right-drawer-scaffold__close' ? close : null,
  };
  const document = {
    querySelector: selector => selector === '.right-drawer-scaffold__close' ? close : null,
    querySelectorAll: selector => selector === 'button' ? [] : [layer],
  };
  return {document, state, items};
}

test('真实 right-drawer 没有 role=dialog 也能识别草稿箱', () => {
  assert.equal(officialDraftDrawerVisible(documentWith({layers: [drawer()]})), true);
  assert.equal(officialDraftDrawerVisible(documentWith({layers: [drawer({visible: false})]})), false);
  assert.equal(officialDraftDrawerVisible(documentWith({layers: [{...drawer(), textContent: '其他弹窗'}]})), false);
});

test('等待官方按钮出现后点击，并等待真实抽屉显示', async () => {
  let button = null;
  let opened = false;
  let clicks = 0;
  const layer = drawer();
  const document = {
    querySelector: selector => selector === '.moment-editor-header-actions__draft-entry' ? button : null,
    querySelectorAll: selector => selector === 'button' ? (button ? [button] : []) : (opened ? [layer] : []),
  };
  const timer = setTimeout(() => {
    button = {textContent: '草稿箱', click: () => {clicks += 1; opened = true;}};
  }, 120);
  try {
    const result = await vm.runInNewContext(officialDraftsProbeSource({buttonTimeout: 2000, drawerTimeout: 1000}), {document, setTimeout, Date});
    assert.equal(result, 'opened');
    assert.equal(clicks, 1);
  } finally { clearTimeout(timer); }
});

test('按钮未出现或抽屉未显示时返回可区分的失败状态', async () => {
  const missing = await vm.runInNewContext(officialDraftsProbeSource({buttonTimeout: 30}), {document: documentWith(), setTimeout, Date});
  assert.equal(missing, 'missing-button');
  const button = {textContent: '草稿箱', click: () => {}};
  const notVisible = await vm.runInNewContext(officialDraftsProbeSource({drawerTimeout: 30}), {document: documentWith({button}), setTimeout, Date});
  assert.equal(notVisible, 'not-visible');
});

test('按官网真实卡片结构读取标题、摘要、论坛、时间和封面', () => {
  const first = draftItem({title: '  版本更新\n  说明  ', summary: '新增  两项内容', cover: 'https://img.taptap.cn/cover.png'});
  const second = draftItem({title: '空摘要', summary: '暂无正文', placeholder: true, cover: 'javascript:alert(1)'});
  const {document} = draftDocument({items: [first, second], declared: 2});
  const items = officialDraftItems(document);
  assert.equal(items.length, 2);
  assert.deepEqual({...items[0]}, {
    index: 0, title: '版本更新 说明', summary: '新增 两项内容', forum: '示例游戏 · 开发日志', modified: '2026-11-01 08:00',
    cover: 'https://img.taptap.cn/cover.png', fingerprint: JSON.stringify(['版本更新 说明', '新增 两项内容', '示例游戏 · 开发日志', '2026-11-01 08:00']),
  });
  assert.equal(items[1].summary, '');
  assert.equal(items[1].cover, '');
  assert.equal(items[1].index, 1);
});

test('读取快照后只关闭抽屉，不点击删除，并标记未加载完整', async () => {
  const fixture = draftDocument({items: [draftItem(), draftItem({title: '第二份'})], declared: 5});
  const result = await vm.runInNewContext(officialDraftsSnapshotSource({buttonTimeout: 20, drawerTimeout: 20}), {document: fixture.document, setTimeout, Date});
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 2);
  assert.equal(result.total, 5);
  assert.equal(result.partial, true);
  assert.ok(result.readAt);
  assert.equal(fixture.state.closeClicks, 1);
  assert.equal(fixture.state.visible, false);
  assert.ok(fixture.items.every(item => item.clicks === 0));
});

test('空列表与声明有草稿但卡片结构异常分开返回', async () => {
  const empty = draftDocument({items: [], declared: 0});
  const emptyResult = await vm.runInNewContext(officialDraftsSnapshotSource(), {document: empty.document, setTimeout, Date});
  assert.equal(emptyResult.ok, true);
  assert.deepEqual(Array.from(emptyResult.items), []);
  assert.equal(emptyResult.partial, false);
  const broken = draftDocument({items: [], declared: 2});
  const brokenResult = await vm.runInNewContext(officialDraftsSnapshotSource(), {document: broken.document, setTimeout, Date});
  assert.deepEqual({...brokenResult}, {ok: false, error: 'structure'});
  assert.equal(broken.state.closeClicks, 1);
});

test('继续编辑同时核对索引和指纹，并点击实际卡片', async () => {
  const fixture = draftDocument({items: [draftItem({title: '第一份'}), draftItem({title: '第二份'})], declared: 2});
  const expected = officialDraftItems(fixture.document)[1];
  fixture.items[1].click = () => { fixture.items[1].clicks += 1; fixture.state.visible = false; };
  const result = await vm.runInNewContext(officialEditDraftSource({index: 1, fingerprint: expected.fingerprint}, {editorTimeout: 50}), {document: fixture.document, location: {href: 'https://www.taptap.cn/moment-editor'}, setTimeout, Date});
  assert.deepEqual({...result}, {ok: true, title: '第二份'});
  assert.equal(fixture.items[0].clicks, 0);
  assert.equal(fixture.items[1].clicks, 1);
});

test('草稿指纹变化时拒绝打开另一份内容', async () => {
  const fixture = draftDocument({items: [draftItem({title: '已经改变'})], declared: 1});
  const result = await vm.runInNewContext(officialEditDraftSource({index: 0, fingerprint: JSON.stringify(['旧标题', '正文摘要', '示例游戏 · 开发日志', '2026-11-01 08:00'])}, {editorTimeout: 20}), {document: fixture.document, location: {href: 'https://www.taptap.cn/moment-editor'}, setTimeout, Date});
  assert.deepEqual({...result}, {ok: false, error: 'changed'});
  assert.equal(fixture.items[0].clicks, 0);
  assert.equal(fixture.state.closeClicks, 0);
});
