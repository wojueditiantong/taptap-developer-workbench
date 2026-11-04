import {BrowserWindow, WebContentsView, dialog, shell} from 'electron';
import path from 'node:path';
import {OFFICIAL_EDITOR_URL, isOfficialEditorDocument, officialEditorNeedsLoad, officialEditorUrl, weChatAuthorizationUrl} from '../lib/official-editor-url.mjs';
import {officialDraftDrawer, officialDraftDrawerVisible, officialDraftsProbeSource, officialDraftsSnapshotSource, officialEditDraftSource} from '../lib/official-drafts.mjs';
import {loadOfficialEditorDocument} from '../lib/official-editor-navigation.mjs';

export {OFFICIAL_EDITOR_URL, officialEditorUrl};

function officialPage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /(^|\.)taptap\.(cn|com)$/.test(url.hostname);
  } catch { return false; }
}

function bounds(value) {
  if (!value || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]))) throw new Error('编辑器区域无效');
  if (value.width < 200 || value.height < 240) throw new Error('编辑器区域太小，无法安全显示');
  return Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Math.max(0, Math.floor(value[key]))]));
}

export function createOfficialEditor({partition, smokeTest, toolRoot}) {
  let window;
  let view;
  let visible = false;
  let loadedUrl = '';
  let lastBounds;
  let generation = 0;
  let oauthWindow;
  let oauthRequestedUrl = '';
  let oauthGeneration = 0;

  function attach(target) { window = target; }

  async function openOAuth(value) {
    const target = weChatAuthorizationUrl(value);
    if (!target || !window || window.isDestroyed()) return false;
    const ticket = ++oauthGeneration;
    if (oauthWindow && !oauthWindow.isDestroyed()) oauthWindow.destroy();
    oauthRequestedUrl = target;
    const child = new BrowserWindow({
      width: 560, height: 760, minWidth: 420, minHeight: 560,
      parent: window, title: '微信登录 TapTap', show: false,
      autoHideMenuBar: true, backgroundColor: '#ffffff',
      webPreferences: {partition, contextIsolation: true, nodeIntegration: false, sandbox: true},
    });
    oauthWindow = child;
    child.once('ready-to-show', () => { if (!child.isDestroyed()) child.show(); });
    child.webContents.setWindowOpenHandler(({url}) => {
      if (officialPage(url) || weChatAuthorizationUrl(url)) void child.webContents.loadURL(url).catch(() => {});
      return {action: 'deny'};
    });
    child.webContents.on('will-navigate', (event, url) => {
      if (!officialPage(url) && !weChatAuthorizationUrl(url)) event.preventDefault();
    });
    child.on('closed', () => {
      if (ticket !== oauthGeneration) return;
      oauthWindow = null;
      oauthRequestedUrl = '';
      if (view && !view.webContents.isDestroyed()) view.webContents.reload();
    });
    try {
      if (smokeTest) await child.webContents.loadFile(path.join(toolRoot, 'public', 'official-oauth-smoke.html'));
      else await child.webContents.loadURL(target);
      return true;
    } catch {
      if (!child.isDestroyed()) dialog.showErrorBox('微信授权页面加载失败', '请检查网络后关闭此窗口，再点击微信图标重试。');
      return false;
    }
  }

  function createView() {
    const child = new WebContentsView({webPreferences: {partition, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false}});
    child.webContents.setWindowOpenHandler(({url}) => {
      if (officialPage(url)) void child.webContents.loadURL(url).catch(() => {});
      else if (weChatAuthorizationUrl(url)) void openOAuth(url);
      else if (/^https:\/\//.test(url)) void shell.openExternal(url).catch(() => {});
      return {action: 'deny'};
    });
    child.webContents.on('will-navigate', (event, url) => {
      if (officialPage(url)) return;
      event.preventDefault();
      if (weChatAuthorizationUrl(url)) void openOAuth(url);
    });
    child.setBackgroundColor('#ffffff');
    return child;
  }

  async function ensureView(target = OFFICIAL_EDITOR_URL) {
    if (!window || window.isDestroyed()) throw new Error('桌面窗口尚未准备好');
    target = officialEditorUrl(target);
    if (!view || view.webContents.isDestroyed()) {
      view = createView();
      loadedUrl = '';
    }
    const actualUrl = view.webContents.getURL();
    if (officialEditorNeedsLoad({target, loadedUrl, actualUrl, smokeTest})) {
      if (smokeTest) await view.webContents.loadFile(path.join(toolRoot, 'public', 'official-editor-smoke.html'));
      else await loadOfficialEditorDocument({contents: view.webContents, target, officialPage});
      loadedUrl = target;
    }
    return view;
  }

  async function show({url = OFFICIAL_EDITOR_URL, bounds: nextBounds} = {}) {
    const target = officialEditorUrl(url);
    lastBounds = bounds(nextBounds || lastBounds);
    const ticket = ++generation;
    visible = true;
    const child = await ensureView(target);
    child.setBounds(lastBounds);
    if (ticket !== generation || !visible) return {ok: false, status: 'superseded'};
    if (!window.contentView.children.includes(child)) window.contentView.addChildView(child);
    const authenticationRequired = !smokeTest && !isOfficialEditorDocument(child.webContents.getURL());
    return {ok: true, status: authenticationRequired ? 'authentication-required' : 'ready', embedded: true};
  }

  function hide() {
    generation += 1;
    visible = false;
    if (view && window && !window.isDestroyed() && window.contentView.children.includes(view)) window.contentView.removeChildView(view);
    return {ok: true};
  }

  function throwDraftError(status) {
    if (status === 'changed') throw new Error('官方草稿列表已变化，请刷新后再选择');
    if (status === 'structure') throw new Error('官方草稿列表结构已变化，暂时无法安全读取。请刷新重试');
    if (status === 'not-opened') throw new Error('已选择草稿，但官方编辑器尚未打开。请稍后重试');
    if (status === 'authentication-required') throw new Error('需要先登录 TapTap 网页账号。已打开官方登录页，登录后请回到草稿箱刷新');
    if (status === 'missing-button') {
      const onEditor = smokeTest || isOfficialEditorDocument(view.webContents.getURL());
      throw new Error(onEditor ? '官方帖子编辑器仍在加载，请稍后重试草稿箱' : '官方页面没有进入帖子编辑器。若页面要求登录，请先登录，再重试草稿箱');
    }
    if (status === 'not-visible') throw new Error('已点击官方草稿箱，但内容尚未显示。请检查网络后重试');
    throw new Error('暂时无法读取官方草稿，请检查网络后重试');
  }

  async function readDrafts() {
    const child = await ensureView(OFFICIAL_EDITOR_URL);
    if (!smokeTest && !isOfficialEditorDocument(child.webContents.getURL())) return {ok: false, error: 'authentication-required'};
    const result = await child.webContents.executeJavaScript(officialDraftsSnapshotSource());
    if (!result?.ok) throwDraftError(result?.error);
    return result;
  }

  async function editDraft(input = {}) {
    if (!Number.isInteger(input.index) || input.index < 0 || input.index > 999) throw new Error('草稿序号无效，请刷新列表后重试');
    if (typeof input.fingerprint !== 'string' || !input.fingerprint || input.fingerprint.length > 12000) throw new Error('草稿核对信息无效，请刷新列表后重试');
    const child = await ensureView(OFFICIAL_EDITOR_URL);
    if (!smokeTest && !isOfficialEditorDocument(child.webContents.getURL())) throwDraftError('authentication-required');
    const result = await child.webContents.executeJavaScript(officialEditDraftSource({index: input.index, fingerprint: input.fingerprint}));
    if (!result?.ok) throwDraftError(result?.error);
    return result;
  }

  async function openDrafts() {
    if (!view || !visible || view.webContents.isDestroyed()) throw new Error('请先打开官方帖子编辑器');
    const ready = await show({url: OFFICIAL_EDITOR_URL, bounds: lastBounds});
    if (!ready.ok) throw new Error('官方编辑器正在切换，请重试草稿箱');
    const opened = await view.webContents.executeJavaScript(officialDraftsProbeSource());
    if (opened !== 'opened') throwDraftError(opened);
    return {ok: true, opened: true};
  }

  async function reload() {
    if (!view || !visible || view.webContents.isDestroyed()) throw new Error('请先打开官方帖子编辑器');
    const target = loadedUrl || OFFICIAL_EDITOR_URL;
    if (officialEditorNeedsLoad({target, loadedUrl, actualUrl: view.webContents.getURL(), smokeTest})) return show({url: target, bounds: lastBounds});
    view.webContents.reload();
    return {ok: true};
  }

  function destroy() {
    hide();
    oauthGeneration += 1;
    if (oauthWindow && !oauthWindow.isDestroyed()) oauthWindow.destroy();
    oauthWindow = null;
    oauthRequestedUrl = '';
    if (view && !view.webContents.isDestroyed()) view.webContents.close();
    view = null;
    loadedUrl = '';
    lastBounds = null;
  }

  async function inspect() {
    const drawerState = smokeTest ? "document.body.dataset.draftOpen==='true'" : `Boolean((${officialDraftDrawerVisible.toString()})(document))`;
    const drawerVisibleSource = smokeTest ? drawerState : `(()=>{const officialDraftDrawer=${officialDraftDrawer.toString()};return ${drawerState}})()`;
    const draftBoxOpen = Boolean(view && !view.webContents.isDestroyed() && await view.webContents.executeJavaScript(`Boolean(${drawerVisibleSource})`).catch(() => false));
    const editorTitle = smokeTest && view && !view.webContents.isDestroyed() ? await view.webContents.executeJavaScript("document.querySelector('#editorTitle')?.value||''").catch(() => '') : '';
    return {
      visible, attached: Boolean(view && window && !window.isDestroyed() && window.contentView.children.includes(view)),
      url: view?.webContents.getURL() || '', requestedUrl: loadedUrl, bounds: view?.getBounds() || null, draftBoxOpen, editorTitle,
      oauthVisible: Boolean(oauthWindow && !oauthWindow.isDestroyed() && oauthWindow.isVisible()),
      oauthUrl: oauthWindow && !oauthWindow.isDestroyed() ? oauthWindow.webContents.getURL() : '', oauthRequestedUrl,
    };
  }

  return {
    attach, show, hide, openDrafts, readDrafts, editDraft, reload, destroy, inspect,
    setBounds: value => {lastBounds = bounds(value); if (view && visible) view.setBounds(lastBounds); return {ok: true};},
    ...(smokeTest ? {openOAuthForTest: () => {
      if (!view || view.webContents.isDestroyed()) throw new Error('请先打开官方帖子编辑器');
      return view.webContents.executeJavaScript("window.open('https://open.weixin.qq.com/connect/qrconnect?appid=smoke')");
    }} : {}),
  };
}
