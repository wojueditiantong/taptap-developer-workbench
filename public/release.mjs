export const RELEASE_MODULES = [
  ['basic-info', '基础资料'], ['assets-upload', '图片与视频'], ['profile-promotion', '首页推荐'],
  ['windows-exclusive', 'Windows 素材与配置'], ['platform-status', '平台与分发'],
  ['release-settings', '发布设置'], ['package', '包体配置'], ['developer-info', '开发者信息'], ['other-settings', '其他设置'],
];
export const payload = result => result?.data?.result ?? result?.result ?? result?.data ?? {};
const text = value => typeof value === 'string' ? value : value?.message || value?.hint || value?.reason || value?.label || JSON.stringify(value);
const find = (entries, action) => entries.find(entry => entry.action === action);
const fieldEntries = entry => Object.values(payload(entry?.result).fields ?? {});
const empty = value => value == null || value === '' || (Array.isArray(value) && value.length === 0);
export function fieldLabel(field) {
  return field.value_labels?.[String(field.current_value)] ?? (empty(field.current_value) ? '未填写' : String(field.current_value));
}
export function mediaSpec(field) {
  const spec = field.image_spec || field.video_spec;
  if (!spec) return '';
  return [spec.aspect_ratio && `比例 ${spec.aspect_ratio}`, spec.min_width && `至少 ${spec.min_width}×${spec.min_height}`, spec.formats?.join('／'), spec.max_file_size_mb && `不超过 ${spec.max_file_size_mb} MB`, spec.min_seconds && `${spec.min_seconds}–${spec.max_seconds || '不限'} 秒`, spec.content_note, ...(spec.requirements ?? [])].filter(Boolean).join(' · ');
}

export function summarizeRelease(entries) {
  const tasks = [], passed = [], unknown = [];
  const add = (kind, title, detail, tab = 'overview') => (kind === 'unknown' ? unknown : tasks).push({title, detail, tab, kind});
  for (const entry of entries) {
    if (!entry.result?.ok) add('unknown', `${entry.label}无法确认`, entry.result?.error?.hint || entry.result?.error?.message || '本次读取失败', entry.action.startsWith('app.module') ? 'profile' : 'overview');
  }
  const status = find(entries, 'app.status');
  for (const item of payload(status?.result).blockers ?? []) add('blocker', '发布前需要处理', text(item));
  for (const item of payload(status?.result).warnings ?? []) add('warning', '发布风险提示', text(item));
  const moduleLabels = {'app.module.basic': '基础资料', 'app.module.assets': '图片与视频', 'app.module.platform': '平台与分发', 'app.module.release': '发布设置'};
  const moduleTabs = {'app.module.basic': 'profile', 'app.module.assets': 'profile', 'app.module.platform': 'distribution', 'app.module.release': 'review'};
  for (const [action, label] of Object.entries(moduleLabels)) {
    const entry = find(entries, action);
    if (!entry?.result?.ok) continue;
    const missing = fieldEntries(entry).filter(field => field.state === 'required' && (field.filled === false || empty(field.current_value)));
    for (const field of missing) add('missing', `${label}：${field.label || field.field_id}`, mediaSpec(field) || '官方当前返回为必填，但还没有填写。', moduleTabs[action]);
    if (!missing.length) passed.push(`${label}的当前必填项已填写`);
  }
  const packageEntry = find(entries, 'app.packages');
  const packageData = payload(packageEntry?.result);
  const candidates = (packageData.list ?? []).filter(item => item.status === 'ready');
  const bindings = packageData.current_bindings ?? [];
  if (packageEntry?.result?.ok) {
    if (!candidates.length) add('missing', '还没有可用的包体', '先上传包体，待状态变为可用后再绑定。', 'package');
    else if (!bindings.length) add('missing', '包体还没有绑定到商店资料', `读取到 ${candidates.length} 个可用包体，请选择目标槽位。`, 'package');
    else passed.push(`已绑定 ${bindings.length} 个包体槽位，读取到 ${candidates.length} 个可用候选`);
  }
  const platform = find(entries, 'app.module.platform');
  const distribution = fieldEntries(platform).filter(field => /^region_flag_/.test(field.field_id)).map(field => ({label: field.label, value: fieldLabel(field), fieldId: field.field_id}));
  for (const item of distribution) if (item.value === '敬请期待') add('warning', `${item.label}仍为「敬请期待」`, '发布版本不会自动改变这个入口；如需开放下载或游玩，请在提审前调整。', 'distribution');
  const versionList = payload(find(entries, 'app.versions')?.result).list ?? [];
  const current = versionList.find(item => ['draft', 'reviewing', 'scheduled', 'rejected'].includes(item.status)) ?? versionList[0];
  const qualificationData = payload(find(entries, 'qualification.status')?.result);
  const statusNames = {pending_upload: '尚未提供材料', uploaded: '草稿已保存', reviewing: '审核中', approved: '已通过', rejected: '已驳回'};
  const qualificationNames = {'game-license': '版号', 'icp-filing': 'ICP 备案', 'privacy-compliance': '隐私合规', 'anti-addiction': '防沉迷', 'ai-declaration': 'AI 内容声明', 'software-copyright': '软件著作权', 'authorization-letters': '授权材料', 'security-assessment': '安全评估'};
  const qualifications = (qualificationData.qualifications ?? []).map(item => ({label: qualificationNames[item.qualification_type] || item.qualification_type, status: statusNames[item.status] || item.status, reason: item.reason || ''}));
  const conclusion = tasks.some(task => task.kind === 'blocker') ? '存在明确阻断项' : tasks.length || unknown.length ? '还有事项需要处理或确认' : '当前已读取项目未发现明确缺口';
  return {conclusion, tasks, unknown, passed, candidates, bindings, slots: packageData.package_slots ?? {}, distribution, qualifications, current, versions: versionList, canPrecheck: !unknown.length && !tasks.some(task => task.kind === 'blocker' || task.kind === 'missing')};
}

export function releaseMarkdown({context, entries, createdAt}) {
  const summary = summarizeRelease(entries);
  const lines = ['# TapTap 上架体检', '', `- 生成时间：${createdAt}`, `- 开发者 ID：${context.devId}`, `- 游戏 ID：${context.appId}`, '', `## ${summary.conclusion}`, '',
    '> 本报告是资料准备检查，不是正式提审预检。成功读取不代表审核通过；未知项不会按通过计算。', '', '## 待处理', '',
    ...(summary.tasks.length ? summary.tasks.map(item => `- **${item.title}**：${item.detail}`) : ['- 当前读取结果中没有明确的待补项。']), '',
    '## 无法确认', '', ...(summary.unknown.length ? summary.unknown.map(item => `- ${item.title}：${item.detail}`) : ['- 无']), '',
    '## 已确认的事实', '', ...summary.passed.map(item => `- ${item}`),
    ...summary.distribution.map(item => `- ${item.label}：${item.value}`), '',
    '## 资质登记', '', '> 下列是客观登记状态，不表示所有资质都必须提交；必须资质以当前游戏事实和上架分析为准。', '',
    ...summary.qualifications.map(item => `- ${item.label}：${item.status}${item.reason ? `（${item.reason}）` : ''}`), '',
    '<details><summary>官方原始返回（附录）</summary>', ''];
  for (const entry of entries) lines.push(`### ${entry.label}`, '', '```json', JSON.stringify(entry.result ?? {error: '未执行'}, null, 2), '```', '');
  lines.push('</details>', '');
  return lines.join('\n');
}
