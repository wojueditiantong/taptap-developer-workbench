export function officialDraftDrawer(document) {
  return [...document.querySelectorAll('[role="dialog"], .moment-editor-draft-drawer, .right-drawer-scaffold')].find(element => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && /草稿箱/.test(element.textContent || '');
  }) || null;
}

export function officialDraftDrawerVisible(document) {
  return Boolean(officialDraftDrawer(document));
}

export function officialDraftItems(document, providedDrawer) {
  const drawer = providedDrawer || officialDraftDrawer(document);
  if (!drawer) return [];
  const text = element => (element?.textContent || '').trim().replace(/\s+/g, ' ');
  return [...drawer.querySelectorAll('div.draft-item[role="button"]')].map((item, index) => {
    const summaryElement = item.querySelector('.draft-item__summary');
    const summary = summaryElement?.classList.contains('draft-item__summary--placeholder') ? '' : text(summaryElement);
    const image = item.querySelector('.draft-item__compact-media img');
    const source = image?.getAttribute?.('src') || image?.src || '';
    const title = text(item.querySelector('.draft-item__title-content'));
    const forum = text(item.querySelector('.draft-item__meta'));
    const modified = text(item.querySelector('.draft-item__time .tap-time') || item.querySelector('.draft-item__time'));
    return {
      index,
      title,
      summary: summary === '暂无正文' ? '' : summary,
      forum,
      modified,
      cover: /^https:\/\//.test(source) ? source : '',
      fingerprint: JSON.stringify([title, summary === '暂无正文' ? '' : summary, forum, modified]),
    };
  });
}

async function probeOfficialDrafts(findDrawer, {buttonTimeout = 15000, drawerTimeout = 8000} = {}) {
  const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const drawerVisible = () => Boolean(findDrawer(document));
  const findButton = () => document.querySelector('.moment-editor-header-actions__draft-entry') || [...document.querySelectorAll('button')].find(element => element.textContent.trim() === '草稿箱');
  const waitFor = async (check, timeout) => {
    const started = Date.now();
    while (!check()) {
      if (Date.now() - started >= timeout) return false;
      await pause(30);
    }
    return true;
  };
  if (drawerVisible()) return 'opened';
  if (!await waitFor(findButton, buttonTimeout)) return 'missing-button';
  findButton().click();
  return await waitFor(drawerVisible, drawerTimeout) ? 'opened' : 'not-visible';
}

async function snapshotOfficialDrafts(findDrawer, extractItems, probe, options) {
  const opened = await probe(findDrawer, options);
  if (opened !== 'opened') return {ok: false, error: opened};
  const drawer = findDrawer(document);
  const items = extractItems(document, drawer);
  const match = (drawer?.textContent || '').match(/草稿箱\s*[（(]\s*(\d+)\s*[)）]/);
  const declared = match ? Number(match[1]) : null;
  const close = () => {
    if (options.close === false) return;
    const button = drawer?.querySelector('.right-drawer-scaffold__close') || document.querySelector('.right-drawer-scaffold__close');
    button?.click();
  };
  if (declared > 0 && !items.length) {
    close();
    return {ok: false, error: 'structure'};
  }
  const result = {
    ok: true,
    items,
    total: declared ?? items.length,
    partial: declared !== null && declared > items.length,
    readAt: new Date().toISOString(),
  };
  close();
  return result;
}

async function editOfficialDraft(findDrawer, extractItems, probe, input, options) {
  const opened = await probe(findDrawer, options);
  if (opened !== 'opened') return {ok: false, error: opened};
  const items = extractItems(document, findDrawer(document));
  const expected = items[input.index];
  if (!expected || expected.fingerprint !== input.fingerprint) return {ok: false, error: 'changed'};
  const target = findDrawer(document)?.querySelectorAll('div.draft-item[role="button"]')[input.index];
  if (!target) return {ok: false, error: 'changed'};
  target.click();
  const started = Date.now();
  while (findDrawer(document) && !/[?&]draft_id=\d+/.test(location.href)) {
    if (Date.now() - started >= (options.editorTimeout || 8000)) return {ok: false, error: 'not-opened'};
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  return {ok: true, title: expected.title};
}

export function officialDraftsProbeSource(options = {}) {
  return `(${probeOfficialDrafts.toString()})(${officialDraftDrawer.toString()},${JSON.stringify(options)})`;
}

export function officialDraftsSnapshotSource(options = {}) {
  return `(${snapshotOfficialDrafts.toString()})(${officialDraftDrawer.toString()},${officialDraftItems.toString()},${probeOfficialDrafts.toString()},${JSON.stringify(options)})`;
}

export function officialEditDraftSource(input, options = {}) {
  return `(${editOfficialDraft.toString()})(${officialDraftDrawer.toString()},${officialDraftItems.toString()},${probeOfficialDrafts.toString()},${JSON.stringify(input)},${JSON.stringify(options)})`;
}
