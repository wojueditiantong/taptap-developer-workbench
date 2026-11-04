import {app, BrowserWindow, ipcMain, dialog, shell, session} from 'electron';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {stageCommunityMedia} from '../lib/media-staging.mjs';
import {createCliRunner} from '../lib/cli.mjs';
import {createStore} from '../lib/store.mjs';
import {createRunService} from '../lib/run-service.mjs';
import {publicCatalog} from '../lib/actions.mjs';
import {createAuthService} from '../lib/auth-service.mjs';
import {createDesktopApi} from './api.mjs';
import {smokeData} from './smoke-data.mjs';
import {createOfficialEditor} from './official-editor.mjs';

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const smokeTest = process.argv.includes('--smoke-test');
const portableRoot = app.isPackaged ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath)) : toolRoot;
const smokeOutput = smokeTest && process.env.TAPTAP_SMOKE_OUTPUT ? path.resolve(process.env.TAPTAP_SMOKE_OUTPUT) : '';
const dataRoot = smokeOutput || (smokeTest ? path.join(portableRoot, 'output', 'taptap-ops', 'desktop-validation') : path.join(portableRoot, 'output', 'taptap-ops'));
const settingsFile = path.join(dataRoot, 'desktop-settings.json');
if (smokeTest) {
  // Functional UI validation is not a GPU benchmark. Keep its cache inside the
  // disposable validation folder and avoid host graphics/cache dependencies.
  app.disableHardwareAcceleration();
  app.setPath('userData', path.join(dataRoot, 'electron-profile'));
}
let workspaceRoot = portableRoot;
let mainWindow;
let authWindow;
const authPartition = 'persist:taptap-authorization';
const officialEditor = createOfficialEditor({partition: authPartition, smokeTest, toolRoot});

async function readSettings() {
  try {
    const value = JSON.parse(await readFile(settingsFile, 'utf8'));
    if (typeof value.workspaceRoot === 'string' && path.isAbsolute(value.workspaceRoot)) workspaceRoot = value.workspaceRoot;
  } catch { /* First launch uses the project folder. */ }
}

function cliEntry() {
  const entry = path.join(app.getAppPath(), 'node_modules', '@taptap', 'cli', 'bin', 'taptap-cli-windows-amd64.exe');
  return app.isPackaged ? entry.replace('app.asar', 'app.asar.unpacked') : entry;
}

async function smokeCli(args) {
  if (args[0] === 'auth' && args[1] === 'logout') return {ok: true, data: null};
  if (args[0] === 'auth' && args[1] === 'status') return {ok: true, data: {authenticated: true, account: '桌面验收账号'}};
  if (args[0] === 'developer') return {ok: true, data: {list: [{developer_id: 10001, name: '示例开发者'}]}};
  if (args[0] === 'app' && args[1] === '+list') return {ok: true, data: {list: [{app_id: 20001, title: '示例游戏', page_url: 'https://developer.taptap.cn/v3/10001/app/20001/store/update', page_url_source: 'derived_from_developer_scope', review_status_label: '已上线'}]}};
  const data = smokeData(args);
  if (data) return data;
  return {ok: true, data: {smokeTest: true, result: {list: []}}};
}

function openSafePage(url, authorization = false) {
  let target;
  try { target = new URL(url); } catch { throw new Error('无法识别页面地址'); }
  if (target.protocol !== 'https:' || !/(^|\.)taptap\.(cn|com)$/.test(target.hostname)) throw new Error('只允许打开 TapTap 官方页面');
  if (authorization && target.hostname !== 'accounts.taptap.cn') throw new Error('授权地址不属于 TapTap 官方账号服务');
  if (smokeTest && !authorization) return true;
  if (authWindow && !authWindow.isDestroyed()) authWindow.close();
  authWindow = new BrowserWindow({
    width: 1040, height: 800, minWidth: 720, minHeight: 600,
    parent: mainWindow, title: authorization ? 'TapTap 官方账号授权' : 'TapTap 官方页面',
    autoHideMenuBar: true, backgroundColor: '#f5f8fc',
    webPreferences: {partition: authPartition, contextIsolation: true, nodeIntegration: false, sandbox: true},
  });
  authWindow.webContents.setWindowOpenHandler(({url: childUrl}) => {
    if (/^https:\/\//.test(childUrl)) shell.openExternal(childUrl);
    return {action: 'deny'};
  });
  authWindow.on('closed', () => { authWindow = null; });
  authWindow.loadURL(target.toString());
  return true;
}

async function clearAuthorizationSession() {
  if (authWindow && !authWindow.isDestroyed()) authWindow.close();
  officialEditor.destroy();
  const loginSession = session.fromPartition(authPartition);
  await loginSession.clearStorageData();
  await loginSession.clearCache();
  await loginSession.clearAuthCache();
}

async function pickFile(kind) {
  const mediaKind = kind.replace(/^community-/, '');
  const filters = mediaKind === 'image'
    ? [{name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif']}]
    : mediaKind === 'video'
      ? [{name: '视频', extensions: ['mp4', 'mov']}]
      : [{name: '游戏包体', extensions: ['apk', 'zip']}];
  const isCommunityMedia = kind.startsWith('community-');
  const result = await dialog.showOpenDialog(mainWindow, {title: isCommunityMedia ? '选择本机图片或视频（仅复制到上传暂存区）' : '选择当前项目中的文件', defaultPath: workspaceRoot, properties: ['openFile'], filters});
  if (result.canceled || !result.filePaths[0]) return null;
  const selected = path.resolve(result.filePaths[0]);
  if (isCommunityMedia) return stageCommunityMedia({workspaceRoot, selected});
  const relative = path.relative(workspaceRoot, selected);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('请选择当前游戏项目文件夹内的文件');
  return relative;
}

function registerHandlers({api, store}) {
  ipcMain.handle('taptap:request', (_event, pathname, options) => api(pathname, options));
  ipcMain.handle('taptap:open-auth', (_event, url) => openSafePage(url, true));
  ipcMain.handle('taptap:open-external', (_event, url) => openSafePage(url));
  ipcMain.handle('taptap:official-editor', (event, input) => {
    if (event.sender !== mainWindow.webContents) throw new Error('编辑器请求必须来自主窗口');
    const actions = {show: () => officialEditor.show(input), hide: () => officialEditor.hide(), bounds: () => officialEditor.setBounds(input.bounds), drafts: () => officialEditor.openDrafts(), 'list-drafts': () => officialEditor.readDrafts(), 'edit-draft': () => officialEditor.editDraft(input), reload: () => officialEditor.reload()};
    if (!Object.hasOwn(actions, input?.action)) throw new Error('不支持的编辑器动作');
    return actions[input.action]();
  });
  ipcMain.handle('taptap:open-report', async (_event, pathname) => {
    const match = pathname.match(/^\/api\/reports\/(report-[a-z0-9-]+)\/(markdown|data)$/);
    if (!match) throw new Error('报告地址无效');
    const [, id, kind] = match;
    // Validate access through the same local API, but let the reader render the
    // structured report as an actual document instead of a raw Markdown <pre>.
    const report = await api(`/api/reports/${id}/data`);
    const reportWindow = new BrowserWindow({width: 1160, height: 860, parent: mainWindow, title: 'TapTap 经营分析报告', autoHideMenuBar: true, backgroundColor: '#eef4f7', webPreferences: {preload: path.join(toolRoot, 'desktop', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true}});
    reportWindow.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    if (kind === 'markdown' && JSON.parse(report.content).kind === 'operations') {
      await reportWindow.loadFile(path.join(toolRoot, 'public', 'report-viewer.html'), {query: {report: id}});
    } else {
      const content = JSON.stringify(JSON.parse(report.content), null, 2);
      const escapeHtml = text => text.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
      const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>TapTap 官方原始数据</title><body style="margin:0;background:#f5f8fc"><main style="max-width:1000px;margin:30px auto;padding:34px;background:white;border-radius:16px"><pre style="white-space:pre-wrap;font:14px/1.8 'Microsoft YaHei',sans-serif;color:#24364b">${escapeHtml(content)}</pre></main></body></html>`;
      await reportWindow.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
    }
    return true;
  });
  ipcMain.handle('taptap:pick-file', (_event, kind) => pickFile(kind));
  ipcMain.handle('taptap:workspace', () => workspaceRoot);
  ipcMain.handle('taptap:choose-workspace', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {title: '选择游戏项目文件夹', defaultPath: workspaceRoot, properties: ['openDirectory']});
    if (result.canceled || !result.filePaths[0]) return workspaceRoot;
    workspaceRoot = result.filePaths[0];
    await mkdir(dataRoot, {recursive: true});
    await writeFile(settingsFile, JSON.stringify({workspaceRoot}, null, 2));
    app.relaunch();
    app.exit(0);
    return workspaceRoot;
  });
  ipcMain.handle('taptap:window', (event, action) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (action === 'minimize') window.minimize();
    if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    if (action === 'close') window.close();
  });
  return {clearAuthorizationSession, store};
}

async function runSmokeTest(window) {
  const pause = (ms = 180) => new Promise(resolve => setTimeout(resolve, ms));
  const execute = async script => {
    try { return await window.webContents.executeJavaScript(script); }
    catch (error) {
      const feedback = await window.webContents.executeJavaScript("({view:document.querySelector('.view.active')?.id,toast:document.querySelector('#toast').textContent,error:window.__smokeError||''})").catch(() => ({}));
      throw new Error(`${error.message}；步骤：${script.slice(0, 180)}；界面：${JSON.stringify(feedback)}`);
    }
  };
  const waitFor = async selector => {
    try {
      await execute(`new Promise((resolve,reject)=>{const started=Date.now();const timer=setInterval(()=>{if(document.querySelector(${JSON.stringify(selector)})){clearInterval(timer);resolve(true)}else if(Date.now()-started>15000){clearInterval(timer);reject(new Error('等待界面超时：${selector}'))}},50)})`);
    } catch (error) {
      const feedback = await execute("document.querySelector('#toast').textContent + ' | ' + document.querySelector('#reportResult').innerText");
      throw new Error(`${error.message}；界面反馈：${feedback}`);
    }
  };
  const capture = async name => {
    await pause(500);
    await execute("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    const screenshot = path.join(dataRoot, name);
    // Capture the composed native window, including WebContentsView children.
    const {desktopCapturer} = await import('electron');
    const handle = window.getNativeWindowHandle().readBigUInt64LE(0).toString();
    const [width, height] = window.getContentSize();
    const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width, height}, fetchWindowIcons: false});
    const source = sources.find(candidate => candidate.id.startsWith(`window:${handle}:`));
    if (!source || source.thumbnail.isEmpty()) throw new Error(`无法捕获桌面原生窗口：${window.getTitle()} / ${handle}`);
    await writeFile(screenshot, source.thumbnail.toPNG());
    return screenshot;
  };
  await pause(700);
  await mkdir(dataRoot, {recursive: true});
  await execute("document.querySelector('#accountButton').click()");
  await pause();
  const accountScreenshot = await capture('desktop-account.png');
  await execute("document.querySelector('#closeAccount').click();document.querySelector('#setupContent .button.primary, #setupContent .selected-game .button').click()");
  await waitFor('#setupContent .entity-card');
  await execute("document.querySelector('#setupContent .entity-card').click()");
  await waitFor('#setupContent .entity-card');
  await execute("document.querySelector('#setupContent .entity-card').click()");
  await pause();

  await execute("document.querySelector('.nav-item[data-go=\"game-detail\"]').click()");
  await waitFor('#gameDetailContent .game-detail-hero');
  await waitFor('#busyOverlay.hidden');
  const gameDetail = await execute(`({
    view:document.querySelector('.view.active')?.id,
    title:document.querySelector('#gameDetailTitle').textContent,
    category:document.querySelector('#gameDetailSubtitle').textContent,
    platforms:[...document.querySelectorAll('.detail-platform-row')].map(row=>row.innerText),
    versions:[...document.querySelectorAll('.detail-version-row')].map(row=>row.innerText),
    screenshots:document.querySelectorAll('#gameDetailContent .game-detail-shot').length,
    developerUrl:document.querySelector('#gameDetailContent .game-detail-source a')?.href,
    note:document.querySelector('#gameDetailContent .game-detail-source').innerText,
    overflow:document.documentElement.scrollWidth>innerWidth
  })`);
  const gameDetailScreenshot = await capture('desktop-game-detail.png');
  if (gameDetail.view !== 'game-detail' || gameDetail.title !== '脱敏示例游戏' || !gameDetail.category.includes('角色扮演') || gameDetail.platforms.length !== 2 || !gameDetail.platforms.some(value=>value.includes('敬请期待')) || gameDetail.versions.length !== 2 || !gameDetail.versions.some(value=>value.includes('已上线')) || gameDetail.screenshots !== 2 || !gameDetail.developerUrl?.startsWith('https://developer.taptap.cn/') || !gameDetail.note.includes('官方接口没有返回玩家商店详情页地址') || gameDetail.overflow) throw new Error('游戏详情界面验收未通过：'+JSON.stringify(gameDetail));

  await execute("document.querySelector('.nav-item[data-go=\"operations\"]').click();document.querySelector('#operationsReport').click()");
  await waitFor('#reportResult .kpi-grid');
  await waitFor('#busyOverlay.hidden');
  await pause(300);
  const weekly = await execute(`(async()=>{
    const {runs}=await window.taptapDesktop.request('/api/runs');
    const dates=runs.filter(run=>run.action==='stats.metric').map(run=>run.input?.data?.start_date).filter(Boolean).sort();
    const previousStart=dates[0];
    return {
      kpis:[...document.querySelectorAll('#reportResult .kpi-card strong')].map(el=>el.textContent),
      charts:document.querySelectorAll('#reportResult svg').length,
      sources:document.querySelectorAll('#reportResult .source-row').length,
      reviews:document.querySelectorAll('#reportResult .weekly-review').length,
      decisions:document.querySelectorAll('#reportResult .decision-card').length,
      comparison:document.querySelector('#reportResult .kpi-card.visits .comparison-note')?.textContent,
      reference:document.querySelector('#reportResult .reference-value strong')?.textContent,
      previousCalls:runs.filter(run=>run.action==='stats.metric'&&run.input?.data?.start_date===previousStart).length,
      warning:document.querySelector('#reportResult .data-warning')?.textContent,
      overflow:document.documentElement.scrollWidth>innerWidth
    }
  })()`);
  const weeklyScreenshot = await capture('desktop-analysis.png');
  if (weekly.kpis.length !== 5 || weekly.charts !== 3 || weekly.sources < 1 || weekly.reviews !== 1 || weekly.decisions < 2 || !weekly.comparison?.includes('+25.0%') || !weekly.reference || weekly.previousCalls !== 4 || !weekly.warning?.includes('论坛趋势') || weekly.overflow) {
    console.error(JSON.stringify({weeklyFailure:weekly}));
    throw new Error('经营分析界面验收未通过：'+JSON.stringify(weekly));
  }
  await execute("document.querySelector('#reportResult .trend-grid').scrollIntoView({block:'center'})");
  const weeklyChartsScreenshot = await capture('desktop-analysis-charts.png');

  await execute("document.querySelector('#reportResult .report-links a[href$=\"/markdown\"]').click()");
  await waitFor('#busyOverlay.hidden');
  const reader = BrowserWindow.getAllWindows().find(candidate => candidate !== window && candidate.webContents.getURL().includes('report-viewer.html'));
  if (!reader) throw new Error('经营分析没有在应用内阅读器中打开');
  const reportReader = await reader.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const started=Date.now();const timer=setInterval(()=>{if(document.querySelector('#reportDocument .kpi-grid')){clearInterval(timer);resolve({kpis:document.querySelectorAll('#reportDocument .kpi-card').length,charts:document.querySelectorAll('#reportDocument svg').length,decisions:document.querySelectorAll('#reportDocument .decision-card').length,printEnabled:!document.querySelector('#printReport').disabled,rawPre:document.querySelectorAll('#reportDocument pre').length,overflow:document.documentElement.scrollWidth>innerWidth})}else if(Date.now()-started>15000){clearInterval(timer);reject(new Error('报告阅读器加载超时：'+document.querySelector('#reportDocument').innerText))}},50)})`);
  reader.close();
  if (reportReader.kpis !== 5 || reportReader.charts !== 3 || reportReader.decisions < 2 || !reportReader.printEnabled || reportReader.rawPre || reportReader.overflow) throw new Error('图文报告阅读器验收未通过');

  const realReport = await execute(`(async()=>{const listing=await window.taptapDesktop.request('/api/reports');const id=listing.reports.map(name=>name.replace(/\.json$/,'')).sort().reverse()[0];if(!id)throw new Error('没有找到本次脱敏经营报告');const response=await window.taptapDesktop.request('/api/reports/'+id+'/data');return JSON.parse(response.content)})()`);
  const realReportRender = await execute(`(async()=>{const {renderOperationsReport}=await import('./report-view.js');const target=document.createElement('div');document.body.append(target);renderOperationsReport(target,${JSON.stringify(realReport)});const result={kpis:target.querySelectorAll('.kpi-card').length,charts:target.querySelectorAll('svg').length,sources:target.querySelectorAll('.source-row').length,reviews:target.querySelectorAll('.weekly-review').length,warning:target.querySelector('.data-warning')?.textContent||'',visits:target.querySelector('.kpi-card.visits strong')?.textContent,error:target.querySelector('.report-load-error')?.textContent||''};target.remove();return result})()`);
  if (realReportRender.kpis !== 5 || realReportRender.charts !== 3 || realReportRender.sources < 1 || realReportRender.reviews !== 1 || realReportRender.visits !== '8,640' || !realReportRender.warning.includes('论坛趋势') || realReportRender.error) throw new Error('完整脱敏经营报告前端渲染回归未通过：'+JSON.stringify(realReportRender));
  const forumChartRender = await execute(`(async()=>{const {renderOperationsReport}=await import('./report-view.js');const report=${JSON.stringify(realReport)};report.entries=report.entries.filter(entry=>entry.action!=='stats.forum');report.entries.push({action:'stats.forum',label:'论坛快照验收样例',result:{ok:true,data:{result:{follow_total:'128',content_total:'256',results:[{type:'content_create',columns:[{key:'count'}],summary:{count:7}},{type:'comment_create',columns:[{key:'count'}],summary:{count:9}}]}}}});const target=document.createElement('div');renderOperationsReport(target,report);return {charts:target.querySelectorAll('svg').length,forum:target.querySelector('.trend-card:last-child .forum-note')?.textContent||''}})()`);
  if (forumChartRender.charts !== 3 || !forumChartRender.forum.includes('128') || !forumChartRender.forum.includes('256')) throw new Error('论坛快照图表分支验收未通过：'+JSON.stringify(forumChartRender));

  await execute("document.querySelector('.nav-item[data-go=\"community\"]').click()");
  await waitFor('#community.active');
  await waitFor('#busyOverlay.hidden');
  let officialInitial = await officialEditor.inspect();
  for (let attempt = 0; attempt < 100 && !officialInitial.attached; attempt += 1) { await pause(100); officialInitial = await officialEditor.inspect(); }
  const officialEditorScreenshot = await capture('desktop-official-editor.png');
  const officialOptionsDeferred = await execute("document.querySelector('#postIdentity').disabled && !document.querySelector('#communityAssistant').open");
  if (!officialInitial.visible || !officialInitial.attached || !officialInitial.url.includes('official-editor-smoke.html') || !officialOptionsDeferred) throw new Error('官方编辑器嵌入验收未通过：'+JSON.stringify({officialInitial, officialOptionsDeferred}));

  await execute("document.querySelector('#accountButton').click()");
  await waitFor('#accountDialog[open]');
  let officialModal = await officialEditor.inspect();
  for (let attempt = 0; attempt < 100 && officialModal.attached; attempt += 1) { await pause(100); officialModal = await officialEditor.inspect(); }
  if (officialModal.visible || officialModal.attached) throw new Error('账号弹窗被官方编辑器遮挡');
  await execute("document.querySelector('#closeAccount').click()");
  let officialDialogRestored = await officialEditor.inspect();
  for (let attempt = 0; attempt < 100 && !officialDialogRestored.attached; attempt += 1) { await pause(100); officialDialogRestored = await officialEditor.inspect(); }
  if (!officialDialogRestored.attached) throw new Error('关闭账号弹窗后官方编辑器未恢复');

  await execute("document.querySelector('[data-community-view=\"drafts\"]').click()");
  await waitFor('#draftsList .draft-card');
  await waitFor('#busyOverlay.hidden');
  const draftListInitial = await execute(`({
    cards:document.querySelectorAll('#draftsList .draft-card').length,
    summary:document.querySelector('#draftsSummary').textContent,
    detail:document.querySelector('#draftDetailTitle').textContent,
    nativeDeleteControls:document.querySelectorAll('#communityDrafts .draft-item__delete').length,
    listVisible:!document.querySelector('#communityDrafts').classList.contains('hidden'),
    overflow:document.documentElement.scrollWidth>innerWidth
  })`);
  const officialDrafts = await officialEditor.inspect();
  const officialDraftsScreenshot = await capture('desktop-official-drafts.png');
  if (draftListInitial.cards !== 3 || draftListInitial.detail !== '示例草稿一' || draftListInitial.nativeDeleteControls || !draftListInitial.listVisible || draftListInitial.overflow || officialDrafts.attached || officialDrafts.visible || officialDrafts.draftBoxOpen) throw new Error('原生草稿列表验收未通过：'+JSON.stringify({draftListInitial, officialDrafts}));
  await execute("document.querySelector('#refreshDrafts').click()");
  const draftRefresh = await execute("({cards:document.querySelectorAll('#draftsList .draft-card').length,title:document.querySelector('#draftDetailTitle').textContent,summary:document.querySelector('#draftsSummary').textContent})");
  for (let attempt = 0; attempt < 100 && await execute("document.querySelector('#refreshDrafts').disabled"); attempt += 1) await pause(50);
  if (draftRefresh.cards !== 3 || draftRefresh.title !== '示例草稿一') throw new Error('刷新时草稿内容被清空：'+JSON.stringify(draftRefresh));
  await execute("document.querySelector('#draftSearch').value='综合讨论';document.querySelector('#draftSearch').dispatchEvent(new Event('input'))");
  const draftSearch = await execute("({cards:document.querySelectorAll('#draftsList .draft-card').length,title:document.querySelector('#draftDetailTitle').textContent,summary:document.querySelector('#draftDetailSummary').textContent,selected:document.querySelectorAll('#draftsList .draft-card.selected').length})");
  const officialDraftDetailScreenshot = await capture('desktop-official-draft-detail.png');
  if (draftSearch.cards !== 1 || draftSearch.selected !== 1 || draftSearch.title !== '示例草稿二' || !draftSearch.summary.includes('没有正文摘要')) throw new Error('草稿搜索与摘要详情验收未通过：'+JSON.stringify(draftSearch));
  await execute("document.querySelector('#editOfficialDraft').click()");
  await waitFor('#communityCompose:not(.hidden)');
  let officialDraftEditing = await officialEditor.inspect();
  for (let attempt = 0; attempt < 100 && (!officialDraftEditing.attached || officialDraftEditing.editorTitle !== '示例草稿二'); attempt += 1) { await pause(100); officialDraftEditing = await officialEditor.inspect(); }
  if (!officialDraftEditing.attached || officialDraftEditing.editorTitle !== '示例草稿二' || officialDraftEditing.draftBoxOpen) throw new Error('继续编辑没有打开所选草稿：'+JSON.stringify(officialDraftEditing));
  await execute("document.querySelector('[data-community-view=\"manage\"]').click()");
  await waitFor('#busyOverlay.hidden');
  const officialHidden = await officialEditor.inspect();
  if (officialHidden.visible || officialHidden.attached) throw new Error('离开官方编辑器后原生页面仍遮挡界面');
  await execute("document.querySelector('[data-community-view=\"drafts\"]').click()");
  await waitFor('#busyOverlay.hidden');
  const draftStatePreserved = await execute("({query:document.querySelector('#draftSearch').value,cards:document.querySelectorAll('#draftsList .draft-card').length,title:document.querySelector('#draftDetailTitle').textContent})");
  if (draftStatePreserved.query !== '综合讨论' || draftStatePreserved.cards !== 1 || draftStatePreserved.title !== '示例草稿二') throw new Error('草稿箱切页状态未保留：'+JSON.stringify(draftStatePreserved));
  await execute("document.querySelector('[data-community-view=\"compose\"]').click()");
  await waitFor('#busyOverlay.hidden');
  let officialRestored = await officialEditor.inspect();
  for (let attempt = 0; attempt < 100 && !officialRestored.attached; attempt += 1) { await pause(100); officialRestored = await officialEditor.inspect(); }
  if (!officialRestored.attached || officialRestored.url !== officialInitial.url || officialRestored.editorTitle !== '示例草稿二' || officialRestored.draftBoxOpen) throw new Error('切换页面后官方编辑器状态未保留：'+JSON.stringify(officialRestored));
  const official = {initial: officialInitial, modal: officialModal, dialogRestored: officialDialogRestored, drafts: officialDrafts, draftListInitial, draftRefresh, draftSearch, draftEditing: officialDraftEditing, draftStatePreserved, hidden: officialHidden, restored: officialRestored};

  await officialEditor.openOAuthForTest();
  let officialOAuthOpened = await officialEditor.inspect();
  for (let attempt = 0; attempt < 100 && (!officialOAuthOpened.oauthVisible || !officialOAuthOpened.oauthUrl.includes('official-oauth-smoke.html')); attempt += 1) { await pause(100); officialOAuthOpened = await officialEditor.inspect(); }
  const officialOAuthWindow = BrowserWindow.getAllWindows().find(candidate => candidate !== window && candidate.getTitle() === '微信登录 TapTap');
  const officialOAuthContent = officialOAuthWindow ? await officialOAuthWindow.webContents.executeJavaScript("document.body.innerText.includes('隔离模拟页面')") : false;
  if (!officialOAuthWindow || !officialOAuthOpened.oauthVisible || officialOAuthOpened.oauthRequestedUrl !== 'https://open.weixin.qq.com/connect/qrconnect?appid=smoke' || !officialOAuthContent) throw new Error('微信授权没有在应用内打开：'+JSON.stringify(officialOAuthOpened));
  officialOAuthWindow.close();
  let officialOAuthClosed = await officialEditor.inspect();
  for (let attempt = 0; attempt < 100 && officialOAuthClosed.oauthVisible; attempt += 1) { await pause(100); officialOAuthClosed = await officialEditor.inspect(); }
  if (officialOAuthClosed.oauthVisible || officialOAuthClosed.oauthUrl || !officialOAuthClosed.attached) throw new Error('微信授权窗口关闭后未恢复社区编辑器：'+JSON.stringify(officialOAuthClosed));
  const officialOAuth = {opened: officialOAuthOpened, closed: officialOAuthClosed};

  await execute("document.querySelector('#communityAssistant').open=true;document.querySelector('#communityAssistant').dispatchEvent(new Event('toggle'))");
  await waitFor('#postGroup option[value="40001"]');
  await waitFor('#busyOverlay.hidden');
  const templateResults = [];
  let templateScreenshot = null;
  const templateSpecs = [
    {id: 'version', expected: '0.5.0', values: {version: '0.5.0', changes: '新增地图筛选\n优化加载速度', known: '旧设备适配仍在排查'}},
    {id: 'recruit', expected: '限量测试', values: {testName: '限量测试', testTime: '11 月 12 日开测', requirements: 'Android 12 及以上\n预留 4 GB 空间', signup: '填写详情页招募问卷', notes: '本次测试删档'}},
    {id: 'launch', expected: '正式上线', values: {launchTime: '11 月 15 日 10:00', platforms: 'Android、Windows', features: '第一章完整剧情\n手柄操作', download: '前往游戏详情页下载', notes: '请预留存储空间'}},
  ];
  for (const spec of templateSpecs) {
    await execute("document.querySelector('#openPostTemplates').click()");
    await waitFor('#postTemplateDialog[open]');
    const templateCount = await execute("document.querySelectorAll('#postTemplateChoices [data-template]').length");
    await execute(`document.querySelector('[data-template="${spec.id}"]').click()`);
    await waitFor('#postTemplateFields');
    await execute(`(()=>{for(const [key,value] of Object.entries(${JSON.stringify(spec.values)})){const field=document.querySelector('#postTemplate_'+key);field.value=value;field.dispatchEvent(new Event('input'))}document.querySelector('#postTemplateReplace').checked=${templateResults.length > 0}})()`);
    if (spec.id === 'version') { await pause(180); templateScreenshot = await capture('desktop-post-template.png'); }
    await execute("document.querySelector('#applyPostTemplate').click()");
    const result = await execute("({title:document.querySelector('#postTitle').value,body:document.querySelector('#postBody').value})");
    if (templateCount !== 3 || !result.title.includes(spec.expected) || !result.body.includes('### ')) throw new Error(`帖子模板 ${spec.id} 验收未通过`);
    templateResults.push({id: spec.id, title: result.title, length: result.body.length});
  }
  await execute(`(()=>{for(const [selector,value] of [['#postTitle','脱敏版本公告（仅预览）'],['#postBody','本次更新包含三项玩家可感知的改进。'],['#postGroup','40001']]){const field=document.querySelector(selector);field.value=value;field.dispatchEvent(new Event(field.tagName==='SELECT'?'change':'input'))}document.querySelector('[data-post-format="list"]').click()})()`);
  const livePreview = await execute("({title:document.querySelector('#previewTitle').textContent,body:document.querySelector('#previewBody').textContent,lists:document.querySelectorAll('#previewBody ul').length,destination:document.querySelector('#previewDestination').textContent})");
  if (livePreview.title !== '脱敏版本公告（仅预览）' || !livePreview.body.includes('本次更新包含三项玩家可感知的改进。') || livePreview.lists < 1 || !livePreview.destination.includes('开发日志')) throw new Error('辅助编辑器实时预览未同步：'+JSON.stringify(livePreview));
  const publishLocked = await execute("document.querySelector('#publishPost').disabled && document.querySelector('#postPublishPanel').classList.contains('hidden')");
  await execute("document.querySelector('#postMediaFile').value='demo-post.png';document.querySelector('#uploadPostMedia').click()");
  await waitFor('#confirmDialog[open]');
  await waitFor('#busyOverlay.hidden');
  const postMediaPreview = await execute("document.querySelector('#confirmSummary').textContent");
  await execute("document.querySelector('#confirmationText').value='确认上传社区配图';document.querySelector('#confirmForm').dispatchEvent(new Event('submit',{cancelable:true}))");
  await waitFor('#postAssets .post-asset-card');
  await waitFor('#busyOverlay.hidden');
  await execute("document.querySelector('#postMediaFile').value='demo-post.mp4';document.querySelector('#uploadPostMedia').click()");
  await waitFor('#confirmDialog[open]');
  await waitFor('#busyOverlay.hidden');
  const postVideoPreview = await execute("document.querySelector('#confirmSummary').textContent");
  await execute("document.querySelector('#confirmationText').value='确认上传社区视频';document.querySelector('#confirmForm').dispatchEvent(new Event('submit',{cancelable:true}))");
  await waitFor('#postAssets .post-asset-card:nth-child(2)');
  await waitFor('#busyOverlay.hidden');
  const postAssets = await execute("document.querySelectorAll('#postAssets .post-asset-card').length");
  await execute("document.querySelector('#createPostDraft').click()");
  await waitFor('#confirmDialog[open]');
  await waitFor('#busyOverlay.hidden');
  const postDraftPreview = await execute("document.querySelector('#confirmSummary').textContent");
  await execute("document.querySelector('#confirmationText').value='确认保存社区帖子草稿';document.querySelector('#confirmForm').dispatchEvent(new Event('submit',{cancelable:true}))");
  await waitFor('#postDraftPreview');
  await waitFor('#busyOverlay.hidden');
  await execute("document.querySelector('#postDraftPreview').click()");
  await waitFor('#busyOverlay.hidden');
  let officialSavedPreview = await officialEditor.inspect();
  for (let attempt = 0; attempt < 100 && !officialSavedPreview.requestedUrl?.includes('draft_id=60001'); attempt += 1) { await pause(100); officialSavedPreview = await officialEditor.inspect(); }
  if (!officialSavedPreview.attached || !officialSavedPreview.requestedUrl?.includes('draft_id=60001')) throw new Error('保存后的官方草稿未在应用内预览：'+JSON.stringify(officialSavedPreview));
  await execute("document.querySelector('#postReviewed').checked=true;document.querySelector('#postReviewed').dispatchEvent(new Event('change'))");
  const publishReady = await execute("!document.querySelector('#publishPost').disabled");
  await execute("document.querySelector('#postPublishPanel').scrollIntoView({block:'center'})");
  await pause(250);
  const communityScreenshot = await capture('desktop-community-compose.png');
  await execute("document.querySelector('#publishPost').click()");
  await waitFor('#confirmDialog[open]');
  await waitFor('#busyOverlay.hidden');
  const postPublishPreview = await execute("document.querySelector('#confirmSummary').textContent");
  const publishDocument = await execute(`(async()=>{const {runs}=await window.taptapDesktop.request('/api/runs');const preview=runs.find(run=>run.action==='community.publishDraft'&&run.mode==='preview');return {document:!!preview?.input?.data?.document,bindings:preview?.input?.data?.document?.forum_bindings?.length,nodes:JSON.parse(preview?.input?.data?.document?.contents||'[]').map(node=>node.type),status:preview?.status}})()`);
  await execute("document.querySelector('#cancelConfirm').click();document.querySelector('#postBody').value+='（修改后必须重新保存）';document.querySelector('#postBody').dispatchEvent(new Event('input'))");
  const publishLockedAfterEdit = await execute("document.querySelector('#publishPost').disabled && document.querySelector('#postPublishPanel').classList.contains('hidden')");
  await execute("document.querySelector('[data-community-view=\"manage\"]').click()");
  await waitFor('#momentsList .moment-card');
  await waitFor('#busyOverlay.hidden');
  const moments = await execute("document.querySelectorAll('#momentsList .moment-card').length");
  const communityManageScreenshot = await capture('desktop-community-manage.png');
  await execute("document.querySelector('#momentsList .moment-card .button').click()");
  await waitFor('#momentDialog[open]');
  await waitFor('#busyOverlay.hidden');
  const momentDetail = await execute("document.querySelector('#momentDetail').innerText");
  await execute("document.querySelector('#closeMoment').click()");
  await execute("document.querySelector('[data-go=\"home\"]').click();document.querySelector('#appId').value='20002';document.querySelector('#contextForm').dispatchEvent(new Event('submit',{cancelable:true}))");
  await waitFor('#busyOverlay.hidden');
  const communityReset = await execute("!document.querySelector('#postTitle').value && !document.querySelector('#postBody').value && !document.querySelectorAll('#postAssets .post-asset-card').length && document.querySelector('#postIdentity').disabled");
  const gameDetailReset = await execute("document.querySelector('#gameDetailTitle').textContent==='游戏 20002' && !document.querySelector('#gameDetailContent .game-detail-hero') && !document.querySelector('#gameDetailContent').textContent.includes('脱敏示例游戏')");
  const reportReset = await execute("document.querySelector('#reportResult').textContent.includes('为当前游戏生成经营分析') && !document.querySelector('#reportResult .kpi-grid')");
  if (!postMediaPreview.includes('确认上传社区配图') || !postVideoPreview.includes('确认上传社区视频') || !postDraftPreview.includes('确认保存社区帖子草稿') || !postDraftPreview.includes('开发日志') || !postPublishPreview.includes('确认发布已预览社区草稿') || !publishLocked || !publishReady || !publishLockedAfterEdit || postAssets !== 2 || !publishDocument.document || publishDocument.bindings !== 1 || !publishDocument.nodes.includes('image') || !publishDocument.nodes.includes('video') || publishDocument.status !== 'awaiting_confirmation' || moments !== 2 || !momentDetail.includes('[b]更新内容[/b]') || !communityReset || !gameDetailReset || !reportReset) {
    console.error(JSON.stringify({communityFailure: {postMediaPreview, postVideoPreview, postDraftPreview, postPublishPreview, publishLocked, publishReady, publishLockedAfterEdit, postAssets, publishDocument, moments, momentDetail, communityReset, gameDetailReset, reportReset}}));
    throw new Error('社区发帖与内容管理界面验收未通过');
  }

  await execute("document.querySelector('.nav-item[data-go=\"release\"]').click();document.querySelector('#releaseCheck').click()");
  await waitFor('#releaseCheckResult .release-conclusion');
  await waitFor('#busyOverlay.hidden');
  const release = await execute(`(()=>({
    conclusion:document.querySelector('#releaseCheckResult .release-conclusion h3')?.textContent,
    todos:document.querySelectorAll('#releaseCheckResult .release-todo').length,
    taskLinks:document.querySelectorAll('#releaseCheckResult .release-todo .button').length
  }))()`);
  const releaseScreenshot = await capture('desktop-release-overview.png');
  if (!release.conclusion || !release.todos || release.todos !== release.taskLinks) throw new Error('发布体检未形成可读待办');

  await execute("document.querySelector('[data-release-step=\"profile\"]').click();document.querySelector('#profileModule').value='assets-upload';document.querySelector('#loadProfileModule').click()");
  await waitFor('#profileWorkspace .media-field');
  await waitFor('#busyOverlay.hidden');
  const mediaFields = await execute("document.querySelectorAll('#profileWorkspace .media-field').length");
  if (mediaFields !== 4) throw new Error('图片与视频动态表单不完整');
  await execute("document.querySelector('#profileWorkspace .media-field input').value='demo-icon.png';document.querySelector('#profileWorkspace .media-field .button.primary').click()");
  await waitFor('#confirmDialog[open]');
  await waitFor('#busyOverlay.hidden');
  const mediaPreview = await execute("document.querySelector('#confirmSummary').textContent");
  await execute("document.querySelector('#cancelConfirm').click()");
  const profileScreenshot = await capture('desktop-release-profile.png');

  await execute("document.querySelector('[data-release-step=\"package\"]').click();document.querySelector('#loadPackages').click()");
  await waitFor('#packageBindings .binding-card');
  await waitFor('#busyOverlay.hidden');
  await execute("document.querySelector('#packageBindings .binding-card select').value='main';document.querySelector('#packageBindings .binding-card .binding-controls .button.primary').click()");
  await waitFor('#confirmDialog[open]');
  await waitFor('#busyOverlay.hidden');
  const packagePreview = await execute("document.querySelector('#confirmSummary').textContent");
  await execute("document.querySelector('#cancelConfirm').click()");

  await execute("document.querySelector('[data-release-step=\"distribution\"]').click();document.querySelector('#loadDistribution').click()");
  await waitFor('#distributionWorkspace .distribution-field');
  await waitFor('#busyOverlay.hidden');
  await execute("document.querySelector('#distributionWorkspace [data-field-id]').value='4';document.querySelector('#distributionWorkspace>.button.primary').click()");
  await waitFor('#confirmDialog[open]');
  await waitFor('#busyOverlay.hidden');
  const distributionPreview = await execute("document.querySelector('#confirmSummary').textContent");
  await execute("document.querySelector('#cancelConfirm').click()");

  await execute("document.querySelector('[data-release-step=\"review\"]').click();document.querySelector('#reviewSnapshot').click()");
  await waitFor('#reviewResult .review-evidence');
  await waitFor('#busyOverlay.hidden');
  await execute("document.querySelector('#reviewPrecheck').click()");
  await waitFor('#reviewResult .result-card.success');
  await waitFor('#busyOverlay.hidden');
  await execute("document.querySelector('#reviewSubmit').click()");
  await waitFor('#confirmDialog[open]');
  await waitFor('#busyOverlay.hidden');
  const reviewPreview = await execute("document.querySelector('#confirmSummary').textContent");
  await execute("document.querySelector('#cancelConfirm').click()");

  await execute("document.querySelector('[data-release-step=\"versions\"]').click();document.querySelector('#loadVersions').click()");
  await waitFor('#versionsResult .version-card');
  await waitFor('#busyOverlay.hidden');
  const versionActions = await execute("document.querySelector('#versionsResult').innerText");
  if (!versionActions.includes('修改定时') || !versionActions.includes('撤销定时上线')) throw new Error('版本生命周期操作未整合');
  if (!mediaPreview.includes('确认上传商店图片') || !packagePreview.includes('确认绑定草稿包体') || !distributionPreview.includes('保存 1 个字段') || !distributionPreview.includes('Android 下载') || distributionPreview.includes('Windows 下载。') || !reviewPreview.includes('确认正式提交审核')) throw new Error('发布写入预览未通过');

  await execute("document.querySelector('[data-task=\"create\"]').click()");
  await waitFor('#busyOverlay.hidden');
  for (const [selector, value] of [['#createRole', 'developer'], ['#createTitle', '桌面验收游戏（未创建）'], ['#createCategory', 'rpg'], ['#createPackage', 'apk']]) {
    await execute(`(()=>{const field=document.querySelector('${selector}');field.value=${JSON.stringify(value)};field.dispatchEvent(new Event('change'));document.querySelector('#createNext').click()})()`);
    await pause(80);
  }
  const createSummary = await execute("document.querySelector('#createSummary').textContent");
  const createFormScreenshot = await capture('desktop-create-form.png');
  await execute("document.querySelector('#createPreview').click()");
  await waitFor('#confirmDialog[open]');
  await waitFor('#busyOverlay.hidden');
  const confirmation = await execute("document.querySelector('#confirmSummary').textContent");
  const createScreenshot = await capture('desktop-create.png');
  await execute("document.querySelector('#cancelConfirm').click()");
  const result = await execute(`(async()=>{
    const before=await window.taptapDesktop.request('/api/auth');
    const logout=await window.taptapDesktop.request('/api/auth/logout',{method:'POST'});
    const state=await window.taptapDesktop.request('/api/state');
    return {before,logout,state,title:document.title,desktop:!!window.taptapDesktop,overflow:document.documentElement.scrollWidth>innerWidth};
  })()`);
  const officialAfterLogout = await officialEditor.inspect();
  await writeFile(path.join(dataRoot, 'smoke-result.json'), JSON.stringify({
    ...result, weekly, reportReader, realReportRender, forumChartRender,
    official, officialOAuth, officialSavedPreview, officialAfterLogout, livePreview,
    gameDetail, gameDetailReset, release, mediaFields, templateResults, reportReset,
    community: {postAssets, publishLocked, publishReady, publishLockedAfterEdit, publishDocument, moments, momentDetail, communityReset, previews: {image: postMediaPreview, video: postVideoPreview, draft: postDraftPreview, publish: postPublishPreview}},
    previews: {media: mediaPreview, package: packagePreview, distribution: distributionPreview, review: reviewPreview},
    versionActions, createSummary, confirmation,
    screenshots: {account: accountScreenshot, gameDetail: gameDetailScreenshot, weekly: weeklyScreenshot, weeklyCharts: weeklyChartsScreenshot, officialEditor: officialEditorScreenshot, officialDrafts: officialDraftsScreenshot, officialDraftDetail: officialDraftDetailScreenshot, template: templateScreenshot, community: communityScreenshot, communityManage: communityManageScreenshot, release: releaseScreenshot, profile: profileScreenshot, createForm: createFormScreenshot, create: createScreenshot},
  }, null, 2));
  if (!result.desktop || result.logout.status !== 'idle' || result.state.devId || result.overflow || !createSummary.includes('桌面验收游戏（未创建）') || !confirmation.includes('确认创建游戏草稿') || officialAfterLogout.visible || officialAfterLogout.attached || officialAfterLogout.url || officialAfterLogout.requestedUrl || officialAfterLogout.oauthVisible || officialAfterLogout.oauthUrl) throw new Error('桌面验收未通过');
  console.log(`桌面验收通过：${weeklyScreenshot}；${createScreenshot}`);
  app.quit();
}

app.whenReady().then(async () => {
  await readSettings();
  const runCli = smokeTest ? smokeCli : createCliRunner({cliPath: cliEntry(), cwd: workspaceRoot, native: true});
  const store = createStore(dataRoot);
  const runService = createRunService({store, runCli, root: workspaceRoot});
  const service = {...runService, catalog: () => ({actions: publicCatalog()})};
  const auth = createAuthService({runCli});
  const api = createDesktopApi({auth, store, service, clearAuthorizationSession});
  registerHandlers({api, store});
  mainWindow = new BrowserWindow({
    width: 1440, height: 940, minWidth: 1060, minHeight: 720,
    show: false, frame: false, backgroundColor: '#f5f8fc',
    title: 'TapTap 开发者工作台',
    icon: path.join(toolRoot, 'build', 'icon.png'),
    webPreferences: {preload: path.join(toolRoot, 'desktop', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true},
  });
  officialEditor.attach(mainWindow);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({url}) => {
    if (url.startsWith('/api/reports/')) return {action: 'allow'};
    openSafePage(url);
    return {action: 'deny'};
  });
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  await mainWindow.loadFile(path.join(toolRoot, 'public', 'index.html'));
  if (smokeTest) await runSmokeTest(mainWindow).catch(async error => {
    console.error(error);
    await mkdir(dataRoot, {recursive: true});
    await writeFile(path.join(dataRoot, 'smoke-failure.json'), JSON.stringify({message: error.message, stack: error.stack}, null, 2));
    app.exit(1);
  });
}).catch(error => {
  console.error(error);
  dialog.showErrorBox('TapTap 工作台启动失败', error.message);
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  officialEditor.destroy();
  if (authWindow && !authWindow.isDestroyed()) authWindow.close();
});
