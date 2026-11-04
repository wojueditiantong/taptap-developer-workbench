const NODE_TYPES = new Set(['paragraph', 'heading', 'list', 'list-item', 'image', 'video', 'code-block', 'table', 'table-row', 'table-cell', 'app', 'linkcard']);
const DOCUMENT_FIELDS = new Set(['title', 'contents', 'pin_video_id', 'cover_video_id', 'cover_image_url', 'footer_image_urls', 'images_text', 'forum_bindings']);
const id = value => /^[1-9][0-9]*$/.test(String(value ?? ''));

export function payload(result) {
  return result?.data?.result ?? result?.data ?? result?.result ?? result ?? {};
}

export function communityPublishOptions(result) {
  const data = payload(result);
  const groups = (Array.isArray(data.group_labels) ? data.group_labels : []).flatMap(label => {
    const value = label?.params?.group_label_id;
    if (!label?.name || !/^(0|[1-9][0-9]*)$/.test(String(value ?? ''))) return [];
    return [{id: String(value), name: label.name, enabled: label.actions?.create_topic !== false}];
  });
  const identities = (Array.isArray(data.author_options) ? data.author_options : []).flatMap(option => {
    const official = option?.create_params?.is_official;
    if (typeof official !== 'boolean') return [];
    return [{value: official ? 'official' : 'personal', label: option.text || (official ? '游戏官方' : '个人作者')}];
  });
  if (!groups.length) throw new Error('官方没有返回可发帖的版块，暂时不能创建草稿');
  if (!identities.length) throw new Error('官方没有返回可用的发布身份，暂时不能创建草稿');
  return {groups, identities, groupId: String(data.group_id || '')};
}

export function textBlocks(text) {
  const nodes = [];
  for (const block of String(text || '').trim().split(/\n{2,}/).map(item => item.trim()).filter(Boolean)) {
    if (block.startsWith('### ')) {
      nodes.push({type: 'heading', info: {level: 2}, children: [{text: block.slice(4).trim()}]});
      continue;
    }
    if (block.split('\n').every(line => /^- /.test(line))) {
      nodes.push({type: 'list', children: block.split('\n').map(line => ({type: 'list-item', children: [{text: line.slice(2).trim()}]}))});
      continue;
    }
    if (block.startsWith('> ')) nodes.push({type: 'paragraph', info: {style: 'block-quote'}, children: [{text: block.slice(2).trim()}]});
    else nodes.push({type: 'paragraph', children: [{text: block}]});
  }
  return nodes;
}

export function imageAsset(upload, file = '') {
  const data = payload(upload);
  const width = Number(data.width ?? data.info?.width);
  const height = Number(data.height ?? data.info?.height);
  if (!/^https:\/\//.test(data.url || '') || !Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error('上传返回缺少有效的图片地址或宽高，不能插入帖子');
  }
  return {kind: 'image', url: data.url, width, height, name: file.split(/[\\/]/).pop() || '帖子图片', description: ''};
}

export function videoAsset(upload, file = '') {
  const data = payload(upload);
  const value = String(data.videoId ?? '');
  if (!id(value) || !Number.isSafeInteger(Number(value))) throw new Error('上传返回缺少可安全引用的 videoId，不能插入帖子');
  if (!['normal', 'transcoding', 'regulating'].includes(data.status)) throw new Error(`视频当前状态为 ${data.status || '未知'}，请先处理上传返回的问题`);
  return {kind: 'video', videoId: value, status: data.status, name: data.fileName || file.split(/[\\/]/).pop() || '帖子视频'};
}

export function buildCommunityDocument({title, body, assets = [], forumAppId, identity, groupLabelId}) {
  const document = {
    title: String(title || '').trim(),
    contents: JSON.stringify([...textBlocks(body), ...assets.map(asset => asset.kind === 'image'
      ? {type: 'image', info: {img_url: asset.url, width: asset.width, height: asset.height, description: asset.description || asset.name}}
      : {type: 'video', info: {video_id: Number(asset.videoId)}})]),
    forum_bindings: [{app_id: String(forumAppId || ''), identity, group_label_id: String(groupLabelId ?? '0'), honor: {mode: 'inherit'}}],
  };
  return validateCommunityDocument(document);
}

export function validateCommunityDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('帖子文档必须是对象');
  const unknown = Object.keys(document).filter(key => !DOCUMENT_FIELDS.has(key));
  if (unknown.length) throw new Error(`帖子文档包含未支持的字段：${unknown.join('、')}`);
  if (!document.title?.trim() || document.title.length > 100) throw new Error('帖子标题须为 1–100 字');
  if (typeof document.contents !== 'string' || document.contents.length > 50000) throw new Error('帖子正文须为不超过 50000 字符的 JSON 字符串');
  let nodes;
  try { nodes = JSON.parse(document.contents); } catch { throw new Error('帖子正文不是有效的 JSON'); }
  if (!Array.isArray(nodes) || !nodes.length) throw new Error('请先填写正文或添加图片、视频');
  let visited = 0;
  const visit = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 12 || ++visited > 1000) throw new Error('帖子正文节点结构不受支持');
    if (node.type === undefined && typeof node.text === 'string') return;
    if (!NODE_TYPES.has(node.type)) throw new Error(`帖子正文包含不支持的 ${node.type || '空'} 节点`);
    if (node.children !== undefined && !Array.isArray(node.children)) throw new Error('正文 children 必须是数组');
    if (node.type === 'image') {
      if (!/^https:\/\//.test(node.info?.img_url || '') || !Number.isInteger(node.info?.width) || node.info.width <= 0 || !Number.isInteger(node.info?.height) || node.info.height <= 0) throw new Error('正文图片必须带有效 https 地址和真实宽高');
    }
    if (node.type === 'video' && (!Number.isSafeInteger(node.info?.video_id) || node.info.video_id <= 0)) throw new Error('正文视频必须使用有效的整数 video_id');
    node.children?.forEach(child => visit(child, depth + 1));
  };
  nodes.forEach(node => visit(node));
  if (!Array.isArray(document.forum_bindings) || document.forum_bindings.length < 1 || document.forum_bindings.length > 2) throw new Error('帖子必须保留 1–2 个完整论坛绑定');
  for (const binding of document.forum_bindings) {
    if (!binding || !id(binding.app_id) || !['personal', 'official'].includes(binding.identity)) throw new Error('论坛绑定缺少有效的游戏 ID 或发布身份');
    if (binding.group_label_id != null && !/^(0|[1-9][0-9]*)$/.test(String(binding.group_label_id))) throw new Error('子版块 ID 不是官方返回的有效值');
    if (binding.honor && (binding.honor.mode !== 'inherit' || Object.keys(binding.honor).some(key => key !== 'mode'))) throw new Error('本工作流只支持沿用当前称号');
  }
  return document;
}

export function postContentSignature(document) {
  return JSON.stringify(document);
}
