const lines = value => String(value || '').split('\n').map(item => item.trim()).filter(Boolean);
const bullets = value => lines(value).map(item => `- ${item.replace(/^[-•]\s*/, '')}`).join('\n');

export const POST_TEMPLATES = [
  {
    id: 'version', icon: '↑', name: '版本更新', short: '更新公告', description: '说明版本变化、修复内容与已知问题',
    fields: [
      {key: 'version', label: '版本号', placeholder: '例如：0.4.0', required: true},
      {key: 'changes', label: '本次主要更新', type: 'textarea', placeholder: '每行一项，例如：\n新增地图筛选功能\n优化低端设备加载速度', required: true},
      {key: 'known', label: '已知问题（可选）', type: 'textarea', placeholder: '如实填写尚未解决的问题；没有要说明的可留空'},
    ],
    build(game, values) {
      return {
        title: `《${game}》${values.version} 版本更新公告`,
        body: `感谢大家对《${game}》的关注。本次 ${values.version} 版本更新内容如下。\n\n### 本次更新\n\n${bullets(values.changes)}${values.known.trim() ? `\n\n### 已知问题\n\n${values.known.trim()}` : ''}\n\n### 遇到问题怎么办\n\n欢迎在评论区留下问题发生的设备、版本和复现步骤。我们会根据实际反馈继续排查，处理进展以后续公告为准。`,
      };
    },
  },
  {
    id: 'recruit', icon: '✦', name: '测试招募', short: '招募帖', description: '讲清测试时间、参与条件和报名方式',
    fields: [
      {key: 'testName', label: '测试名称', placeholder: '例如：首次限量删档测试', required: true},
      {key: 'testTime', label: '招募与测试时间', placeholder: '例如：招募截至 11 月 8 日，11 月 12 日开测', required: true},
      {key: 'requirements', label: '参与条件', type: 'textarea', placeholder: '每行一项，例如：\nAndroid 12 及以上\n预留 4 GB 可用存储空间', required: true},
      {key: 'signup', label: '报名方式', placeholder: '例如：填写游戏详情页的招募问卷', required: true},
      {key: 'notes', label: '测试说明（可选）', type: 'textarea', placeholder: '资格发放、数据删档、保密要求等；请勿承诺未确定的奖励'},
    ],
    build(game, values) {
      return {
        title: `《${game}》${values.testName}招募开启`,
        body: `《${game}》${values.testName}招募现已开启，期待听到你的真实体验与建议。\n\n### 时间安排\n\n${values.testTime}\n\n### 参与条件\n\n${bullets(values.requirements)}\n\n### 如何报名\n\n${values.signup}${values.notes.trim() ? `\n\n### 测试说明\n\n${values.notes.trim()}` : ''}\n\n> 请通过本帖说明的官方方式报名，不要向他人提供账号密码或验证码。`,
      };
    },
  },
  {
    id: 'launch', icon: '●', name: '上线公告', short: '上线帖', description: '公布开放时间、可玩平台与游戏亮点',
    fields: [
      {key: 'launchTime', label: '正式开放时间', placeholder: '例如：2026 年 11 月 15 日 10:00', required: true},
      {key: 'platforms', label: '开放游玩平台', placeholder: '例如：Android、Windows', required: true},
      {key: 'features', label: '玩家可以体验的内容', type: 'textarea', placeholder: '每行一项，只填写已经实现并验证的内容', required: true},
      {key: 'download', label: '下载或游玩方式', placeholder: '例如：前往本游戏 TapTap 详情页下载', required: true},
      {key: 'notes', label: '补充说明（可选）', type: 'textarea', placeholder: '配置要求、存档兼容、开服注意事项等'},
    ],
    build(game, values) {
      return {
        title: `《${game}》正式上线公告｜${values.launchTime}`,
        body: `《${game}》将于 ${values.launchTime} 正式开放游玩，感谢每一位关注、预约和参与测试的玩家。\n\n### 开放信息\n\n- 开放时间：${values.launchTime}\n- 游玩平台：${values.platforms}\n- 下载方式：${values.download}\n\n### 本次可体验内容\n\n${bullets(values.features)}${values.notes.trim() ? `\n\n### 游玩前请留意\n\n${values.notes.trim()}` : ''}\n\n如果你在游玩中遇到问题，欢迎在评论区提供设备、版本和问题描述，我们会认真阅读并跟进。`,
      };
    },
  },
];

export function createPostContent(templateId, gameName, values = {}) {
  const template = POST_TEMPLATES.find(item => item.id === templateId);
  if (!template) throw new Error('请选择要使用的帖子模板');
  const game = String(gameName || '').trim();
  if (!game || /^游戏\s+\d+$/.test(game) || game === '尚未选择游戏') throw new Error('请先选择游戏，再使用帖子模板');
  const normalized = {};
  for (const field of template.fields) {
    normalized[field.key] = String(values[field.key] || '').trim();
    if (field.required && !normalized[field.key]) throw new Error(`请填写${field.label}`);
    if (normalized[field.key].length > 2000) throw new Error(`${field.label}内容过长，请精简后再试`);
  }
  const content = template.build(game, normalized);
  if (content.title.length > 100) throw new Error('生成的标题超过 100 字，请缩短版本、测试或时间描述');
  return content;
}
