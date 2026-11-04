import {renderOperationsReport} from './report-view.js';
import {createReleaseStudio} from './release-studio.js';
import {createCommunityStudio} from './community-studio.js';
import {createGameDetailStudio} from './game-detail.js';

let releaseStudio;
let communityStudio;
let gameDetailStudio;

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = {
  catalog: [], context: {devId: '', appId: ''}, names: {developer: '', game: ''},
  connected: false, preview: null, previewTarget: null, lastResult: null, days: 7,
};
const titles = {home: ['WORKSPACE', '开始'], create: ['NEW GAME', '创建新游戏'], 'game-detail': ['GAME DETAILS', '游戏详情'], release: ['RELEASE', '上架发布'], community: ['COMMUNITY', '社区发帖'], operations: ['LIVEOPS', '经营分析'], runs: ['RECEIPTS', '执行记录'], guide: ['PLAYBOOK', '使用指南']};
const statusNames = {succeeded: '已完成', failed: '未完成', awaiting_confirmation: '待确认', running: '执行中'};
const modeNames = {read: '只读', preview: '写入预览', execute: '实际执行'};

const desktop = window.taptapDesktop || null;
if (desktop) document.documentElement.classList.add('desktop');

async function api(url, options = {}) {
  if (desktop) return desktop.request(url, options);
  const response = await fetch(url, {...options, headers: {'Content-Type': 'application/json', ...(options.headers || {})}});
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = {error: text}; }
  if (!response.ok) throw new Error(payload.error || payload?.error?.hint || `请求失败 ${response.status}`);
  return payload;
}

function openReport(event) {
  const link = event.target.closest('a[href^="/api/reports/"]');
  if (!link || !desktop) return;
  event.preventDefault();
  withBusy('正在打开报告…', () => desktop.openReport(link.getAttribute('href'))).catch(error => toast(error.message, true));
}
document.addEventListener('click', openReport);

function toast(message, error = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 5000);
}

let busyCount = 0;
async function withBusy(text, task) {
  busyCount += 1;
  communityStudio?.setObscured(true);
  $('#busyText').textContent = text;
  $('#busyOverlay').classList.remove('hidden');
  try { return await task(); }
  finally {
    busyCount -= 1;
    if (!busyCount) {
      $('#busyOverlay').classList.add('hidden');
      communityStudio?.setObscured(false);
    }
  }
}

async function go(view) {
  if (communityStudio) await communityStudio.deactivate();
  $$('.view').forEach(el => el.classList.toggle('active', el.id === view));
  $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.go === view));
  $('#viewTitle').textContent = titles[view][1];
  $('#viewEyebrow').textContent = titles[view][0];
  window.scrollTo({top: 0, behavior: 'smooth'});
  if (view === 'runs') await loadRuns();
  if (view === 'community') await communityStudio.activate();
  if (view === 'game-detail') await gameDetailStudio.activate();
}

function currentContext() { return {devId: state.context.devId, appId: state.context.appId}; }
function requireContext() {
  if (!state.context.devId || !state.context.appId) {
    go('home');
    throw new Error('请先选择开发者和游戏，再开始这个任务');
  }
  return currentContext();
}

function friendlyError(runOrError) {
  const error = runOrError?.result?.error || runOrError?.error || runOrError;
  const type = error?.type || '';
  const hint = error?.hint || error?.message || String(error?.message || error || '未完成');
  if (type === 'authentication' || /未配置|未登录|凭证/.test(hint)) return 'TapTap 尚未授权。请先在开始页完成账号连接。';
  if (type === 'authorization' || /权限|permission/i.test(hint)) return '当前账号没有这个游戏的所需权限，请核对账号或开发者主体。';
  if (type === 'network') return '暂时无法连接 TapTap，请检查网络后再试。';
  if (type === 'confirmation') return '官方要求进一步确认，请核对本次动作和参数。';
  return hint || '动作未完成，请查看执行记录。';
}

function unwrap(result) { return result?.data?.result ?? result?.data ?? result?.result ?? result; }
function extractField(value, key, depth = 0) {
  if (!value || depth > 8 || typeof value !== 'object') return undefined;
  if (Object.hasOwn(value, key)) return value[key];
  for (const child of Object.values(value)) {
    const found = extractField(child, key, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function resultDetails(run) {
  const details = document.createElement('details');
  details.className = 'result-details';
  const summary = document.createElement('summary');
  summary.textContent = '查看本次实际返回';
  const pre = document.createElement('pre');
  pre.className = 'json-result';
  pre.textContent = JSON.stringify(run?.result ?? run, null, 2);
  details.append(summary, pre);
  return details;
}

function renderInline(target, {title, message = '', type = '', links = [], run = null}) {
  const el = typeof target === 'string' ? $(target) : target;
  el.innerHTML = '';
  const card = document.createElement('div');
  card.className = `result-card ${type}`;
  const strong = document.createElement('strong'); strong.textContent = title;
  card.append(strong);
  if (message) { const p = document.createElement('p'); p.textContent = message; card.append(p); }
  for (const link of links) {
    const a = document.createElement('a'); a.href = link.url; a.textContent = link.label;
    if (/^https?:/.test(link.url)) { a.target = '_blank'; a.rel = 'noreferrer'; }
    card.append(a);
  }
  if (run) card.append(resultDetails(run));
  el.append(card);
  return card;
}

async function callAction(input) {
  return api('/api/runs', {method: 'POST', body: JSON.stringify({...input, context: input.context || currentContext()})});
}

async function saveContext(context, names = {}) {
  const changed = state.context.devId !== context.devId || state.context.appId !== context.appId;
  state.context = await api('/api/state', {method: 'PUT', body: JSON.stringify(context)});
  state.names = {...state.names, ...names};
  if (changed) {
    state.reportGeneration = (state.reportGeneration || 0) + 1;
    releaseStudio?.reset(); communityStudio?.reset(); gameDetailStudio?.reset();
    $('#reportResult').innerHTML = '<div class="empty-state"><span>◫</span><h4>为当前游戏生成经营分析</h4><p>切换游戏后不会沿用上一份报告。请选择时间范围并重新读取。</p></div>';
    $('#reviewsList').innerHTML = '<div class="empty-state"><span>☰</span><h4>读取当前游戏的玩家评价</h4><p>不会展示上一个游戏的反馈。</p></div>';
  }
  localStorage.setItem('taptap-ops-names', JSON.stringify(state.names));
  $('#devId').value = state.context.devId;
  $('#appId').value = state.context.appId;
  updateCurrentGame();
}

function updateCurrentGame() {
  const ready = state.context.devId && state.context.appId;
  $('#currentGameName').textContent = ready ? (state.names.game || `游戏 ${state.context.appId}`) : '尚未选择游戏';
  if (ready && state.connected) renderSelectedGame();
}

function setSetupProgress(step) {
  $('#setupBadge').textContent = `${step} / 3`;
  for (let index = 1; index <= 3; index += 1) {
    const el = $(`#setupStep${index}`);
    el.classList.toggle('active', index === step);
    el.classList.toggle('done', index < step);
  }
}

function setupAction({title, message, primary, onPrimary, secondary, onSecondary}) {
  const content = $('#setupContent'); content.innerHTML = '';
  const row = document.createElement('div'); row.className = 'setup-action';
  const copy = document.createElement('div');
  const h = document.createElement('h4'); h.textContent = title;
  const p = document.createElement('p'); p.textContent = message;
  copy.append(h, p);
  const actions = document.createElement('div'); actions.className = 'setup-actions';
  if (secondary) {
    const button = document.createElement('button'); button.className = 'button ghost'; button.textContent = secondary;
    button.addEventListener('click', onSecondary); actions.append(button);
  }
  const button = document.createElement('button'); button.className = 'button primary'; button.textContent = primary;
  button.addEventListener('click', onPrimary); actions.append(button);
  row.append(copy, actions); content.append(row);
}

let authPollTimer = null;
function stopAuthPolling() {
  clearTimeout(authPollTimer);
  authPollTimer = null;
}

function openAuthPage(url) {
  if (desktop) return desktop.openAuth(url);
  const opened = window.open(url, '_blank');
  if (opened) opened.opener = null;
  else toast('浏览器阻止了新标签页，请允许本工作台打开授权页', true);
}

function renderAuthWaiting(session) {
  setupAction({
    title: '在官方页面确认授权',
    message: '授权窗口由应用独立管理。完成后这里会自动继续，不需要复制命令或令牌。',
    primary: '重新打开授权页',
    onPrimary: () => openAuthPage(session.verificationUrl),
    secondary: '取消连接',
    onSecondary: async () => {
      stopAuthPolling();
      await api('/api/auth', {method: 'DELETE'});
      checkConnection();
    },
  });
  const waiting = document.createElement('div');
  waiting.className = 'auth-waiting';
  const spinner = document.createElement('span'); spinner.className = 'spinner';
  const text = document.createElement('span'); text.textContent = '正在等待 TapTap 返回授权结果…';
  waiting.append(spinner, text);
  $('#setupContent').append(waiting);
}

async function pollAuthorization() {
  stopAuthPolling();
  try {
    const session = await api('/api/auth');
    if (session.status === 'waiting') {
      authPollTimer = setTimeout(pollAuthorization, 1500);
      return;
    }
    if (session.status === 'connected') {
      toast('TapTap 连接成功');
      await checkConnection();
      if (!state.context.devId) await loadDevelopers();
      return;
    }
    setupAction({
      title: session.status === 'expired' ? '授权链接已过期' : '这次连接没有完成',
      message: '没有保存任何登录信息。重新连接会生成一个新的官方授权页面。',
      primary: '重新连接', onPrimary: startAuthorization,
    });
  } catch (error) {
    setupAction({title: '暂时无法确认授权结果', message: error.message, primary: '重新检查', onPrimary: pollAuthorization});
  }
}

async function startAuthorization() {
  stopAuthPolling();
  const authTab = desktop ? null : window.open('about:blank', '_blank');
  $('#setupContent').innerHTML = '<div class="loading-block"><span class="spinner"></span><p>正在打开 TapTap 官方授权…</p></div>';
  try {
    const session = await api('/api/auth', {method: 'POST'});
    if (desktop) await openAuthPage(session.verificationUrl);
    else if (authTab && !authTab.closed) authTab.location.href = session.verificationUrl;
    renderAuthWaiting(session);
    authPollTimer = setTimeout(pollAuthorization, 1200);
  } catch (error) {
    if (authTab && !authTab.closed) authTab.close();
    setupAction({title: '暂时无法打开官方授权', message: error.message, primary: '重试连接', onPrimary: startAuthorization});
  }
}

async function checkConnection() {
  stopAuthPolling();
  setSetupProgress(1);
  try {
    const run = await callAction({action: 'auth.status', context: {}});
    const raw = JSON.stringify(run.result);
    state.connected = Boolean(run.result?.ok) && !/未配置|未登录|not.?configured|unauthorized/i.test(raw);
  } catch { state.connected = false; }
  $('#miniStatusDot').className = `status-dot ${state.connected ? 'online' : 'offline'}`;
  $('#miniStatusText').textContent = state.connected ? 'TapTap 已连接' : 'TapTap 未连接';
  updateAccountDialog();
  if (state.connected && state.context.devId && state.context.appId) { updateCurrentGame(); return; }
  if (state.connected) {
    setupAction({title: '账号连接正常', message: '下一步，选择这次要管理的开发者主体。', primary: '选择开发者', onPrimary: loadDevelopers});
  } else {
    setupAction({
      title: '连接你的 TapTap 开发者账号',
      message: '点击后在应用内打开官方授权页。密码和令牌始终由 TapTap 与官方 CLI 保管。',
      primary: '连接 TapTap', onPrimary: startAuthorization,
    });
  }
}

function updateAccountDialog() {
  $('#accountStatusDot').className = `status-dot ${state.connected ? 'online' : 'offline'}`;
  $('#accountStatus').textContent = state.connected ? 'TapTap 已连接' : '当前尚未连接';
  $('#logoutButton').classList.toggle('hidden', !state.connected);
  $('#switchAccountButton').classList.toggle('hidden', !state.connected);
}

async function logoutConnection(switchAccount = false) {
  await api('/api/auth/logout', {method: 'POST'});
  stopAuthPolling();
  state.connected = false;
  await saveContext({devId: '', appId: ''}, {developer: '', game: ''});
  $('#accountDialog').close();
  go('home');
  await checkConnection();
  if (switchAccount) {
    toast('旧连接已清除，请授权另一个 TapTap 账号');
    await startAuthorization();
  } else toast('已退出 TapTap 连接，线上内容不受影响');
}

function entities(value, type) {
  const found = [];
  const seen = new Set();
  function walk(node, depth = 0) {
    if (!node || depth > 8 || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(child => walk(child, depth + 1)); return; }
    const id = type === 'developer'
      ? node.developer_id ?? node.developerId ?? node.dev_id ?? node.devId ?? node.id
      : node.app_id ?? node.appId ?? node.id;
    const name = node.title ?? node.name ?? node.display_name ?? node.displayName ?? node.app_name ?? node.developer_name;
    if (/^[1-9][0-9]*$/.test(String(id ?? '')) && name) {
      const key = String(id);
      if (!seen.has(key)) { seen.add(key); found.push({id: key, name: String(name)}); }
    }
    Object.values(node).forEach(child => walk(child, depth + 1));
  }
  walk(unwrap(value));
  return found;
}

async function loadDevelopers() {
  setSetupProgress(2);
  $('#setupContent').innerHTML = '<div class="loading-block"><span class="spinner"></span><p>正在读取开发者主体…</p></div>';
  const run = await callAction({action: 'developer.list', context: {}});
  const list = entities(run.result, 'developer');
  if (!run.result?.ok || !list.length) {
    setupAction({title: '暂时没有读到开发者主体', message: friendlyError(run), primary: '重新读取', onPrimary: loadDevelopers, secondary: '检查连接', onSecondary: () => checkConnection()});
    return;
  }
  const content = $('#setupContent'); content.innerHTML = '';
  const grid = document.createElement('div'); grid.className = 'entity-grid';
  for (const developer of list) {
    const button = document.createElement('button'); button.className = 'entity-card';
    const name = document.createElement('strong'); name.textContent = developer.name;
    const id = document.createElement('small'); id.textContent = `开发者 ID · ${developer.id}`;
    button.append(name, id);
    button.addEventListener('click', async () => {
      await saveContext({devId: developer.id, appId: ''}, {developer: developer.name, game: ''});
      loadGames();
    });
    grid.append(button);
  }
  content.append(grid);
}

async function loadGames() {
  setSetupProgress(3);
  $('#setupContent').innerHTML = '<div class="loading-block"><span class="spinner"></span><p>正在读取游戏列表…</p></div>';
  const run = await callAction({action: 'app.list', context: {devId: state.context.devId}, data: {}});
  const list = entities(run.result, 'app');
  if (!run.result?.ok || !list.length) {
    setupAction({title: '这个开发者下没有读到游戏', message: friendlyError(run), primary: '重新读取', onPrimary: loadGames, secondary: '换开发者', onSecondary: loadDevelopers});
    return;
  }
  const content = $('#setupContent'); content.innerHTML = '';
  const grid = document.createElement('div'); grid.className = 'entity-grid';
  for (const game of list) {
    const button = document.createElement('button'); button.className = 'entity-card';
    const name = document.createElement('strong'); name.textContent = game.name;
    const id = document.createElement('small'); id.textContent = `游戏 ID · ${game.id}`;
    button.append(name, id);
    button.addEventListener('click', () => saveContext({devId: state.context.devId, appId: game.id}, {game: game.name}));
    grid.append(button);
  }
  content.append(grid);
}

function renderSelectedGame() {
  setSetupProgress(3);
  $('#setupBadge').textContent = '已就绪';
  const content = $('#setupContent'); content.innerHTML = '';
  const row = document.createElement('div'); row.className = 'selected-game';
  const avatar = document.createElement('span'); avatar.className = 'game-avatar'; avatar.textContent = '游';
  const copy = document.createElement('div');
  const title = document.createElement('h4'); title.textContent = state.names.game || `游戏 ${state.context.appId}`;
  const meta = document.createElement('p'); meta.textContent = `${state.names.developer || '开发者已选择'} · 可以开始上架或运营任务`;
  copy.append(title, meta);
  const change = document.createElement('button'); change.className = 'button ghost'; change.textContent = '切换游戏';
  change.addEventListener('click', () => state.connected ? loadDevelopers() : checkConnection());
  row.append(avatar, copy, change); content.append(row);
}

function actionById(id) { return state.catalog.find(action => action.id === id); }
function parseJsonField(selector) {
  const text = $(selector).value.trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { throw new Error('参数不是有效 JSON，请检查括号和引号'); }
}

function updateActionForm() {
  const action = actionById($('#actionSelect').value);
  if (!action) return;
  $('#actionHint').textContent = `${action.risk === 'write' ? '写入动作，将先生成预览' : '只读动作'} · ${action.command.join(' ')}`;
  $('#runAction').textContent = action.risk === 'write' ? '生成写入预览' : '运行只读动作';
  $('#dataField').classList.toggle('hidden', !action.data && action.id !== 'app.list');
  $('#fileField').classList.toggle('hidden', !action.file);
  $('#schemaFields').classList.toggle('hidden', !action.schema);
  $('#actionData').value = action.defaultData ? JSON.stringify(action.defaultData, null, 2) : '{}';
}

function renderRaw(run) {
  state.lastResult = run;
  const el = $('#actionResult'); el.innerHTML = '';
  const meta = document.createElement('p');
  meta.textContent = `${run.label} · ${modeNames[run.mode] || run.mode} · ${statusNames[run.status] || run.status}`;
  el.append(meta, resultDetails(run));
  el.querySelector('details').open = true;
}

function openConfirmation(run, target, options = {}) {
  state.preview = run;
  state.previewTarget = target;
  state.previewOptions = options;
  const phrase = `确认${run.label}`;
  const targetName = run.action === 'app.create' ? `新游戏：${run.input?.data?.title || createGameData().title}` : `游戏：${state.names.game || state.context.appId || '未选择'}`;
  const detail = options.summary ? `\n${options.summary}\n` : '';
  $('#confirmSummary').textContent = `${run.label}\n${targetName}\n${detail}\n请输入：${phrase}`;
  $('#confirmationText').value = '';
  $('#confirmationText').placeholder = phrase;
  $('#confirmDialog').showModal();
  $('#confirmationText').focus();
}

async function startWrite(input, target, options = {}) {
  const run = await callAction(input);
  if (run.status === 'awaiting_confirmation') openConfirmation(run, target, options);
  else renderInline(target, {title: run.result?.ok ? '预览已返回' : '预览未通过', message: friendlyError(run), type: run.result?.ok ? 'success' : 'error', run});
  return run;
}

async function simpleRead(action, target, data = null) {
  const run = await callAction({action, context: requireContext(), data});
  renderInline(target, {title: run.result?.ok ? '读取完成' : '读取未完成', message: run.result?.ok ? '官方返回已保存到执行记录，可展开查看。' : friendlyError(run), type: run.result?.ok ? 'success' : 'error', run});
  return run;
}

let createStep = 0;
const createFields = ['#createRole', '#createTitle', '#createCategory', '#createPackage'];
function createGameData() {
  return {
    developer_role: $('#createRole').value,
    title: $('#createTitle').value.trim(),
    category: $('#createCategory').value,
    package_type: $('#createPackage').value,
  };
}
function setCreateStep(step) {
  createStep = Math.max(0, Math.min(4, step));
  $$('.create-step').forEach(panel => panel.classList.toggle('active', Number(panel.dataset.createStep) === createStep));
  $('#createStepCount').textContent = `第 ${createStep + 1} 步，共 5 步`;
  $('#createBack').disabled = createStep === 0;
  $('#createForm').classList.toggle('review', createStep === 4);
  if (createStep === 4) {
    const summary = $('#createSummary'); summary.innerHTML = '';
    const values = [
      ['当前厂商', state.names.developer || `开发者 ${state.context.devId}`],
      ['厂商关系', $('#createRole').selectedOptions[0].textContent],
      ['游戏名称', $('#createTitle').value.trim()],
      ['游戏类型', $('#createCategory').selectedOptions[0].textContent],
      ['包体方向', $('#createPackage').selectedOptions[0].textContent],
    ];
    for (const [label, value] of values) { const dt = document.createElement('dt'); dt.textContent = label; const dd = document.createElement('dd'); dd.textContent = value; summary.append(dt, dd); }
  }
}
function startCreateGame() {
  if (!state.connected || !state.context.devId) {
    go('home');
    throw new Error('请先连接账号并选择开发者，再创建新游戏');
  }
  $('#createForm').reset();
  $('#createResult').innerHTML = '';
  $('#createDeveloperName').textContent = state.names.developer || `开发者 ${state.context.devId}`;
  go('create'); setCreateStep(0);
}
function nextCreateStep() {
  const field = $(createFields[createStep]);
  if (!field.value.trim()) { field.focus(); toast('请先完成当前这一项', true); return; }
  setCreateStep(createStep + 1);
}
async function previewCreateGame() {
  if (createStep !== 4) return nextCreateStep();
  const data = createGameData();
  await startWrite({action: 'app.create', context: {devId: state.context.devId, appId: ''}, data}, '#createResult');
}
async function showCreatedGame(run) {
  const appId = extractField(run.result, 'app_id');
  const created = extractField(run.result, 'created');
  if (!run.result?.ok || created === false || !/^[1-9][0-9]*$/.test(String(appId ?? ''))) {
    renderInline('#createResult', {title: '没有确认创建成功', message: friendlyError(run), type: 'error', run});
    return;
  }
  const title = extractField(run.result, 'title') || createGameData().title;
  await saveContext({devId: state.context.devId, appId: String(appId)}, {game: String(title)});
  const card = renderInline('#createResult', {title: '游戏草稿已创建', message: `已切换到「${title}」。这只是草稿，不代表已经提审或上线。`, type: 'success', run});
  const checklist = document.createElement('ul'); checklist.className = 'created-checklist';
  for (const text of ['按官方实际字段完善图标、简介、开发者的话与真实游戏素材', '上传并验证包体，再绑定到商店资料', '核对实际分发状态，之后单独决定是否提审']) {
    const item = document.createElement('li'); item.textContent = text; checklist.append(item);
  }
  const next = document.createElement('button'); next.className = 'button primary'; next.textContent = '继续完善商店资料';
  next.addEventListener('click', () => { go('release'); setReleaseStep('profile'); });
  card.append(checklist, next);
  toast('已创建游戏草稿，请继续完善资料');
}

function setReleaseStep(step) { releaseStudio?.setStep(step); }

async function operationsReport() {
  const context = requireContext();
  const generation = state.reportGeneration || 0;
  const body = {context, start_date: $('#reportStart').value, end_date: $('#reportEnd').value};
  $('#reportResult').innerHTML = '<div class="analysis-loading"><span class="spinner"></span><div><h3>正在生成经营分析</h3><strong></strong><p>正在读取本期、前周期与玩家反馈。读取期间可以继续查看其他页面，切换游戏后本次结果不会覆盖新游戏。</p></div></div>';
  $('#reportResult .analysis-loading strong').textContent = `${state.names.game || `游戏 ${context.appId}`} · ${body.start_date} — ${body.end_date}`;
  const report = await api('/api/workflows/operations-report', {method: 'POST', body: JSON.stringify(body)});
  if (generation !== (state.reportGeneration || 0) || context.devId !== state.context.devId || context.appId !== state.context.appId) return;
  renderOperationsReport($('#reportResult'), report, {onNavigate: openAnalysisDestination});
  toast('经营分析已生成，可查看周期对比、趋势与建议');
}

async function openAnalysisDestination(target) {
  try {
    if (target === 'reviews') return $('[data-ops-tab="reviews"]').click();
    if (target !== 'template') return;
    await go('community');
    await communityStudio.openTemplates('version');
  } catch (error) { toast(error.message, true); }
}

function reviewList(result) {
  const list = extractField(result, 'list');
  return Array.isArray(list) ? list : [];
}

async function loadReviews() {
  const filter = $('#reviewFilter').value;
  const data = {page: 1, page_size: 20, order: 'update'};
  if (filter === 'negative') data.score = 'negative';
  if (filter === 'unreplied') data.examined = false;
  const run = await callAction({action: 'feedback.reviews', context: requireContext(), data});
  const target = $('#reviewsList'); target.innerHTML = '';
  if (!run.result?.ok) {
    renderInline(target, {title: '评价读取未完成', message: friendlyError(run), type: 'error', run});
    return;
  }
  const list = reviewList(run.result);
  if (!list.length) {
    target.innerHTML = '<div class="empty-state"><span>✓</span><h4>本次没有匹配的评价</h4><p>可以切换筛选条件，或到报告中确认平台实际返回。</p></div>';
    return;
  }
  for (const review of list) {
    const card = document.createElement('article'); card.className = 'review';
    const head = document.createElement('div'); head.className = 'review-head';
    const stars = document.createElement('span'); stars.className = 'stars'; stars.textContent = '★'.repeat(review.score || 0) + '☆'.repeat(Math.max(0, 5 - (review.score || 0)));
    const status = document.createElement('span'); status.className = `reply-status ${review.has_official_comment ? 'replied' : ''}`; status.textContent = review.has_official_comment ? '已官方回复' : '待关注';
    head.append(stars, status);
    const body = document.createElement('p'); body.textContent = review.contents || '（这条评价没有正文）';
    const foot = document.createElement('footer'); foot.textContent = `${review.played_tips || '游玩时长未展示'} · ${review.device || '设备未展示'} · ${review.comment_total ?? 0} 条回复`;
    card.append(head, body, foot); target.append(card);
  }
}

async function loadRuns() {
  const {runs} = await api('/api/runs');
  const target = $('#runsList'); target.innerHTML = '';
  if (!runs.length) { target.innerHTML = '<div class="empty-state"><span>✓</span><h4>还没有执行记录</h4><p>运行一次只读检查或写入预览后，就能在这里回查。</p></div>'; return; }
  for (const run of runs) {
    const row = document.createElement('button'); row.className = 'run-row'; row.type = 'button';
    const time = document.createElement('time'); time.textContent = new Date(run.createdAt).toLocaleString();
    const label = document.createElement('strong'); label.textContent = run.label;
    const mode = document.createElement('small'); mode.textContent = modeNames[run.mode] || run.mode;
    const status = document.createElement('span'); status.className = `run-status ${run.status}`; status.textContent = statusNames[run.status] || run.status;
    row.append(time, label, mode, status);
    row.addEventListener('click', async () => {
      const full = await api(`/api/runs/${run.id}`);
      const existing = row.nextElementSibling;
      if (existing?.classList.contains('run-detail')) { existing.remove(); return; }
      const detail = document.createElement('div'); detail.className = 'run-detail';
      detail.append(resultDetails(full)); detail.querySelector('details').open = true;
      row.after(detail);
    });
    target.append(row);
  }
}

$$('[data-go]').forEach(button => button.addEventListener('click', guard(() => go(button.dataset.go), '正在打开工作空间…')));
$$('[data-task]').forEach(button => button.addEventListener('click', guard(async () => {
  if (button.dataset.task === 'create') return startCreateGame();
  if (button.dataset.task === 'release') setReleaseStep('overview');
  await go(button.dataset.task);
}, '正在打开任务…')));
$$('[data-ops-tab]').forEach(button => button.addEventListener('click', () => {
  $$('[data-ops-tab]').forEach(el => el.classList.toggle('active', el === button));
  $$('.ops-pane').forEach(el => el.classList.toggle('active', el.dataset.opsPane === button.dataset.opsTab));
}));

function guard(task, busyText = '正在处理…') {
  return async event => {
    event?.preventDefault();
    try { await withBusy(busyText, task); }
    catch (error) { toast(error.message, true); }
  };
}

releaseStudio = createReleaseStudio({$, $$, api, callAction, requireContext, renderInline, resultDetails, startWrite, guard, toast, desktop});
communityStudio = createCommunityStudio({$, $$, callAction, requireContext, getContext: currentContext, gameName: () => state.names.game, renderInline, resultDetails, startWrite, guard, toast, desktop, friendlyError});
gameDetailStudio = createGameDetailStudio({$, callAction, requireContext, getContext: currentContext, gameName: () => state.names.game, developerName: () => state.names.developer, toast, friendlyError});

$('#contextForm').addEventListener('submit', guard(async () => {
  const devId = $('#devId').value.trim();
  const appId = $('#appId').value.trim();
  await saveContext({devId, appId}, {developer: '手动选择', game: `游戏 ${appId}`});
  toast('工作空间已切换');
}, '正在保存工作空间…'));
$('#createNext').addEventListener('click', nextCreateStep);
$('#createBack').addEventListener('click', () => setCreateStep(createStep - 1));
$('#createForm').addEventListener('submit', guard(previewCreateGame, '正在生成新游戏创建预览…'));
$('#createPackage').addEventListener('change', () => {
  $('#packageNote').textContent = $('#createPackage').value === 'h5' ? 'H5 游戏主要在个人主页曝光，后续继续上传包体并完善资料。' : '';
});
$('#operationsReport').addEventListener('click', async event => {
  event.preventDefault();
  const button = $('#operationsReport');
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = '正在读取官方数据…';
  try { await operationsReport(); }
  catch (error) {
    renderInline('#reportResult', {title: '经营分析未能完成', message: error.message, type: 'error'});
    toast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = '生成经营分析';
  }
});
$('#loadReviews').addEventListener('click', guard(loadReviews, '正在读取玩家评价…'));
$('#refreshRuns').addEventListener('click', guard(loadRuns, '正在刷新记录…'));
$('#actionSelect').addEventListener('change', updateActionForm);
$('#runAction').addEventListener('click', guard(async () => {
  const action = actionById($('#actionSelect').value);
  const input = {action: action.id, context: currentContext(), data: parseJsonField('#actionData'), file: $('#actionFile').value.trim(), service: $('#schemaService').value.trim(), method: $('#schemaMethod').value.trim()};
  const run = await callAction(input);
  renderRaw(run);
  if (run.status === 'awaiting_confirmation') openConfirmation(run, '#actionResult');
}, '正在运行官方动作…'));
$('#copyResult').addEventListener('click', async () => {
  if (!state.lastResult) return toast('暂无原始返回');
  await navigator.clipboard.writeText(JSON.stringify(state.lastResult.result, null, 2)); toast('已复制');
});
$('#accountButton').addEventListener('click', () => {
  updateAccountDialog();
  $('#accountDialog').showModal();
});
$('#closeAccount').addEventListener('click', () => $('#accountDialog').close());
$('#logoutButton').addEventListener('click', guard(() => logoutConnection(false), '正在安全退出 TapTap…'));
$('#switchAccountButton').addEventListener('click', guard(() => logoutConnection(true), '正在清除旧连接并准备切换账号…'));
for (const [id, action] of [['windowMinimize', 'minimize'], ['windowMaximize', 'maximize'], ['windowClose', 'close']]) {
  $(`#${id}`).addEventListener('click', () => desktop?.window(action));
}
$('#chooseActionFile').addEventListener('click', guard(async () => {
  const id = actionById($('#actionSelect').value)?.id || '';
  const kind = id.includes('Image') || id === 'upload.image' ? 'image' : id === 'upload.video' ? 'video' : 'package';
  const file = await desktop?.pickFile(kind);
  if (file) $('#actionFile').value = file;
}, '正在选择文件…'));
$('#chooseWorkspace').addEventListener('click', guard(async () => {
  await desktop?.chooseWorkspace();
}, '正在保存游戏项目文件夹，应用将重新启动…'));
$('#cancelConfirm').addEventListener('click', () => { $('#confirmDialog').close(); state.preview = null; state.previewOptions = null; });
$('#confirmForm').addEventListener('submit', guard(async () => {
  if (!state.preview) return;
  const preview = state.preview;
  const target = state.previewTarget;
  const options = state.previewOptions || {};
  $('#confirmDialog').close();
  const run = await api(`/api/runs/${preview.id}/execute`, {method: 'POST', body: JSON.stringify({confirmation: $('#confirmationText').value})});
  if (preview.action === 'app.create') await showCreatedGame(run);
  else if (target === '#actionResult') renderRaw(run);
  else renderInline(target, {title: run.result?.ok ? '单次执行已返回' : '执行未确认成功', message: run.result?.ok ? '请核对官方实际返回；结果不明时不要重复执行。' : friendlyError(run), type: run.result?.ok ? 'success' : 'error', run});
  state.preview = null; state.previewOptions = null;
  if (options.onExecuted) await options.onExecuted(run);
  toast(run.result?.ok ? '执行结果已保存到执行记录' : '执行未确认成功，请查看记录', !run.result?.ok);
}, '正在执行已确认的动作…'));

$$('[data-days]').forEach(button => button.addEventListener('click', () => {
  $$('[data-days]').forEach(el => el.classList.toggle('active', el === button));
  const custom = button.dataset.days === 'custom';
  $('#customDates').classList.toggle('hidden', !custom);
  state.days = button.dataset.days;
  if (!custom) setDateRange(Number(state.days));
}));

function setDateRange(days) {
  const end = new Date();
  const start = new Date(); start.setDate(end.getDate() - days + 1);
  const local = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  $('#reportStart').value = local(start); $('#reportEnd').value = local(end);
}

async function init() {
  try {
    const savedNames = JSON.parse(localStorage.getItem('taptap-ops-names') || '{}');
    state.names = {developer: savedNames.developer || '', game: savedNames.game || ''};
    const [{actions}, saved] = await Promise.all([api('/api/catalog'), api('/api/state')]);
    state.catalog = actions;
    state.context = {devId: saved.devId || '', appId: saved.appId || ''};
    $('#devId').value = state.context.devId; $('#appId').value = state.context.appId;
    const groups = new Map();
    for (const action of actions) {
      if (!groups.has(action.group)) {
        const group = document.createElement('optgroup'); group.label = action.group; groups.set(action.group, group); $('#actionSelect').append(group);
      }
      const option = document.createElement('option'); option.value = action.id; option.textContent = action.label; groups.get(action.group).append(option);
    }
    $('#actionSelect').value = 'app.status'; updateActionForm(); setDateRange(7); updateCurrentGame(); communityStudio.reset(); gameDetailStudio.reset();
    if (desktop) $('#workspacePath').textContent = await desktop.workspace();
    checkConnection();
  } catch (error) {
    $('#setupContent').innerHTML = '';
    renderInline('#setupContent', {title: '工作台初始化失败', message: error.message, type: 'error'});
  }
}
init();
