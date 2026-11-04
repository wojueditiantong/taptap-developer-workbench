import {extractGameDetail} from './game-detail.mjs';

function node(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== '') element.textContent = text;
  return element;
}

export function createGameDetailStudio({$, callAction, requireContext, getContext, gameName, developerName, toast, friendlyError}) {
  let generation = 0;
  let loadedKey = '';
  const contextKey = () => `${getContext().devId}/${getContext().appId}`;

  function reset() {
    generation += 1;
    loadedKey = '';
    $('#gameDetailContent').replaceChildren(node('div', 'empty-state compact', '进入游戏详情后，读取当前游戏的真实资料、素材和版本。'));
    $('#gameDetailTitle').textContent = getContext().appId ? (gameName() || `游戏 ${getContext().appId}`) : '尚未选择游戏';
    $('#gameDetailSubtitle').textContent = getContext().appId ? `游戏 ID ${getContext().appId} · ${developerName() || '当前开发者'}` : '请先连接账号并选择游戏';
    $('#gameDetailStatus').className = 'pill neutral hidden';
    $('#gameDetailSourceNote').textContent = '只读汇总，不会修改游戏资料或发布状态。';
    $('#refreshGameDetail').disabled = false;
  }

  function image(url, alt, className = '') {
    const frame = node('div', `detail-image-frame ${className}`);
    const img = node('img');
    img.src = url;
    img.alt = alt;
    img.loading = 'lazy';
    img.addEventListener('error', () => { img.remove(); frame.append(node('span', '', '图片暂时无法加载')); }, {once: true});
    frame.append(img);
    return frame;
  }

  function section(title, description, className = '') {
    const panel = node('article', `panel detail-section ${className}`);
    const header = node('div', 'section-heading');
    const copy = node('div');
    copy.append(node('h3', '', title));
    if (description) copy.append(node('p', 'subheading', description));
    header.append(copy);
    panel.append(header);
    return panel;
  }

  function render(detail, failures) {
    const target = $('#gameDetailContent');
    target.replaceChildren();
    $('#gameDetailTitle').textContent = detail.title || gameName() || `游戏 ${getContext().appId}`;
    $('#gameDetailSubtitle').textContent = `${detail.category !== '未填写' ? `${detail.category} · ` : ''}游戏 ID ${getContext().appId} · ${developerName() || '当前开发者'}`;
    $('#gameDetailStatus').textContent = detail.reviewStatus ? `官方列表：${detail.reviewStatus}` : '开发者资料预览';
    $('#gameDetailStatus').className = 'pill neutral';

    const hero = node('article', 'game-detail-hero');
    const visual = node('div', 'game-detail-visual');
    if (detail.cover) visual.append(image(detail.cover, `${detail.title || '当前游戏'}宣传素材`, 'game-detail-cover'));
    else visual.append(node('div', 'game-detail-cover-placeholder', '官方素材未提供宣传图'));
    const identity = node('div', 'game-detail-identity');
    if (detail.icon) identity.append(image(detail.icon, `${detail.title || '当前游戏'}图标`, 'game-detail-icon'));
    else identity.append(node('span', 'game-avatar', '游'));
    const copy = node('div', 'game-detail-copy');
    copy.append(node('p', 'eyebrow', 'GAME PROFILE'), node('h3', '', detail.title || gameName() || `游戏 ${getContext().appId}`));
    copy.append(node('p', 'game-detail-description', detail.description || '官方基础资料暂未提供游戏简介。'));
    const facts = node('div', 'game-detail-facts');
    facts.append(node('span', '', `游戏 ID ${getContext().appId}`), node('span', '', `类型：${detail.category}`), node('span', '', `版本记录：${detail.versionTotal} 条`));
    copy.append(facts);
    identity.append(copy);
    hero.append(visual, identity);
    target.append(hero);

    if (failures.length) {
      const warning = node('details', 'detail-read-warning');
      warning.append(node('summary', '', `${failures.length} 项资料未能读取，其他内容仍按官方返回展示`));
      for (const failure of failures) warning.append(node('p', '', `${failure.label}：${failure.message}`));
      target.append(warning);
    }

    const grid = node('div', 'game-detail-grid');
    const platformPanel = section('平台与下载状态', '这里显示官方当前值；“版本上线”不等于“开放下载”。');
    if (detail.platforms.length) {
      const list = node('div', 'detail-platform-list');
      for (const platform of detail.platforms) {
        const row = node('div', 'detail-platform-row');
        row.append(node('span', '', platform.label), node('strong', '', platform.value));
        list.append(row);
      }
      platformPanel.append(list);
    } else platformPanel.append(node('div', 'empty-note', '平台状态未读取，不能据此判断是否开放下载。'));
    grid.append(platformPanel);

    const versionsPanel = section('版本记录', `官方列表共 ${detail.versionTotal} 条，草稿与线上版本分别标明。`);
    if (detail.versions.length) {
      const list = node('div', 'detail-version-list');
      for (const version of detail.versions) {
        const row = node('div', 'detail-version-row');
        const versionCopy = node('div');
        versionCopy.append(node('strong', '', version.name), node('small', '', version.time ? new Date(Number(version.time) * 1000).toLocaleString('zh-CN') : '时间未提供'));
        row.append(versionCopy, node('span', `detail-version-status ${version.statusCode}`, version.status));
        list.append(row);
      }
      versionsPanel.append(list);
    } else versionsPanel.append(node('div', 'empty-note', '没有读到版本记录，不把空白当成“已上线”。'));
    grid.append(versionsPanel);
    target.append(grid);

    const mediaPanel = section('游戏图标与宣传素材', `官方已提供 ${detail.screenshots.length} 张游戏截图、${detail.banners.length} 张宣传图。图片仅在应用内展示，不会上传或修改。`);
    const gallery = node('div', 'game-detail-gallery');
    for (const [index, url] of detail.screenshots.entries()) {
      const figure = node('figure', 'game-detail-shot');
      figure.append(image(url, `${detail.title || '游戏'}截图 ${index + 1}`), node('figcaption', '', `游戏截图 ${index + 1}`));
      gallery.append(figure);
    }
    if (gallery.childElementCount) mediaPanel.append(gallery);
    else mediaPanel.append(node('div', 'empty-note', '没有读到可展示的游戏截图。'));
    if (detail.videos.length) {
      const videoList = node('div', 'detail-video-list');
      for (const video of detail.videos) videoList.append(node('p', '', `${video.label}：官方已填写素材编号 ${video.reference}；当前读取结果未提供播放地址。`));
      mediaPanel.append(videoList);
    }
    target.append(mediaPanel);

    const source = node('div', 'game-detail-source');
    source.append(node('p', '', '以上是开发者后台的真实资料预览，不代表玩家端实际排版。官方接口没有返回玩家商店详情页地址，因此这里不提供猜测链接。'));
    if (detail.developerPageUrl) {
      const link = node('a', 'button secondary', '打开官方资料后台 ↗');
      link.href = detail.developerPageUrl;
      link.target = '_blank';
      link.rel = 'noreferrer';
      source.append(link);
    }
    target.append(source);
  }

  async function load() {
    const context = requireContext();
    const key = contextKey();
    const ticket = ++generation;
    $('#refreshGameDetail').disabled = true;
    $('#gameDetailTitle').textContent = gameName() || `游戏 ${context.appId}`;
    $('#gameDetailSubtitle').textContent = `游戏 ID ${context.appId} · ${developerName() || '当前开发者'}`;
    $('#gameDetailStatus').className = 'pill neutral hidden';
    $('#gameDetailContent').innerHTML = '<div class="detail-loading"><span class="spinner"></span><h3>正在整理游戏详情</h3><p>读取基础资料、宣传素材、平台状态与版本记录，不会写入任何内容。</p></div>';
    const sources = [
      ['basic', '基础资料', 'app.module.basic'],
      ['assets', '图片与视频', 'app.module.assets'],
      ['platform', '平台与下载状态', 'app.module.platform'],
      ['versions', '版本记录', 'app.versions'],
      ['apps', '官方资料后台地址', 'app.list'],
    ];
    const results = await Promise.all(sources.map(async ([id, label, action]) => {
      try {
        const run = await callAction({action, context, data: {}});
        if (!run.result?.ok) throw new Error(friendlyError(run));
        return {id, label, result: run.result};
      } catch (error) { return {id, label, error: error.message}; }
    }));
    if (ticket !== generation || key !== contextKey()) return;
    $('#refreshGameDetail').disabled = false;
    const entries = Object.fromEntries(results.filter(result => result.result).map(result => [result.id, result.result]));
    const failures = results.filter(result => result.error).map(({label, error}) => ({label, message: error}));
    if (!Object.keys(entries).length) {
      $('#gameDetailContent').replaceChildren();
      const empty = node('div', 'detail-load-failed');
      empty.append(node('h3', '', '游戏详情暂时未能读取'), node('p', '', failures.map(failure => `${failure.label}：${failure.message}`).join('\n')));
      $('#gameDetailContent').append(empty);
      throw new Error('游戏详情读取失败，请检查连接后重试');
    }
    const detail = extractGameDetail({...entries, appId: context.appId});
    loadedKey = key;
    render(detail, failures);
    $('#gameDetailSourceNote').textContent = `已从官方接口读取 ${Object.keys(entries).length} / ${sources.length} 项资料 · ${new Date().toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'})}`;
    toast(failures.length ? '游戏详情已显示，部分资料未能读取' : '游戏详情已更新');
  }

  $('#refreshGameDetail').addEventListener('click', () => load().catch(error => toast(error.message, true)));
  reset();
  return {reset, activate: () => loadedKey === contextKey() ? Promise.resolve() : load(), reload: load};
}
