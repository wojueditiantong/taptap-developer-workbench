import path from 'node:path';
import {validateCommunityDocument} from '../public/community-document.mjs';

const read = (id, label, group, command, options = {}) => ({
  id, label, group, risk: 'read', command, ...options,
});
const write = (id, label, group, command, options = {}) => ({
  id, label, group, risk: 'write', command, ...options,
});

export const ACTIONS = [
  read('cli.version', '检查 CLI 版本', '环境', ['version', '--format', 'json']),
  read('auth.status', '检查登录状态', '环境', ['auth', 'status']),
  read('cli.doctor', '离线环境诊断', '环境', ['doctor', '--offline', '--json']),
  read('cli.skills', '读取官方能力清单', '环境', ['skills', 'list']),
  read('developer.list', '列出开发者主体', '定位', ['developer', '+list']),
  read('app.list', '查找游戏', '定位', ['app', '+list'], {scope: 'dev'}),
  read('app.status', '上架完整度体检', '上架', ['app', 'analyze-app-status'], {scope: 'app'}),
  read('app.module', '读取资料模块', '上架', ['app', 'get-app-module'], {scope: 'app', data: true, defaultData: {module_id: 'basic-info'}}),
  read('app.module.basic', '读取基础资料', '上架', ['app', 'get-app-module'], {scope: 'app', data: true, defaultData: {module_id: 'basic-info'}}),
  read('app.module.assets', '读取图片与视频', '上架', ['app', 'get-app-module'], {scope: 'app', data: true, defaultData: {module_id: 'assets-upload'}}),
  read('app.module.platform', '读取平台与分发', '上架', ['app', 'get-app-module'], {scope: 'app', data: true, defaultData: {module_id: 'platform-status'}}),
  read('app.module.release', '读取发布设置', '上架', ['app', 'get-app-module'], {scope: 'app', data: true, defaultData: {module_id: 'release-settings'}}),
  read('app.versions', '读取版本历史', '上架', ['app', 'list-app-versions'], {scope: 'app'}),
  read('app.currentVersion', '读取版本详情', '上架', ['app', 'get-app-version'], {scope: 'app', data: true}),
  read('app.packages', '读取草稿可选包体', '上架', ['app', 'list-packages'], {scope: 'app'}),
  read('package.overview', '包体与自测状态', '上架', ['package-management', 'get-package-overview'], {scope: 'app'}),
  read('qualification.status', '上架资质检查', '上架', ['qualification', 'get-qualification-status'], {scope: 'app'}),
  read('test.overview', '测试计划状态', '上架', ['test-plan', 'get-test-plan-overview'], {scope: 'app'}),
  read('review.snapshot', '生成提审复核快照', '上架', ['app', 'prepare-review-snapshot'], {scope: 'app', data: true, optionalData: true}),
  read('review.precheck', '提审预检（不提交）', '上架', ['app', 'precheck-app-review'], {scope: 'app', data: true}),
  read('materials.inspect', '盘点本地物料', '上架', ['materials', '+inspect'], {file: true}),
  read('stats.metric', '查询经营指标', '运营', ['dashboard-stats', 'get-dashboard-stats'], {scope: 'app', data: true, defaultData: {metric: 'download'}}),
  read('stats.forum', '查询论坛趋势', '运营', ['dashboard-stats', 'get-forum-stats'], {scope: 'app', data: true, defaultData: {type: ['forum_pv', 'forum_uv']}}),
  read('feedback.reviews', '读取玩家评价', '运营', ['player-feedback', 'list-player-reviews'], {scope: 'app', data: true, defaultData: {page: 1, page_size: 20, order: 'update'}}),
  read('community.moments', '读取社区帖子', '运营', ['community-management', 'list-community-moments'], {scope: 'app', data: true, optionalData: true}),
  read('community.moment', '读取帖子正文与素材', '运营', ['community-management', 'get-community-moment'], {scope: 'app', data: true}),
  read('community.labels', '读取社区子版块', '运营', ['community-management', 'list-community-group-labels'], {scope: 'app', data: true, optionalData: true}),
  read('community.options', '读取当前论坛发帖选项', '运营', ['community-management', 'get-community-forum-publish-options'], {scope: 'app-only'}),
  read('community.getDraft', '读取社区草稿', '运营', ['community-management', 'get-community-topic-draft'], {scope: 'app', data: true}),
  read('schema', '读取动作参数 Schema', '高级', ['schema'], {schema: true}),
  write('app.create', '创建游戏草稿', '上架写入', ['app', 'create-app'], {scope: 'dev', data: true}),
  write('app.saveChanges', '保存资料草稿', '上架写入', ['app', 'save-changes'], {scope: 'app', data: true}),
  write('app.selectPackage', '绑定草稿包体', '上架写入', ['app', 'select-package'], {scope: 'app', data: true}),
  write('app.clearPackage', '清空草稿包体', '上架写入', ['app', 'clear-package'], {scope: 'app', data: true}),
  write('upload.image', '上传商店图片', '上架写入', ['upload'], {scope: 'app', file: true}),
  write('upload.apk', '上传 Android APK', '上架写入', ['upload-apk'], {scope: 'app', file: true}),
  write('upload.pc', '上传 Windows 包', '上架写入', ['upload-pc-package'], {scope: 'app', file: true}),
  write('upload.h5', '上传 H5 包', '上架写入', ['upload-h5-package'], {scope: 'app', file: true}),
  write('upload.video', '上传商店视频', '上架写入', ['upload-video'], {scope: 'app', file: true}),
  write('upload.miniApp', '上传 Tap 小游戏包', '上架写入', ['upload-mini-app-package'], {scope: 'app', file: true}),
  write('review.submit', '正式提交审核', '高风险', ['app', 'submit-app-review'], {scope: 'app', data: true, highRisk: true}),
  write('review.withdraw', '撤销审核', '高风险', ['app', 'withdraw-app-review'], {scope: 'app', highRisk: true}),
  write('release.cancelSchedule', '撤销定时上线', '高风险', ['app', 'cancel-scheduled-release'], {scope: 'app', highRisk: true}),
  write('release.reschedule', '修改定时上线时间', '高风险', ['app', 'reschedule-release'], {scope: 'app', data: true, highRisk: true}),
  write('release.publishScheduled', '定时到期立即上线', '高风险', ['app', 'publish-scheduled-release'], {scope: 'app', highRisk: true}),
  write('community.uploadImage', '上传社区配图', '运营写入', ['community-management', '+upload-image'], {scope: 'app', file: true}),
  write('community.uploadVideo', '上传社区视频', '运营写入', ['community-management', '+upload-video'], {scope: 'app', file: true}),
  write('community.createDraft', '保存社区帖子草稿', '运营写入', ['community-management', 'create-community-topic-draft'], {scope: 'app', data: true}),
  write('community.updateDraft', '更新社区帖子草稿', '运营写入', ['community-management', 'update-community-topic-draft'], {scope: 'app', data: true}),
  write('community.publishDraft', '发布已预览社区草稿', '高风险', ['community-management', 'publish-community-topic-draft'], {scope: 'app', data: true, highRisk: true}),
  write('community.reply', '发布社区回复', '高风险', ['community-management', 'create-community-moment-reply'], {scope: 'app', data: true, highRisk: true}),
];

const ACTION_MAP = new Map(ACTIONS.map(action => [action.id, action]));

export function getAction(id) {
  const action = ACTION_MAP.get(id);
  if (!action) throw new Error(`不支持的动作：${id}`);
  return action;
}

function requireId(value, name) {
  const text = String(value ?? '').trim();
  if (!/^[1-9][0-9]*$/.test(text)) throw new Error(`请填写有效的${name}`);
  return text;
}

function idString(value) {
  return /^[1-9][0-9]*$/.test(String(value ?? ''));
}

function cleanData(data) {
  if (data == null) return null;
  if (typeof data !== 'object' || Array.isArray(data)) throw new Error('业务参数必须是 JSON 对象');
  return JSON.parse(JSON.stringify(data));
}

function resolveWorkspaceFile(root, file) {
  const resolved = path.resolve(root, String(file ?? ''));
  const relative = path.relative(root, resolved);
  if (!file || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('文件必须位于当前工作区内');
  }
  return resolved;
}

export function validateReleaseSchedule(schedule, now = Date.now()) {
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) throw new Error('必须提供本次上线方式 release_schedule');
  if (schedule.kind === 'immediate') {
    if (Object.keys(schedule).some(key => key !== 'kind')) throw new Error('立即上线不接受其他发布参数');
    return schedule;
  }
  if (schedule.kind !== 'scheduled_exact' || !Number.isSafeInteger(schedule.release_time)) {
    throw new Error('定时上线必须提供 Unix 秒时间戳');
  }
  if (Object.keys(schedule).some(key => !['kind', 'release_time'].includes(key))) throw new Error('上线方式包含未支持的参数');
  if (schedule.release_time * 1000 < now + 6 * 60 * 60 * 1000) throw new Error('精确定时上线须至少在当前时间 6 小时后');
  return schedule;
}

function validateData(action, data) {
  if (action.data && !action.optionalData && (!data || !Object.keys(data).length)) {
    throw new Error('该动作需要业务参数 JSON');
  }
  if (action.id === 'app.create') {
    for (const key of ['title', 'category', 'developer_role', 'package_type']) {
      if (!data?.[key]) throw new Error(`创建游戏缺少 ${key}`);
    }
  }
  if (action.id === 'app.saveChanges') {
    if (!Array.isArray(data?.changes) || !data.changes.length || data.changes.length > 10) {
      throw new Error('资料变更每批须为 1–10 个字段');
    }
    const seen = new Set();
    for (const change of data.changes) {
      if (!change.field_id || !Object.hasOwn(change, 'expected') || !Object.hasOwn(change, 'value')) {
        throw new Error('每个资料字段都必须带 value 和 expected 当前值快照');
      }
      if (['release_schedule', 'release_method', 'release_time'].includes(change.field_id)) {
        throw new Error('上线方式不能随普通资料保存修改，请在审核上线步骤设置');
      }
      if (seen.has(change.field_id)) throw new Error('同一批资料不能重复修改一个字段');
      seen.add(change.field_id);
      if (change.force === true) throw new Error('工具不允许用 force 绕过防漂移校验');
    }
  }
  if (['app.selectPackage', 'app.clearPackage'].includes(action.id)) {
    if (!['main', 'windows', 'apk_mini_game_play'].includes(data?.slot)) throw new Error('包体槽位不受支持');
    if (!Object.hasOwn(data, 'expected')) throw new Error('包体操作必须原样携带同次读取的 expected');
  }
  if (action.id === 'app.selectPackage') {
    if (!['apk', 'mini_app', 'h5', 'windows'].includes(data?.package?.type)) throw new Error('候选包体类型不受支持');
    requireId(data.package.id, '包体 ID');
    const allowed = ['type', 'id', ...(data.package.type === 'windows' ? ['branch'] : [])];
    if (Object.keys(data.package).some(key => !allowed.includes(key))) throw new Error('包体引用包含不属于该类型的参数');
    if (Object.hasOwn(data.package, 'branch') && ![0, 1, 2].includes(data.package.branch)) throw new Error('Windows 分支必须是候选实际返回的 0、1 或 2');
  }
  if (['review.submit', 'review.precheck'].includes(action.id)) validateReleaseSchedule(data?.release_schedule);
  if (action.id === 'release.reschedule') validateReleaseSchedule({kind: 'scheduled_exact', release_time: data?.release_time});
  if (['community.publishDraft', 'community.getDraft', 'community.updateDraft'].includes(action.id) && !idString(data?.draft_id)) {
    throw new Error('请提供字符串草稿 draft_id');
  }
  if (action.id === 'community.createDraft') validateCommunityDocument(data);
  if (['community.updateDraft', 'community.publishDraft'].includes(action.id)) {
    if (Object.keys(data).some(key => !['draft_id', 'document'].includes(key))) throw new Error('草稿更新与发布只接受 draft_id 和完整 document');
    validateCommunityDocument(data.document);
  }
  if (action.id === 'community.moment' && !idString(data?.moment_id)) throw new Error('请提供原样字符串帖子 moment_id');
  if (['feedback.reviews', 'community.moments'].includes(action.id)) {
    const page = Number(data?.page ?? 1);
    const pageSize = Number(data?.page_size ?? 20);
    if (!Number.isInteger(page) || !Number.isInteger(pageSize) || page < 1 || pageSize < 1 || pageSize > 100 || page * pageSize > 10000) {
      throw new Error('分页须满足 1 ≤ page × page_size ≤ 10000');
    }
    if (action.id === 'community.moments') {
      if (data?.order && !['commented', 'published'].includes(data.order)) throw new Error('帖子排序方式不受支持');
      if (data?.moment_intent && (!Array.isArray(data.moment_intent) || data.moment_intent.some(value => !['1', '2'].includes(value)))) throw new Error('帖子意图筛选不受支持');
    }
  }
}

const ACTION_FLAGS = {
  'upload.video': {scene: ['--scene', ['trailer', 'gameplay_demo_video']]},
  'upload.pc': {launch_exe: ['--launch-exe'], version: ['--version'], windows_branch: ['--windows-branch', [0, 1, 2]]},
  'upload.h5': {screen_orientation: ['--screen-orientation', [0, 1]]},
};

function appendFlags(action, data, args) {
  const flags = ACTION_FLAGS[action.id];
  if (!flags) return;
  if (!data) throw new Error('上传参数不能为空');
  const unknown = Object.keys(data).filter(key => !Object.hasOwn(flags, key));
  if (unknown.length) throw new Error(`上传包含未支持的参数：${unknown.join('、')}`);
  for (const [key, [flag, allowed]] of Object.entries(flags)) {
    if (!Object.hasOwn(data, key)) continue;
    if (allowed && !allowed.includes(data[key])) throw new Error(`${key} 的取值不受支持`);
    if (!allowed && !String(data[key]).trim()) throw new Error(`${key} 不能为空`);
    args.push(flag, String(data[key]));
  }
  if (action.id === 'upload.video' && !data.scene) throw new Error('视频上传必须指定回填场景');
  if (action.id === 'upload.pc' && (!data.launch_exe || !data.version)) throw new Error('Windows 上传必须提供启动 EXE 相对路径和版本号');
}

export function buildActionArgs(input, root) {
  const action = getAction(input?.action);
  const supplied = input?.data;
  const useDefault = action.defaultData && (supplied == null || (typeof supplied === 'object' && !Array.isArray(supplied) && !Object.keys(supplied).length));
  const data = cleanData(useDefault ? action.defaultData : supplied ?? (ACTION_FLAGS[action.id] ? {} : null));
  validateData(action, data);
  const args = [...action.command];
  const context = input?.context ?? {};

  if (action.schema) {
    const service = String(input?.service ?? '').trim();
    const method = String(input?.method ?? '').trim();
    if (!/^[a-z][a-z0-9-]*$/.test(service) || !/^[a-z][a-z0-9-]*$/.test(method)) {
      throw new Error('Schema 需要有效的 service 和 method');
    }
    args.push(service, method);
    return {action, args, data};
  }

  if (action.file) args.push(resolveWorkspaceFile(root, input?.file));

  if (action.scope === 'dev' || action.scope === 'app') {
    args.push('--dev-id', requireId(context.devId, '开发者 ID'));
  }
  if (action.scope === 'app' || action.scope === 'app-only') args.push('--app-id', requireId(context.appId, '游戏 ID'));

  if (ACTION_FLAGS[action.id]) appendFlags(action, data, args);
  else if (action.id === 'app.list' && data?.kw) args.push('--kw', String(data.kw));
  else if (data && Object.keys(data).length) args.push('--data', JSON.stringify(data));

  return {action, args, data};
}

export function publicCatalog() {
  return ACTIONS.map(({command, ...action}) => ({...action, command}));
}
