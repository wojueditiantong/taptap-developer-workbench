import {payload, summarizeRelease, mediaSpec, fieldLabel} from './release.mjs';

const TYPE_NAMES = {apk: 'Android APK', windows: 'Windows', h5: 'H5', mini_app: 'Tap 小游戏'};
const SLOT_NAMES = {main: '主包体', windows: 'Windows 包体', apk_mini_game_play: 'APK 附加小游戏'};
const VERSION_NAMES = {draft: '草稿', reviewing: '审核中', scheduled: '待上线', rejected: '已驳回／已撤定时', online: '线上版本'};
const text = value => typeof value === 'string' ? value : value?.message || value?.reason || value?.label || value?.title || JSON.stringify(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function node(tag, className = '', content = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (content !== '') el.textContent = content;
  return el;
}
function button(label, className = 'button secondary') { return node('button', className, label); }
function optionsOf(field) {
  if (Array.isArray(field.options)) return field.options.map(item => typeof item === 'object' ? {value: item.value ?? item.id, label: item.label ?? item.name ?? String(item.value ?? item.id)} : {value: item, label: field.value_labels?.[String(item)] ?? String(item)});
  if (field.options && typeof field.options === 'object') return Object.entries(field.options).map(([value, label]) => ({value, label: typeof label === 'object' ? label.label ?? label.name ?? value : label}));
  return Object.entries(field.value_labels ?? {}).map(([value, label]) => ({value, label}));
}
function fieldsOf(run) {
  return Object.entries(payload(run?.result).fields ?? {}).map(([field_id, field]) => ({...field, field_id: field.field_id || field_id})).filter(field => field.visible !== false && !field.hidden);
}
function moduleFields(run, moduleId) {
  return fieldsOf(run).filter(field => !moduleId || (field.module_id || moduleId) === moduleId);
}
function distributionSignature(fields) {
  return fields.filter(field => /^region_flag_/.test(field.field_id)).map(field => ({id: field.field_id, value: field.current_value, options: field.options ?? null, labels: field.value_labels ?? null}));
}
function fieldExpected(field) { return field.current_value === null ? [] : structuredClone(field.current_value); }
function message(run) { return run?.result?.error?.hint || run?.result?.error?.message || '官方没有确认这一步成功，请查看执行记录。'; }

export function mediaChangeFromUpload(field, fields, uploaded) {
  let value;
  if (field.input_type === 'video') {
    value = uploaded.videoId;
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('上传返回没有有效的数字 videoId，不能回填');
    const other = fields.find(item => ['trailer', 'gameplay_demo_video'].includes(item.field_id) && item.field_id !== field.field_id);
    if (other && String(other.current_value) === String(value)) throw new Error('宣传片和实机录屏不能使用同一个 videoId，请选择另一个视频');
  } else {
    if (!/^https:\/\//.test(uploaded.url || '') || !uploaded.info || !Number.isInteger(uploaded.info.width) || uploaded.info.width <= 0 || !Number.isInteger(uploaded.info.height) || uploaded.info.height <= 0) throw new Error('上传返回缺少有效图片 URL 或宽高信息，不能回填');
    value = {url: uploaded.url, info: uploaded.info};
  }
  const change = {field_id: field.field_id, value, expected: fieldExpected(field)};
  if (field.input_type === 'image_array') change.op = 'append';
  return change;
}

export function createReleaseStudio(deps) {
  const {$, $$, api, callAction, requireContext, renderInline, resultDetails, startWrite, guard, toast, desktop} = deps;
  const local = {profile: null, distribution: null, packages: null, review: null, versions: [], loaded: new Set()};
  const steps = ['overview', 'package', 'profile', 'distribution', 'review', 'versions'];

  function setStep(step, load = true) {
    if (!steps.includes(step)) throw new Error('未知的发布步骤');
    $$('.wizard-steps li').forEach(el => {
      const active = el.dataset.releaseStep === step;
      el.classList.toggle('active', active);
      if (active) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current');
    });
    $$('.wizard-pane').forEach(el => el.classList.toggle('active', el.dataset.releasePane === step));
    if (!load || local.loaded.has(step)) return;
    local.loaded.add(step);
    const loaders = {overview: () => check(true), package: loadPackages, profile: () => loadProfile(), distribution: loadDistribution, review: snapshot, versions: loadVersions};
    Promise.resolve(loaders[step]()).catch(error => { local.loaded.delete(step); toast(error.message, true); });
  }
  async function read(action, data = {}) {
    const context = requireContext();
    const run = await callAction({action, context, data});
    const latest = requireContext();
    if (latest.devId !== context.devId || latest.appId !== context.appId) throw new Error('游戏已切换，已丢弃上一个游戏的读取结果');
    if (!run.result?.ok) throw new Error(message(run));
    return run;
  }
  function detailAppend(target, run) {
    const details = resultDetails(run); details.querySelector('summary').textContent = '查看官方返回'; target.append(details);
  }
  function loading(selector, label) { $(selector).innerHTML = `<div class="loading-block"><span class="spinner"></span><p>${label}</p></div>`; }
  function heading(title, caption = '') {
    const wrap = node('div', 'studio-heading');
    wrap.append(node('h4', '', title));
    if (caption) wrap.append(node('p', '', caption));
    return wrap;
  }

  async function check(preserveStep = false) {
    const context = requireContext(); if (!preserveStep) setStep('overview');
    loading('#releaseCheckResult', '正在汇总资料、包体、分发、资质和版本…');
    const report = await api('/api/workflows/release-check', {method: 'POST', body: JSON.stringify({context})});
    const latest = requireContext();
    if (latest.devId !== context.devId || latest.appId !== context.appId) return report;
    const summary = summarizeRelease(report.entries);
    const target = $('#releaseCheckResult'); target.replaceChildren();
    const hero = node('section', `release-conclusion ${summary.tasks.length || summary.unknown.length ? 'needs-work' : 'ready'}`);
    const copy = node('div'); copy.append(node('span', 'eyebrow', '本次发布结论'), node('h3', '', summary.conclusion));
    copy.append(node('p', '', `发现 ${summary.tasks.length} 项待办，${summary.unknown.length} 项无法确认。读取成功不代表审核通过。`));
    hero.append(copy, node('strong', 'release-count', String(summary.tasks.length + summary.unknown.length)));
    target.append(hero);
    const tasks = node('div', 'release-task-list');
    for (const item of [...summary.tasks, ...summary.unknown]) {
      const row = node('article', `release-todo ${item.kind}`);
      const body = node('div'); body.append(node('strong', '', item.title), node('p', '', item.detail));
      const go = button(item.kind === 'unknown' ? '查看并处理' : '去处理', 'button secondary');
      go.addEventListener('click', () => setStep(item.tab));
      row.append(node('span', 'todo-mark', item.kind === 'unknown' ? '?' : '!'), body, go); tasks.append(row);
    }
    if (!summary.tasks.length && !summary.unknown.length) tasks.append(node('div', 'ready-note', '当前已读取的项目没有明确缺口，仍须进入审核页执行官方快照和预检。'));
    target.append(heading('下一步，按顺序处理', '点击待办直接跳到对应功能，不需要阅读原始 JSON。'), tasks);
    if (summary.passed.length || summary.distribution.length) {
      const facts = node('details', 'release-facts'); facts.append(node('summary', '', '已确认的事实与玩家入口'));
      const list = node('ul');
      for (const fact of [...summary.passed, ...summary.distribution.map(item => `${item.label}：${item.value}`)]) list.append(node('li', '', fact));
      facts.append(list); target.append(facts);
    }
    if (summary.qualifications.length) {
      const qualifications = node('details', 'release-facts'); qualifications.append(node('summary', '', `资质登记（${summary.qualifications.length} 项，并非全部必交）`));
      const list = node('ul');
      for (const item of summary.qualifications) list.append(node('li', '', `${item.label}：${item.status}${item.reason ? ` · ${item.reason}` : ''}`));
      qualifications.append(list, node('p', 'field-hint', '必交范围以当前游戏上架分析和官方审核要求为准，不把所有待登记项当成阻断。')); target.append(qualifications);
    }
    const links = node('div', 'report-links');
    const link = node('a', 'text-button', '保存的体检报告与官方附录 →'); link.href = report.markdownUrl; link.target = '_blank';
    links.append(link); target.append(links);
    return report;
  }

  function updatePackageKind() {
    const kind = $('#packageKind').value;
    $('#pcUploadFields').classList.toggle('hidden', kind !== 'upload.pc');
    $('#h5UploadFields').classList.toggle('hidden', kind !== 'upload.h5');
  }
  async function uploadPackage() {
    const action = $('#packageKind').value;
    const file = $('#packageFile').value.trim();
    if (!file) throw new Error('请先选择要上传的包体');
    const data = action === 'upload.pc'
      ? {launch_exe: $('#pcLaunchExe').value.trim(), version: $('#pcVersion').value.trim()}
      : action === 'upload.h5' ? {screen_orientation: Number($('#h5Orientation').value)} : {};
    await startWrite({action, context: requireContext(), file, data}, $('#packageResult'), {
      summary: `${TYPE_NAMES[action === 'upload.miniApp' ? 'mini_app' : action.split('.')[1]] || '游戏包体'}：${file}。上传后仍需查询状态、实际设备自测并绑定。`,
      onExecuted: async run => {
        if (!run.result?.ok) return;
        renderInline($('#packageResult'), {title: '包体上传动作已完成', message: '这不等于包体已绑定或可提审。请刷新候选，确认可用后选择目标槽位。', type: 'success'});
        await loadPackages();
      },
    });
  }
  async function loadPackages() {
    const run = await read('app.packages'); local.packages = payload(run.result);
    const target = $('#packageBindings'); target.replaceChildren();
    const data = local.packages;
    if (!data.package_slots) {
      renderInline(target, {title: '暂时不能绑定', message: '本次返回缺少包体槽位快照，已停止绑定。不会用现有绑定信息伪造快照。', type: 'error'}); return;
    }
    const candidates = (data.list ?? []).filter(item => item.status === 'ready' && /^[1-9][0-9]*$/.test(String(item.package_id ?? '')));
    target.append(heading(`可用包体 ${candidates.length} 个`, '只显示本次官方返回的 ready 候选；槽位快照会原样回传。'));
    if (!candidates.length) target.append(node('p', 'empty-note', '还没有可用候选。上传后等待官方状态变为 ready，再刷新。'));
    for (const item of candidates) {
      const card = node('article', 'binding-card');
      const info = node('div', 'binding-info');
      info.append(node('strong', '', item.version || item.package_name || item.file_name || `${TYPE_NAMES[item.type] || item.type} ${item.package_id}`));
      info.append(node('small', '', `${TYPE_NAMES[item.type] || item.type} · ${item.updated_time || item.created_time || '时间未提供'}${Object.hasOwn(item, 'branch') ? ` · 分支 ${item.branch}` : ''}`));
      const select = node('select');
      select.append(new Option('选择要绑定的槽位', ''));
      for (const [slot, descriptor] of Object.entries(data.package_slots)) {
        const compatible = slot === 'windows' ? item.type === 'windows' : slot === 'apk_mini_game_play' ? item.type === 'mini_app' : ['apk', 'mini_app', 'h5'].includes(item.type);
        if (descriptor.available === true && Object.hasOwn(descriptor, 'expected') && compatible) select.append(new Option(SLOT_NAMES[slot] || slot, slot));
      }
      const bind = button('预览绑定', 'button primary');
      bind.addEventListener('click', guard(async () => {
        const slot = select.value;
        if (!slot || !Object.hasOwn(data.package_slots[slot], 'expected')) throw new Error('请选择本次可用且带快照的槽位');
        const ref = {type: item.type, id: String(item.package_id)};
        if (item.type === 'windows' && [0, 1, 2].includes(item.branch)) ref.branch = item.branch;
        await startWrite({action: 'app.selectPackage', context: requireContext(), data: {slot, package: ref, expected: structuredClone(data.package_slots[slot].expected)}}, card.querySelector('.binding-result'), {
          summary: `把 ${TYPE_NAMES[item.type] || item.type} 候选绑定到「${SLOT_NAMES[slot] || slot}」。不会自动提审或上线。`,
          onExecuted: async run => { if (run.result?.ok) { toast('包体绑定已返回，正在核对最新状态'); await loadPackages(); } },
        });
      }, '正在生成包体绑定预览…'));
      const controls = node('div', 'binding-controls'); controls.append(select, bind);
      card.append(info, controls, node('div', 'binding-result')); target.append(card);
    }
    if ((data.current_bindings ?? []).length) {
      target.append(heading('当前已绑定', '清空也必须使用该槽位本次读取的 expected。'));
      for (const binding of data.current_bindings) {
        const slot = binding.slot || binding.package_slot;
        const descriptor = data.package_slots[slot];
        const card = node('article', 'current-binding');
        card.append(node('span', '', `${SLOT_NAMES[slot] || slot || '未标明槽位'}：${binding.version || binding.package_name || binding.package_id || binding.id || '已绑定'}`));
        if (descriptor?.available === true && Object.hasOwn(descriptor, 'expected')) {
          const clear = button('预览清空', 'button ghost');
          clear.addEventListener('click', guard(() => startWrite({action: 'app.clearPackage', context: requireContext(), data: {slot, expected: structuredClone(descriptor.expected)}}, $('#packageResult'), {summary: `清空「${SLOT_NAMES[slot] || slot}」的当前包体绑定。`, onExecuted: async run => { if (run.result?.ok) await loadPackages(); }}), '正在生成清空预览…'));
          card.append(clear);
        }
        target.append(card);
      }
    }
  }

  function mediaCurrent(field) {
    const values = Array.isArray(field.current_value) ? field.current_value : [field.current_value];
    return values.map(value => typeof value === 'string' ? value : value?.url).filter(value => /^https:\/\//.test(value || ''));
  }
  function renderMediaField(field) {
    const card = node('article', 'media-field');
    const head = node('div', 'media-field-head');
    const title = node('div'); title.append(node('strong', '', field.label || field.field_id), node('small', '', `${field.state === 'required' ? '必填' : '选填'} · ${field.input_type === 'image_array' ? '可追加多图' : '单项素材'}`));
    head.append(title, node('span', `pill ${field.filled ? 'neutral' : 'warning'}`, field.filled ? '已有素材' : '待补充')); card.append(head);
    if (mediaSpec(field)) card.append(node('p', 'media-spec', mediaSpec(field)));
    const urls = mediaCurrent(field);
    if (urls.length) {
      const preview = node('div', 'media-current');
      for (const url of urls.slice(0, 6)) { const img = node('img'); img.src = url; img.alt = `${field.label || field.field_id}当前素材`; img.loading = 'lazy'; preview.append(img); }
      card.append(preview);
    }
    const input = node('input'); input.placeholder = field.input_type === 'video' ? '选择 MP4 或 MOV 视频' : '选择当前项目内的图片';
    const choose = button('选择素材', 'button secondary desktop-only');
    choose.addEventListener('click', guard(async () => { const file = await desktop?.pickFile(field.input_type === 'video' ? 'video' : 'image'); if (file) input.value = file; }, '正在选择素材…'));
    const upload = button('上传并继续回填', 'button primary');
    upload.addEventListener('click', guard(async () => {
      const file = input.value.trim(); if (!file) throw new Error('请先选择素材文件');
      const video = field.input_type === 'video';
      if (video && !['trailer', 'gameplay_demo_video'].includes(field.field_id)) throw new Error('这个视频字段没有可确认的上传场景，请通过高级模式核对');
      const data = video ? {scene: field.field_id} : {};
      await startWrite({action: video ? 'upload.video' : 'upload.image', context: requireContext(), file, data}, card.querySelector('.profile-result'), {
        summary: `${field.label || field.field_id}：上传 ${file}。上传成功后还会单独预览资料回填，不会自动保存字段。`,
        onExecuted: async run => { if (run.result?.ok) await previewMediaSave(field, run, card); },
      });
    }, '正在生成素材上传预览…'));
    const controls = node('div', 'media-controls'); controls.append(input, choose, upload);
    card.append(controls, node('p', 'field-hint', field.input_type === 'image_array' ? '追加一张图，不覆盖现有截图。上传后需再次确认资料保存。' : '上传只取得素材句柄，下一步才会把素材写入对应字段。'), node('div', 'profile-result'));
    return card;
  }
  async function previewMediaSave(originalField, uploadRun, oldCard) {
    const latest = await read('app.module', {module_id: local.profile.moduleId});
    const fields = fieldsOf(latest);
    const field = fields.find(item => item.field_id === originalField.field_id);
    if (!field) throw new Error('上传后未能重新读取目标字段，已停止资料回填');
    const uploaded = uploadRun.result?.data ?? {};
    const change = mediaChangeFromUpload(field, fields, uploaded);
    await startWrite({action: 'app.saveChanges', context: requireContext(), data: {changes: [change]}}, oldCard.querySelector('.profile-result') || $('#profileWorkspace'), {
      summary: `把刚上传的素材回填到「${field.label || field.field_id}」。这是独立写入，需要再次确认。`,
      onExecuted: async run => { if (run.result?.ok) { toast('素材字段保存已返回，正在刷新资料'); await loadProfile(local.profile.moduleId); } },
    });
  }

  function renderEditableField(field) {
    const row = node('label', 'dynamic-field');
    const title = node('span', 'dynamic-label', field.label || field.field_id);
    if (field.state === 'required') title.append(node('em', '', '必填'));
    row.append(title);
    let input;
    if (field.input_type === 'select') {
      input = node('select');
      const options = optionsOf(field);
      if (field.current_value == null || field.current_value === '') input.append(new Option('请选择', ''));
      for (const option of options) input.append(new Option(String(option.label), String(option.value)));
    } else {
      input = node(field.input_type === 'textarea' ? 'textarea' : 'input');
      if (field.input_type === 'textarea') input.rows = 4;
      input.value = field.current_value ?? '';
    }
    if (input.tagName === 'SELECT') input.value = String(field.current_value ?? '');
    input.dataset.fieldId = field.field_id; input.dataset.original = JSON.stringify(field.current_value ?? '');
    if (field.constraints?.max_length) input.maxLength = field.constraints.max_length;
    row.append(input);
    const hints = [field.description, field.constraints?.max_length && `最多 ${field.constraints.max_length} 字`].filter(Boolean);
    if (hints.length) row.append(node('small', 'field-hint', hints.join(' · ')));
    return row;
  }
  function renderModule(run, moduleId, target, onlyDistribution = false) {
    const fields = moduleFields(run, moduleId).filter(field => !onlyDistribution || /^region_flag_/.test(field.field_id));
    target.replaceChildren();
    const editable = fields.filter(field => ['text', 'textarea', 'select'].includes(field.input_type));
    const media = fields.filter(field => ['image', 'image_array', 'video'].includes(field.input_type));
    target.append(heading(onlyDistribution ? '实际可见的玩家入口' : '当前草稿内容', onlyDistribution ? '选项完全来自本次官方返回；保存后随版本审核生效，不代表立即开放。' : `共读取 ${fields.length} 个可见字段。只提交你实际修改的项目。`));
    if (!fields.length) { target.append(node('div', 'empty-note', onlyDistribution ? '本次没有返回可识别的 region_flag_* 入口，不作任何分发假设。' : '这个模块暂时没有可展示的可见字段。')); return; }
    if (onlyDistribution) {
      const grid = node('div', 'distribution-grid');
      for (const field of fields) {
        const item = node('div', 'distribution-field');
        item.append(node('strong', '', field.label || field.field_id), node('span', 'distribution-current', `当前：${fieldLabel(field)}`));
        item.append(renderEditableField(field)); grid.append(item);
      }
      target.append(grid);
    } else if (editable.length) {
      const form = node('div', 'dynamic-form'); editable.forEach(field => form.append(renderEditableField(field))); target.append(form);
    }
    if (editable.length) {
      const save = button(onlyDistribution ? '预览分发状态修改' : '预览资料修改', 'button primary');
      save.addEventListener('click', guard(() => previewFieldChanges(fields, target, moduleId), '正在核对并生成保存预览…'));
      target.append(save);
    }
    if (media.length) {
      target.append(heading('图片与视频', '素材规格按当前游戏动态显示。先上传，再确认回填。'));
      const grid = node('div', 'media-fields'); media.forEach(field => grid.append(renderMediaField(field))); target.append(grid);
    }
    const unsupported = fields.filter(field => ![...editable, ...media].includes(field));
    if (unsupported.length) {
      const details = node('details', 'release-facts'); details.append(node('summary', '', `其他只读或暂不支持的字段（${unsupported.length}）`));
      const list = node('ul'); unsupported.forEach(field => list.append(node('li', '', `${field.label || field.field_id}：${fieldLabel(field)}`))); details.append(list); target.append(details);
    }
    detailAppend(target, run);
  }
  function valueForField(field, input) {
    if (field.input_type !== 'select') return input.value;
    const found = optionsOf(field).find(option => String(option.value) === input.value);
    const value = found ? found.value : input.value;
    if (typeof field.current_value === 'number' && value !== '' && Number.isFinite(Number(value))) return Number(value);
    if (typeof field.current_value === 'boolean' && (value === true || value === false || value === 'true' || value === 'false')) return value === true || value === 'true';
    return value;
  }
  async function previewFieldChanges(fields, target, moduleId) {
    const inputs = [...target.querySelectorAll('[data-field-id]')];
    const changes = [];
    for (const input of inputs) {
      const field = fields.find(item => item.field_id === input.dataset.fieldId);
      if (!field) continue;
      const value = valueForField(field, input);
      if (!same(value, field.current_value ?? '')) changes.push({field_id: field.field_id, value, expected: fieldExpected(field)});
    }
    if (!changes.length) throw new Error('还没有修改任何字段');
    if (changes.length > 10) throw new Error('每批最多保存 10 个字段，请分批处理');
    await startWrite({action: 'app.saveChanges', context: requireContext(), data: {changes}}, target, {
      summary: `保存 ${changes.length} 个字段：${changes.map(change => fields.find(field => field.field_id === change.field_id)?.label || change.field_id).join('、')}。只修改草稿，不自动提审。`,
      onExecuted: async run => { if (run.result?.ok) { toast('资料保存已返回，正在重新读取'); moduleId === 'platform-status' ? await loadDistribution() : await loadProfile(moduleId); } },
    });
  }
  async function loadProfile(moduleId = $('#profileModule').value) {
    const run = await read('app.module', {module_id: moduleId});
    if (moduleId !== $('#profileModule').value) return run;
    local.profile = {moduleId, run};
    renderModule(run, moduleId, $('#profileWorkspace'));
    return run;
  }
  async function loadDistribution() {
    const run = await read('app.module.platform'); local.distribution = fieldsOf(run);
    renderModule(run, 'platform-status', $('#distributionWorkspace'), true);
  }

  function schedule() {
    if ($('#releaseMode').value === 'immediate') return {kind: 'immediate'};
    const milliseconds = Date.parse($('#releaseTime').value);
    if (!Number.isFinite(milliseconds)) throw new Error('请选择具体的定时上线时间');
    return {kind: 'scheduled_exact', release_time: Math.floor(milliseconds / 1000)};
  }
  function scheduleText(value) { return value.kind === 'immediate' ? '审核通过后立即上线' : `定时上线：${new Date(value.release_time * 1000).toLocaleString()}`; }
  function invalidateReview() { local.review = null; $('#reviewResult').replaceChildren(); }
  function changeReviewMode() {
    $('#releaseTimeField').classList.toggle('hidden', $('#releaseMode').value !== 'scheduled_exact');
    if ($('#releaseMode').value === 'scheduled_exact' && !$('#releaseTime').value) {
      const date = new Date(Date.now() + 7 * 60 * 60 * 1000); date.setSeconds(0, 0);
      const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000); $('#releaseTime').value = localDate.toISOString().slice(0, 16);
    }
    invalidateReview();
  }
  function renderSnapshot(run, distribution) {
    const data = payload(run.result);
    const target = $('#reviewResult'); target.replaceChildren();
    target.append(heading('复核对象已生成', `版本：${data.version || data.version_id || '以官方返回为准'} · ${scheduleText(local.review.schedule)}`));
    for (const [title, items, kind] of [['本次变更', data.changes ?? [], 'change'], ['无法确认的风险', data.warnings ?? [], 'warning']]) {
      const section = node('section', `review-evidence ${kind}`); section.append(node('h4', '', `${title}（${items.length}）`));
      const list = node('ul');
      if (!items.length) list.append(node('li', '', title === '本次变更' ? '官方快照未列出变更，请先确认这版准备发布的内容。' : '无'));
      items.forEach(item => list.append(node('li', '', text(item)))); section.append(list); target.append(section);
    }
    const notice = node('p', 'legal-hint', '快照不含内容预审结论。下一步会使用完全相同的上线方式执行预检。'); target.append(notice); detailAppend(target, run);
    local.review.distribution = distributionSignature(distribution);
  }
  async function snapshot() {
    const value = schedule();
    const [run, platform] = await Promise.all([read('review.snapshot', {}), read('app.module.platform')]);
    const data = payload(run.result);
    local.review = {snapshot: data, versionId: String(data.version_id ?? data.version ?? ''), schedule: value, precheck: null};
    renderSnapshot(run, fieldsOf(platform));
  }
  function precheckPresentation(data) {
    const blockers = data.blockers ?? [];
    const status = data.preaudit_status ?? (data.preaudit_passed === true ? 'passed' : 'rejected');
    const title = blockers.length ? '仍有官方阻断项' : status === 'passed' ? '内容预审通过，可以准备提审' : status === 'rejected' ? '没有提交阻断，但内容预审未通过' : status === 'unavailable' ? '本次预审没有得出结论' : '本次预审状态无法确认';
    const note = blockers.length ? '继续提交可能被服务端拒绝。' : status === 'rejected' ? '可以继续提交，但后续可能被审核驳回。' : status === 'unavailable' ? '这不是内容预审未通过；可稍后重试，或决定直接提交。' : '请核对风险提示后再决定是否继续。';
    return {blockers, status, title, note, clean: !blockers.length && status === 'passed'};
  }
  async function precheck() {
    if (!local.review) throw new Error('请先生成本次复核快照');
    const run = await read('review.precheck', {release_schedule: local.review.schedule});
    const data = payload(run.result);
    if (local.review.versionId && data.version_id != null && String(data.version_id) !== local.review.versionId) { invalidateReview(); throw new Error('复核后版本已变化，请重新生成快照'); }
    local.review.precheck = data;
    const view = precheckPresentation(data);
    const target = $('#reviewResult'); target.replaceChildren();
    const card = renderInline(target, {title: view.title, message: view.note, type: view.clean ? 'success' : 'error'});
    const list = node('ul', 'review-blockers');
    for (const item of [...view.blockers, ...(data.warnings ?? [])]) list.append(node('li', '', text(item)));
    if (list.children.length) card.append(list);
    if (!view.clean) {
      const accept = node('label', 'risk-accept');
      const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.dataset.reviewRisk = 'accepted';
      accept.append(checkbox, node('span', '', '我已阅读上述阻断或预审风险，仍准备继续提交（最终以服务端裁决为准）。'));
      card.append(accept);
    }
    detailAppend(card, run);
  }
  async function submit() {
    if (!local.review?.precheck) throw new Error('请先完成快照和预检，不能直接提审');
    const view = precheckPresentation(local.review.precheck);
    if (!view.clean && !$('#reviewResult [data-review-risk]')?.checked) throw new Error('请先阅读并明确接受本次预检风险，或返回修改资料');
    const [versions, distribution] = await Promise.all([read('app.versions'), read('app.module.platform')]);
    const list = payload(versions.result).list ?? [];
    const current = list.find(item => String(item.version_id ?? item.version) === local.review.versionId);
    if (!current || !same(distributionSignature(fieldsOf(distribution)), local.review.distribution)) throw new Error('版本或玩家分发入口已变化，请重新生成快照');
    await startWrite({action: 'review.submit', context: requireContext(), data: {release_schedule: local.review.schedule}}, $('#reviewResult'), {
      summary: `${scheduleText(local.review.schedule)}。提交后进入审核，不代表审核通过或玩家入口自动开放。`,
      onExecuted: async run => { if (run.result?.ok) { renderInline($('#reviewResult'), {title: '已成功提交审核', message: '请等待审核结果，通常需要 1–3 个工作日。可到版本管理查看最新状态；玩家入口仍以平台分发页为准。', type: 'success'}); invalidateReview(); } },
    });
  }

  async function loadVersions() {
    const run = await read('app.versions'); local.versions = payload(run.result).list ?? [];
    const target = $('#versionsResult'); target.replaceChildren(); $('#versionActions').replaceChildren();
    if (!local.versions.length) { target.append(node('div', 'empty-note', '当前没有读到版本记录。')); return; }
    for (const version of local.versions) {
      const card = node('article', 'version-card');
      const main = node('div'); main.append(node('strong', '', version.version || `版本 ${version.version_id || '未编号'}`), node('small', '', version.updated_time || version.created_time || '时间未提供'));
      const status = node('span', `version-status ${version.status || 'unknown'}`, VERSION_NAMES[version.status] || version.status || '状态未知');
      card.append(main, status);
      if (version.release_time) card.append(node('p', '', `计划上线：${new Date(Number(version.release_time) * 1000).toLocaleString()}`));
      if (['reviewing', 'scheduled'].includes(version.status)) {
        const actions = node('div', 'version-card-actions');
        if (version.status === 'reviewing') actions.append(versionButton('撤销审核', 'review.withdraw', version));
        else {
          const time = node('input'); time.type = 'datetime-local'; time.setAttribute('aria-label', '新的定时上线时间');
          const change = button('预览修改定时', 'button secondary');
          change.addEventListener('click', guard(() => versionAction('release.reschedule', version, {release_time: Math.floor(Date.parse(time.value) / 1000)}, `把版本 ${version.version} 的上线时间改为 ${time.value}。`), '正在生成改期预览…'));
          actions.append(time, change, versionButton('撤销定时上线', 'release.cancelSchedule', version));
          if (Number(version.release_time) * 1000 <= Date.now()) actions.append(versionButton('定时已到，立即发布', 'release.publishScheduled', version, 'danger-outline'));
        }
        card.append(actions);
      }
      target.append(card);
    }
  }
  function versionButton(label, action, version, kind = 'secondary') {
    const el = button(label, `button ${kind}`);
    el.addEventListener('click', guard(async () => {
      const detail = await read('app.currentVersion', {version: version.version});
      const latest = payload(detail.result);
      const status = latest.status ?? latest.detail?.status;
      const expected = action === 'review.withdraw' ? 'reviewing' : 'scheduled';
      if (status && status !== expected) { await loadVersions(); throw new Error('版本状态已变化，已停止旧状态上的操作'); }
      await versionAction(action, version, {}, `${label}：版本 ${version.version}。`);
    }, '正在核对版本状态并生成预览…'));
    return el;
  }
  async function versionAction(action, version, data, summary) {
    if (!data.release_time && action === 'release.reschedule') throw new Error('请选择新的定时上线时间');
    await startWrite({action, context: requireContext(), data}, $('#versionResult'), {summary, onExecuted: async run => { if (run.result?.ok) { toast(action === 'release.cancelSchedule' ? '已撤销定时上线，可以修改后重新提审' : '版本操作已返回，正在刷新'); await loadVersions(); } }});
  }

  function reset() {
    local.profile = null; local.distribution = null; local.packages = null; local.review = null; local.versions = [];
    local.loaded.clear();
    for (const selector of ['#releaseCheckResult', '#packageBindings', '#distributionWorkspace', '#versionsResult', '#versionActions', '#packageResult', '#reviewResult', '#versionResult']) $(selector).replaceChildren();
    $('#profileWorkspace').replaceChildren(node('div', 'empty-note', '选择资料模块后读取当前游戏的真实内容。'));
    setStep('overview', false);
  }

  $$('[data-release-step]').forEach(el => {
    el.addEventListener('click', () => setStep(el.dataset.releaseStep));
    el.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); setStep(el.dataset.releaseStep); } });
  });
  $$('[data-release-pane]').forEach((pane, index) => {
    const navigation = node('div', 'wizard-navigation');
    const previous = button('← 上一步', 'button ghost');
    previous.disabled = index === 0;
    previous.addEventListener('click', () => setStep(steps[index - 1]));
    const next = button('下一步 →', 'button secondary');
    next.disabled = index === steps.length - 1;
    next.addEventListener('click', () => setStep(steps[index + 1]));
    navigation.append(previous, next); pane.append(navigation);
  });
  $('#releaseCheck').addEventListener('click', guard(() => check(), '正在进行发布体检…'));
  $('#releaseCheckTop').addEventListener('click', guard(() => check(), '正在重新体检…'));
  $('#packageKind').addEventListener('change', updatePackageKind);
  $('#uploadPackage').addEventListener('click', guard(uploadPackage, '正在生成包体上传预览…'));
  $('#choosePackage').addEventListener('click', guard(async () => { const file = await desktop?.pickFile('package'); if (file) $('#packageFile').value = file; }, '正在选择包体…'));
  $('#loadPackages').addEventListener('click', guard(loadPackages, '正在读取包体候选和槽位…'));
  $('#loadProfileModule').addEventListener('click', guard(() => loadProfile(), '正在读取真实资料字段…'));
  $('#profileModule').addEventListener('change', () => { local.profile = null; $('#profileWorkspace').replaceChildren(); });
  $('#loadDistribution').addEventListener('click', guard(loadDistribution, '正在读取平台和分发状态…'));
  $('#releaseMode').addEventListener('change', changeReviewMode);
  $('#releaseTime').addEventListener('change', invalidateReview);
  $('#reviewSnapshot').addEventListener('click', guard(snapshot, '正在生成复核快照…'));
  $('#reviewPrecheck').addEventListener('click', guard(precheck, '正在执行提审预检…'));
  $('#reviewSubmit').addEventListener('click', guard(submit, '正在重新核对版本和分发状态…'));
  $('#loadVersions').addEventListener('click', guard(loadVersions, '正在读取版本状态…'));
  updatePackageKind(); changeReviewMode();
  return {setStep, check, reset};
}
