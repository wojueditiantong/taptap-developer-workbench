import test from 'node:test';
import assert from 'node:assert/strict';
import {POST_TEMPLATES, createPostContent} from '../public/post-templates.mjs';

const values = {
  version: {version: '0.5.0', changes: '新增地图筛选\n- 优化加载速度', known: '部分旧设备仍在排查'},
  recruit: {testName: '限量测试', testTime: '11 月 12 日开测', requirements: 'Android 12 及以上\n预留 4 GB 空间', signup: '填写详情页招募问卷', notes: '本次测试删档'},
  launch: {launchTime: '11 月 15 日 10:00', platforms: 'Android、Windows', features: '第一章完整剧情\n手柄操作', download: '前往游戏详情页下载', notes: '请预留存储空间'},
};

test('版本、招募、上线三套模板生成结构化且可编辑的正文', () => {
  assert.deepEqual(POST_TEMPLATES.map(template => template.id), ['version', 'recruit', 'launch']);
  for (const template of POST_TEMPLATES) {
    const content = createPostContent(template.id, '示例游戏', values[template.id]);
    assert.ok(content.title.includes('示例游戏'));
    assert.match(content.body, /### /);
    assert.ok(content.body.length > 100);
  }
  const version = createPostContent('version', '示例游戏', values.version);
  assert.match(version.body, /- 新增地图筛选\n- 优化加载速度/);
  assert.doesNotMatch(version.body, /- - 优化加载速度/);
});

test('模板不虚构事实，缺少真实输入时拒绝生成', () => {
  assert.throws(() => createPostContent('launch', '示例游戏', {launchTime: '明天'}), /请填写开放游玩平台/);
  assert.throws(() => createPostContent('version', '游戏 20001', values.version), /请先选择游戏/);
  assert.throws(() => createPostContent('recruit', '示例游戏', {...values.recruit, signup: '   '}), /请填写报名方式/);
  assert.throws(() => createPostContent('unknown', '示例游戏', {}), /请选择要使用的帖子模板/);
});
