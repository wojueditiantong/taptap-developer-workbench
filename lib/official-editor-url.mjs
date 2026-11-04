export const OFFICIAL_EDITOR_URL = 'https://www.taptap.cn/moment-editor';

export function isOfficialEditorDocument(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && url.hostname === 'www.taptap.cn' && url.pathname === '/moment-editor';
  } catch { return false; }
}

export function officialEditorNeedsLoad({target, loadedUrl, actualUrl, smokeTest = false}) {
  return loadedUrl !== target || (!smokeTest && !isOfficialEditorDocument(actualUrl));
}

export function officialEditorUrl(value = OFFICIAL_EDITOR_URL) {
  let url;
  try { url = new URL(String(value || OFFICIAL_EDITOR_URL)); }
  catch { throw new Error('只允许打开 TapTap 官方帖子编辑器'); }
  if (url.protocol !== 'https:' || url.hostname !== 'www.taptap.cn' || url.pathname !== '/moment-editor') throw new Error('只允许打开 TapTap 官方帖子编辑器');
  for (const [key, parameter] of url.searchParams) {
    if (key !== 'draft_id' || !/^[1-9][0-9]*$/.test(parameter)) throw new Error('草稿地址包含无效参数');
  }
  if (url.hash) throw new Error('草稿地址包含无效片段');
  return url.toString();
}

export function weChatAuthorizationUrl(value) {
  try {
    const url = new URL(String(value));
    const allowedPath = ['/connect/qrconnect', '/connect/oauth2/authorize'].includes(url.pathname);
    if (url.protocol !== 'https:' || url.hostname !== 'open.weixin.qq.com' || !allowedPath || url.username || url.password) return '';
    return url.toString();
  } catch { return ''; }
}
