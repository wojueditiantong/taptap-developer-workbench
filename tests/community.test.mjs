import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {communityPublishOptions, textBlocks, imageAsset, videoAsset, buildCommunityDocument} from '../public/community-document.mjs';
import {buildActionArgs} from '../lib/actions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const context = {devId: '123', appId: '20001'};
const document = buildCommunityDocument({title: '版本更新', body: '### 新增内容\n\n- 第一项\n- 第二项\n\n> 已知问题说明', assets: [], forumAppId: '20001', identity: 'official', groupLabelId: '40001'});

test('发帖版块和身份只采用官方真实选项', () => {
  const options = communityPublishOptions({data: {result: {
    group_id: '30001', group_labels: [{name: '综合', params: {group_label_id: '0'}, actions: {create_topic: true}}, {name: '反馈', params: {group_label_id: '40002'}, actions: {create_topic: false}}],
    author_options: [{create_params: {is_official: false}, text: '个人作者'}, {create_params: {is_official: true}, text: '游戏官方'}],
  }}});
  assert.deepEqual(options.groups.map(group => [group.id, group.enabled]), [['0', true], ['40002', false]]);
  assert.deepEqual(options.identities.map(identity => identity.value), ['personal', 'official']);
  assert.throws(() => communityPublishOptions({data: {result: {group_labels: [], author_options: []}}}), /版块/);
});

test('正文支持小标题、要点与引用，序列化为字符串', () => {
  const nodes = textBlocks('### 新内容\n\n- 一\n- 二\n\n> 说明');
  assert.deepEqual(nodes.map(node => node.type), ['heading', 'list', 'paragraph']);
  assert.equal(nodes[0].info.level, 2);
  assert.equal(nodes[2].info.style, 'block-quote');
  const parsed = JSON.parse(document.contents);
  assert.equal(parsed.length, 3);
  assert.equal(document.forum_bindings[0].honor.mode, 'inherit');
  assert.equal(document.forum_bindings[0].group_label_id, '40001');
});

test('社区图片必须保留真实宽高，视频保留字符串句柄', () => {
  const image = imageAsset({data: {url: 'https://img2-tc.tapimg.com/moment/demo.png', width: 1280, height: 720}}, 'demo.png');
  assert.equal(image.width, 1280);
  assert.throws(() => imageAsset({data: {url: 'https://img2-tc.tapimg.com/moment/demo.png', width: 0, height: 720}}), /宽高/);
  const video = videoAsset({data: {videoId: 91001, status: 'transcoding'}}, 'demo.mp4');
  assert.equal(video.videoId, '91001');
  assert.throws(() => videoAsset({data: {videoId: 91001, status: 'transcode_failed'}}), /状态/);
  const rich = buildCommunityDocument({title: '图文视频', body: '', assets: [image, video], forumAppId: '20001', identity: 'personal', groupLabelId: '0'});
  const [imageNode, videoNode] = JSON.parse(rich.contents);
  assert.equal(imageNode.info.img_url, image.url);
  assert.equal(imageNode.info.width, 1280);
  assert.equal(videoNode.info.video_id, 91001);
  assert.equal(typeof videoNode.info.video_id, 'number');
});

test('草稿创建展平，更新和发布携带完整文档及字符串草稿 ID', () => {
  const create = buildActionArgs({action: 'community.createDraft', context, data: document}, root);
  assert.ok(create.args.includes('create-community-topic-draft'));
  assert.deepEqual(JSON.parse(create.args.at(-1)), document);
  const draftId = '90071992547409931234';
  for (const action of ['community.updateDraft', 'community.publishDraft']) {
    const {args} = buildActionArgs({action, context, data: {draft_id: draftId, document}}, root);
    const data = JSON.parse(args.at(-1));
    assert.equal(data.draft_id, draftId);
    assert.deepEqual(data.document, document);
    assert.equal(data.document.draft_id, undefined);
  }
  assert.throws(() => buildActionArgs({action: 'community.publishDraft', context, data: {draft_id: draftId}}, root), /文档|标题|正文/);
  assert.throws(() => buildActionArgs({action: 'community.updateDraft', context, data: {draft_id: draftId, document: {...document, draft_id: draftId}}}, root), /未支持/);
  assert.throws(() => buildActionArgs({action: 'community.publishDraft', context, data: {draft_id: draftId, document: {...document, forum_bindings: []}}}, root), /完整论坛绑定/);
});

test('社区上传使用专用链路，帖子 ID 原样保留', () => {
  const video = buildActionArgs({action: 'community.uploadVideo', context, file: 'demo.mp4', data: {}}, root);
  assert.ok(video.args.includes('+upload-video'));
  assert.ok(!video.args.includes('--data'));
  const momentId = '90071992547409931234';
  const moment = buildActionArgs({action: 'community.moment', context, data: {moment_id: momentId}}, root);
  assert.equal(JSON.parse(moment.args.at(-1)).moment_id, momentId);
  assert.throws(() => buildActionArgs({action: 'community.moments', context, data: {order: 'random'}}, root), /排序/);
  assert.throws(() => buildActionArgs({action: 'community.moments', context, data: {moment_intent: ['3']}}, root), /意图/);
});
