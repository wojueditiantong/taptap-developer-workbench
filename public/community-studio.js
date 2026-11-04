import {payload, communityPublishOptions, textBlocks, imageAsset, videoAsset, buildCommunityDocument, postContentSignature} from './community-document.mjs';
import {POST_TEMPLATES, createPostContent} from './post-templates.mjs';

function node(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== '') element.textContent = text;
  return element;
}
function button(text, className = 'button secondary') { return node('button', className, text); }
function time(value) { return value ? new Date(Number(value) * 1000).toLocaleString() : '时间未提供'; }
function safeUrl(value) { return /^https:\/\//.test(value || '') ? value : ''; }

export function createCommunityStudio(deps) {
  const {$, $$, callAction, requireContext, getContext, gameName, renderInline, resultDetails, startWrite, guard, toast, desktop, friendlyError} = deps;
  const OFFICIAL_EDITOR_URL = 'https://www.taptap.cn/moment-editor';
  let local;
  let active = false;
  let obscured = false;
  let nativeVisible = false;
  let officialUrl = OFFICIAL_EDITOR_URL;
  let nativeRequest = 0;
  let boundsFrame = 0;
  let optionsPromise = null;
  const contextKey = () => { const context = getContext(); return `${context.devId}/${context.appId}`; };
  const emptyList = text => node('div', 'empty-note', text);

  function officialBounds() {
    const rect = $('#officialEditorHost').getBoundingClientRect();
    const titlebar = $('#desktopTitlebar').getBoundingClientRect().bottom;
    const x = Math.max(0, rect.left);
    const y = Math.max(titlebar, rect.top);
    const width = Math.min(window.innerWidth, rect.right) - x;
    const height = Math.min(window.innerHeight, rect.bottom) - y;
    return width >= 200 && height >= 240 ? {x, y, width, height} : null;
  }

  async function hideOfficialEditor() {
    nativeRequest += 1;
    nativeVisible = false;
    if (desktop) await desktop.officialEditor({action: 'hide'});
  }

  async function showOfficialEditor(url = officialUrl) {
    const bounds = officialBounds();
    if (!bounds) return false;
    if (!desktop) throw new Error('官方编辑器需要在 Windows 桌面应用中打开');
    const ticket = ++nativeRequest;
    nativeVisible = true;
    officialUrl = url;
    $('#officialEditorStatus').textContent = '正在加载官方页面…';
    try {
      const result = await desktop.officialEditor({action: 'show', url, bounds});
      if (ticket !== nativeRequest || !nativeVisible || !active) return false;
      if (!result.ok) return false;
      $('#officialEditorStatus').textContent = result.status === 'authentication-required'
        ? '请先在下方官方页面登录 TapTap，完成后回到草稿箱刷新'
        : '官方页面已加载；登录、素材、草稿与发布状态以页面实际显示为准';
      return true;
    } catch (error) {
      if (ticket === nativeRequest) {
        nativeVisible = false;
        $('#officialEditorStatus').textContent = `官方页面加载失败：${error.message}`;
      }
      throw error;
    }
  }

  async function syncOfficialEditor() {
    const shouldShow = active && !obscured && local.view === 'compose' && !$('dialog[open]');
    if (!shouldShow) {
      if (nativeVisible) await hideOfficialEditor();
      return false;
    }
    const bounds = officialBounds();
    if (!bounds) {
      if (nativeVisible) await hideOfficialEditor();
      return false;
    }
    if (nativeVisible) {
      await desktop.officialEditor({action: 'bounds', bounds});
      return true;
    }
    return showOfficialEditor();
  }

  function queueOfficialBounds() {
    cancelAnimationFrame(boundsFrame);
    boundsFrame = requestAnimationFrame(() => syncOfficialEditor().catch(error => {
      $('#officialEditorStatus').textContent = `编辑器显示失败：${error.message}`;
    }));
  }

  function renderDrafts() {
    const query = local.draftSearch.trim().toLocaleLowerCase();
    const filtered = local.drafts.filter(item => [item.title, item.summary, item.forum].some(value => (value || '').toLocaleLowerCase().includes(query)));
    if (local.draftsLoaded && !local.draftsLoading && !filtered.some(item => item.fingerprint === local.selectedDraft)) local.selectedDraft = filtered[0]?.fingerprint || '';
    const selected = local.drafts.find(item => item.fingerprint === local.selectedDraft);
    $('#draftSearch').value = local.draftSearch;
    $('#draftsSummary').textContent = local.draftsLoading
      ? local.draftsLoaded ? '正在后台刷新，当前草稿可继续浏览' : '正在从当前账号的官方编辑器读取…'
      : local.draftsError
        ? local.draftsLoaded ? '刷新未完成，正在显示上次读取结果' : '读取未完成，请检查连接后重试'
        : local.draftsLoaded
          ? local.draftsPartial
            ? `已读取 ${local.drafts.length} / ${local.draftsTotal} 份，官网还有更多草稿`
            : query
              ? `找到 ${filtered.length} / ${local.drafts.length} 份草稿`
              : `共 ${local.drafts.length} 份草稿 · 与当前 TapTap 账号同步`
          : '读取后可搜索和继续编辑';
    const list = $('#draftsList');
    list.replaceChildren();
    if (local.draftsLoading && !local.draftsLoaded) {
      const loading = node('div', 'draft-list-message');
      loading.append(node('span', 'spinner'), node('p', '', '正在读取官方草稿，不会保存或发布内容'));
      list.append(loading);
    } else if (local.draftsError && !local.draftsLoaded) {
      const failure = node('div', 'draft-list-message');
      failure.append(node('strong', '', '草稿箱暂时打不开'), node('p', '', local.draftsError));
      const retry = button('重新读取', 'button secondary');
      retry.type = 'button';
      retry.addEventListener('click', nativeGuard(loadOfficialDrafts));
      failure.append(retry);
      list.append(failure);
    } else if (!filtered.length) {
      const empty = node('div', 'draft-list-message');
      empty.append(node('strong', '', query ? '没有匹配的草稿' : '当前账号还没有草稿'), node('p', '', query ? '换个关键词，或清空搜索后再看。' : '在官方编辑器中保存的草稿会出现在这里。'));
      list.append(empty);
    } else {
      for (const item of filtered) {
        const card = button('', `draft-card${item.fingerprint === local.selectedDraft ? ' selected' : ''}`);
        card.type = 'button';
        card.dataset.draftIndex = String(item.index);
        card.setAttribute('role', 'option');
        card.setAttribute('aria-selected', String(item.fingerprint === local.selectedDraft));
        const coverUrl = safeUrl(item.cover);
        if (coverUrl) {
          const image = node('img', 'draft-cover');
          image.src = coverUrl;
          image.alt = '';
          image.loading = 'lazy';
          image.addEventListener('error', () => { image.replaceWith(node('span', 'draft-cover-placeholder', '稿')); }, {once: true});
          card.append(image);
        } else card.append(node('span', 'draft-cover-placeholder', '稿'));
        const copy = node('span', 'draft-card-copy');
        copy.append(node('strong', 'draft-card-title', item.title || '无标题草稿'), node('span', 'draft-card-summary', item.summary || '暂无正文摘要'), node('span', 'draft-card-forum', item.forum || '未标注论坛'), node('span', 'draft-card-time', item.modified || '时间未提供'));
        card.append(copy);
        card.addEventListener('click', () => { local.selectedDraft = item.fingerprint; renderDrafts(); });
        list.append(card);
      }
    }
    const showDetail = Boolean(selected && local.draftsLoaded);
    $('#draftDetail').classList.toggle('hidden', !showDetail);
    $('#draftEmpty').classList.toggle('hidden', showDetail);
    if (showDetail) {
      $('#draftDetailTitle').textContent = selected.title || '无标题草稿';
      $('#draftDetailForum').textContent = selected.forum || '未标注论坛';
      $('#draftDetailTime').textContent = selected.modified ? `最近修改：${selected.modified}` : '最近修改时间未提供';
      $('#draftDetailSummary').textContent = selected.summary || '这份草稿没有正文摘要，请进入官方编辑器查看完整内容。';
      $('#draftDetailSummary').classList.toggle('placeholder', !selected.summary);
    } else {
      const title = local.draftsLoading ? '正在读取草稿…' : local.draftsError ? '暂时无法读取草稿' : query ? '没有匹配的草稿' : local.draftsLoaded && !local.drafts.length ? '还没有草稿' : '选择一份草稿';
      const message = local.draftsError ? '可在左侧重新读取，不会重复保存或发布。' : query ? '试试标题、正文摘要或论坛名称。' : '在左侧查看标题和摘要，再进入官方编辑器继续创作。';
      const empty = $('#draftEmpty');
      empty.replaceChildren(node('span', '', local.draftsLoading ? '…' : '✎'), node('h3', '', title), node('p', '', message));
    }
    $('#refreshDrafts').disabled = local.draftsLoading || local.editingDraft;
    $('#editOfficialDraft').disabled = !showDetail || local.editingDraft;
    $('#editOfficialDraft').textContent = local.editingDraft ? '正在打开…' : '继续编辑';
  }

  async function loadOfficialDrafts() {
    if (!desktop) throw new Error('草稿箱需要在 Windows 桌面应用中打开');
    if (local.draftsLoading) return;
    const generation = local.generation;
    const hadDrafts = local.draftsLoaded;
    local.draftsLoading = true;
    local.draftsError = '';
    renderDrafts();
    try {
      const result = await desktop.officialEditor({action: 'list-drafts'});
      if (generation !== local.generation) return;
      if (result?.error === 'authentication-required') {
        local.drafts = [];
        local.draftsTotal = 0;
        local.draftsPartial = false;
        local.draftsLoaded = false;
        local.selectedDraft = '';
        local.draftsError = '请先登录 TapTap 网页账号，再刷新草稿';
        await showView('compose');
        toast('请在官方页面登录 TapTap，完成后回到草稿箱刷新');
        return;
      }
      local.drafts = Array.isArray(result.items) ? result.items : [];
      local.draftsTotal = Number.isInteger(result.total) ? result.total : local.drafts.length;
      local.draftsPartial = Boolean(result.partial);
      local.draftsLoaded = true;
      local.draftsReadAt = Date.parse(result.readAt) || Date.now();
      if (!local.drafts.some(item => item.fingerprint === local.selectedDraft)) local.selectedDraft = local.drafts[0]?.fingerprint || '';
    } catch (error) {
      if (generation !== local.generation) return;
      local.draftsLoaded = hadDrafts;
      local.draftsError = error.message;
      throw error;
    } finally {
      if (generation === local.generation) {
        local.draftsLoading = false;
        renderDrafts();
      }
    }
  }

  async function editSelectedDraft() {
    const selected = local.drafts.find(item => item.fingerprint === local.selectedDraft);
    if (!selected) throw new Error('请先选择要继续编辑的草稿');
    local.editingDraft = true;
    renderDrafts();
    try {
      const result = await desktop.officialEditor({action: 'edit-draft', index: selected.index, fingerprint: selected.fingerprint});
      if (!result?.ok) throw new Error('官方编辑器没有确认草稿已打开，请刷新后重试');
      officialUrl = OFFICIAL_EDITOR_URL;
      await showView('compose');
      toast(`已打开「${selected.title || '无标题草稿'}」，请核对完整内容`);
    } finally {
      local.editingDraft = false;
      renderDrafts();
    }
  }

  async function openOfficialDrafts() {
    return showView('drafts');
  }

  function reset() {
    active = false;
    nativeRequest += 1;
    nativeVisible = false;
    if (desktop) desktop.officialEditor({action: 'hide'}).catch(() => {});
    officialUrl = OFFICIAL_EDITOR_URL;
    $('#postTemplateDialog').close();
    $('#communityAssistant').open = false;
    local = {
      generation: (local?.generation || 0) + 1, view: 'compose', options: null, optionsKey: '', assets: [], assetCounter: 0,
      draft: null, previewOpened: false, published: false, momentsLoaded: false, page: 1,
      drafts: [], draftsTotal: 0, draftsPartial: false, draftsLoaded: false, draftsLoading: false, draftsError: '', draftsReadAt: 0,
      selectedDraft: '', draftSearch: '', editingDraft: false,
    };
    optionsPromise = null;
    for (const selector of ['#postTitle', '#postBody', '#postMediaFile']) $(selector).value = '';
    $('#postForum').value = getContext().appId ? (gameName() || `游戏 ${getContext().appId}`) : '尚未选择游戏';
    for (const selector of ['#postGroup', '#postIdentity']) {
      $(selector).replaceChildren(new Option('先读取发帖选项', ''));
      $(selector).disabled = true;
    }
    for (const selector of ['#postResult', '#postMediaResult']) $(selector).replaceChildren();
    $('#postReviewed').checked = false;
    $('#momentsList').replaceChildren(emptyList('选择“已发内容”后，自动读取当前游戏的社区帖子。'));
    $('#momentsPrev').disabled = true;
    $('#momentsNext').disabled = true;
    $('#momentsPage').textContent = '第 1 页';
    $('#officialEditorStatus').textContent = '官方页面尚未加载';
    showView('compose', false);
    renderDrafts();
    renderAssets();
    updatePreview();
    updateProgress();
  }

  async function read(action, data = {}) {
    const run = await callAction({action, context: requireContext(), data});
    if (!run.result?.ok) throw new Error(friendlyError(run));
    return run;
  }

  async function loadOptions() {
    const context = requireContext();
    const key = contextKey();
    const generation = local.generation;
    $('#reloadPostOptions').disabled = true;
    try {
      const run = await read('community.options');
      if (generation !== local.generation || key !== contextKey()) return;
      const options = communityPublishOptions(run.result);
      local.options = options;
      local.optionsKey = key;
      $('#postForum').value = gameName() || `游戏 ${context.appId}`;
      const group = $('#postGroup');
      group.replaceChildren();
      for (const item of options.groups) group.append(new Option(item.enabled ? item.name : `${item.name}（当前不可发帖）`, item.id, false, item.id === '0'));
      [...group.options].forEach(option => { option.disabled = !options.groups.find(item => item.id === option.value)?.enabled; });
      if (group.selectedIndex < 0 || group.options[group.selectedIndex]?.disabled) group.selectedIndex = [...group.options].findIndex(option => !option.disabled);
      const identity = $('#postIdentity');
      identity.replaceChildren();
      for (const item of options.identities) identity.append(new Option(item.label, item.value));
      identity.value = options.identities.some(item => item.value === 'official') ? 'official' : 'personal';
      group.disabled = false;
      identity.disabled = false;
      updatePreview();
      updateProgress();
      toast('已读取当前论坛的版块和可用身份');
    } catch (error) {
      if (generation !== local.generation || key !== contextKey()) return;
      const card = renderInline('#postResult', {title: '暂时无法准备发帖', message: error.message, type: 'error'});
      const retry = button('重试读取版块与身份', 'button secondary');
      retry.type = 'button';
      retry.addEventListener('click', guard(loadOptions, '正在重新读取发帖选项…'));
      card.append(retry);
      throw error;
    } finally { $('#reloadPostOptions').disabled = false; }
  }

  async function ensureOptions() {
    if (local.options && local.optionsKey === contextKey()) return;
    if (!optionsPromise) optionsPromise = loadOptions().finally(() => { optionsPromise = null; });
    return optionsPromise;
  }

  function requireOptions() {
    if (!local.options || local.optionsKey !== contextKey()) throw new Error('请先读取当前游戏的发帖版块与身份');
    const group = local.options.groups.find(item => item.id === $('#postGroup').value && item.enabled);
    const identity = local.options.identities.find(item => item.value === $('#postIdentity').value);
    if (!group || !identity) throw new Error('当前版块或身份不可用，请刷新发帖选项');
    return {group, identity};
  }

  function documentFromEditor() {
    const {group, identity} = requireOptions();
    return buildCommunityDocument({title: $('#postTitle').value, body: $('#postBody').value, assets: local.assets, forumAppId: getContext().appId, identity: identity.value, groupLabelId: group.id});
  }

  function isDirty() {
    if (!local.draft) return true;
    try { return local.draft.signature !== postContentSignature(documentFromEditor()); }
    catch { return true; }
  }

  function markDirty() {
    local.previewOpened = false;
    $('#postReviewed').checked = false;
    updatePreview();
    updateProgress();
  }

  function updateProgress() {
    const dirty = isDirty();
    const saved = Boolean(local.draft && !dirty);
    const reviewed = saved && local.previewOpened;
    $('#postDraftBadge').textContent = local.published ? '发布已返回' : local.draft ? (dirty ? '有未保存修改' : '草稿已保存') : '尚未保存';
    $('#postDraftBadge').className = `pill ${local.published || saved ? 'neutral' : 'warning'}`;
    const steps = [$('#postStepEdit'), $('#postStepDraft'), $('#postStepReview'), $('#postStepPublish')];
    const active = local.published ? 3 : reviewed ? 2 : saved ? 1 : 0;
    steps.forEach((step, index) => { step.classList.toggle('active', index === active); step.classList.toggle('done', index < active || (local.published && index === 3)); });
    $('#postPublishPanel').classList.toggle('hidden', !saved || local.published);
    $('#publishPost').disabled = !reviewed || !$('#postReviewed').checked || local.published;
    $('#createPostDraft').textContent = local.draft && !local.published ? '预览更新草稿' : '预览保存草稿';
    $('#createPostDraft').disabled = local.published;
    $('#postSaveHint').textContent = local.published ? '发布结果已返回，可在已发内容中核对公开状态' : dirty && local.draft ? '修改尚未保存，更新草稿后才能发布' : saved ? '下一步：打开官方预览，核对后确认发布' : '保存草稿是独立写入，会先显示完整确认信息';
  }

  function updatePreview() {
    const title = $('#postTitle').value.trim();
    $('#titleCount').textContent = `${$('#postTitle').value.length} / 100`;
    $('#previewTitle').textContent = title || '你的帖子标题会显示在这里';
    const official = $('#postIdentity').value !== 'personal';
    $('#previewAuthor').textContent = official ? (gameName() || '游戏官方') : '个人作者';
    $('#previewAvatar').textContent = official ? '官' : '个';
    const group = $('#postGroup').selectedOptions[0]?.textContent;
    $('#previewDestination').textContent = `${gameName() || '当前游戏'} · ${group || '请选择版块'}`;
    const target = $('#previewBody');
    target.replaceChildren();
    const blocks = textBlocks($('#postBody').value);
    if (!blocks.length) target.append(node('p', '', '开始输入正文，这里会同步显示排版效果。'));
    for (const block of blocks) {
      if (block.type === 'heading') target.append(node('h5', 'preview-heading', block.children[0].text));
      else if (block.type === 'list') {
        const list = node('ul');
        block.children.forEach(item => list.append(node('li', '', item.children[0].text)));
        target.append(list);
      } else target.append(node('p', block.info?.style === 'block-quote' ? 'preview-quote' : '', block.children[0].text));
    }
    $('#postMediaCount').textContent = `${local.assets.length} 项素材`;
    const previewAssets = $('#previewAssets');
    previewAssets.replaceChildren();
    for (const asset of local.assets) {
      if (asset.kind === 'image') {
        const figure = node('figure', 'preview-media');
        const image = node('img'); image.src = asset.url; image.alt = asset.description || asset.name; image.loading = 'lazy';
        figure.append(image, node('figcaption', '', asset.description || asset.name));
        previewAssets.append(figure);
      } else {
        const video = node('div', 'preview-video', '▶');
        video.append(node('span', '', asset.name), node('small', '', asset.status === 'normal' ? '视频已就绪' : '视频转码或审核中，可正常引用'));
        previewAssets.append(video);
      }
    }
  }

  function renderAssets() {
    const target = $('#postAssets');
    target.replaceChildren();
    if (!local.assets.length) { target.append(node('div', 'post-assets-empty', '还没有正文素材。图片会按实际上传返回的宽高插入；视频可正常引用转码中的素材。')); updatePreview(); return; }
    local.assets.forEach((asset, index) => {
      const card = node('article', 'post-asset-card');
      card.dataset.assetId = String(index);
      const order = node('span', 'asset-order', String(index + 1).padStart(2, '0'));
      const content = node('div', 'asset-info');
      if (asset.kind === 'image') {
        const image = node('img'); image.src = asset.url; image.alt = asset.name; image.loading = 'lazy';
        content.append(image);
      } else content.append(node('span', 'asset-video-icon', '▶'));
      const copy = node('div', 'asset-copy');
      copy.append(node('strong', '', asset.name), node('small', '', asset.kind === 'image' ? `图片 · ${asset.width} × ${asset.height}` : `视频 · ${asset.status === 'normal' ? '已就绪' : '转码或审核中，可引用'}`));
      if (asset.kind === 'image') {
        const label = node('label', '', '图片说明');
        const input = node('input'); input.value = asset.description; input.placeholder = asset.name; input.maxLength = 200; input.setAttribute('aria-label', `图片 ${index + 1} 的说明`);
        input.addEventListener('input', () => { asset.description = input.value; markDirty(); });
        label.append(input); copy.append(label);
      }
      content.append(copy);
      const controls = node('div', 'asset-controls');
      for (const [label, direction] of [['↑', -1], ['↓', 1]]) {
        const control = button(label, 'asset-move'); control.type = 'button'; control.title = direction < 0 ? '向前移动' : '向后移动'; control.disabled = (index === 0 && direction < 0) || (index === local.assets.length - 1 && direction > 0);
        control.addEventListener('click', () => { const [item] = local.assets.splice(index, 1); local.assets.splice(index + direction, 0, item); renderAssets(); markDirty(); });
        controls.append(control);
      }
      const remove = button('移除', 'asset-remove'); remove.type = 'button';
      remove.addEventListener('click', () => { local.assets.splice(index, 1); renderAssets(); markDirty(); });
      controls.append(remove);
      card.append(order, content, controls); target.append(card);
    });
    updatePreview();
  }

  async function chooseMedia(kind) {
    if (!desktop) throw new Error('请在桌面应用中选择素材');
    const file = await desktop.pickFile(`community-${kind}`);
    if (file) $('#postMediaFile').value = file;
  }

  async function uploadMedia() {
    const file = $('#postMediaFile').value.trim();
    if (!file) throw new Error('请先选择一张图片或一个视频');
    const kind = /\.(mp4|mov)$/i.test(file) ? 'video' : 'image';
    const key = contextKey();
    await startWrite({action: kind === 'video' ? 'community.uploadVideo' : 'community.uploadImage', context: requireContext(), file, data: {}}, '#postMediaResult', {
      summary: `${kind === 'video' ? '视频' : '图片'}：${file}。只上传到社区素材存储，不会自动保存或发布帖子。`,
      onExecuted: async run => {
        if (!run.result?.ok || key !== contextKey()) return;
        try {
          const asset = kind === 'video' ? videoAsset(run.result, file) : imageAsset(run.result, file);
          local.assets.push({...asset, id: `asset-${++local.assetCounter}`});
          $('#postMediaFile').value = '';
          renderAssets();
          markDirty();
          renderInline('#postMediaResult', {title: '素材已插入正文', message: '上传已完成，但草稿尚未保存。可在下方调整顺序或移除。', type: 'success', run});
        } catch (error) {
          renderInline('#postMediaResult', {title: '上传已执行，但返回素材无法识别', message: `${error.message}。请先查看执行记录，不要重复上传同一个文件。`, type: 'error', run});
        }
      },
    });
  }

  async function saveDraft() {
    const document = documentFromEditor();
    const {group, identity} = requireOptions();
    const key = contextKey();
    const action = local.draft && !local.published ? 'community.updateDraft' : 'community.createDraft';
    const data = action === 'community.updateDraft' ? {draft_id: local.draft.id, document} : document;
    await startWrite({action, context: requireContext(), data}, '#postResult', {
      summary: `标题：${document.title}\n位置：${gameName() || getContext().appId} / ${group.name}\n身份：${identity.label}\n正文素材：${local.assets.length} 项。保存后仍需审阅并单独确认发布。`,
      onExecuted: run => handleSaved(run, document, key),
    });
  }

  function handleSaved(run, document, key) {
    if (key !== contextKey()) return;
    const result = payload(run.result);
    const draftId = String(result.draft_id ?? '');
    const url = safeUrl(result.preview_url);
    if (!run.result?.ok || !/^[1-9][0-9]*$/.test(draftId) || !url) {
      renderInline('#postResult', {title: '没有确认草稿保存成功', message: friendlyError(run), type: 'error', run});
      return;
    }
    local.draft = {id: draftId, url, signature: postContentSignature(document)};
    local.previewOpened = false;
    local.published = false;
    $('#postReviewed').checked = false;
    const card = renderInline('#postResult', {title: '草稿已保存，请先审阅', message: `标题：${document.title}\n论坛／子版块：${gameName() || getContext().appId}／${$('#postGroup').selectedOptions[0].textContent}\n身份：${$('#postIdentity').selectedOptions[0].textContent}\n打开官方预览核对后，再单独确认发布。`, type: 'success', run});
    const link = button('在应用内打开官方草稿预览 →', 'button secondary post-draft-preview');
    link.id = 'postDraftPreview'; link.type = 'button';
    link.addEventListener('click', guard(async () => {
      window.scrollTo({top: 0, behavior: 'auto'});
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (!await showOfficialEditor(url)) throw new Error('官方预览区域当前不可见，请回到社区编辑器后重试');
      local.previewOpened = true;
      updateProgress();
      toast('官方草稿预览已在应用内打开，请核对实际页面');
    }, '正在应用内打开官方草稿预览…'));
    const refresh = button('重新读取草稿', 'text-button'); refresh.type = 'button';
    refresh.addEventListener('click', guard(refreshDraft, '正在读取最新草稿…'));
    card.append(link, refresh);
    updateProgress();
  }

  async function refreshDraft() {
    if (!local.draft) throw new Error('还没有已保存的草稿');
    if (isDirty()) throw new Error('当前有未保存修改，请先更新草稿；不会用新内容覆盖旧草稿的已保存状态');
    const run = await read('community.getDraft', {draft_id: local.draft.id});
    const result = payload(run.result);
    if (result.moment_id) { local.published = true; updateProgress(); throw new Error('这份草稿已经发布，不能再次修改或发布'); }
    const url = safeUrl(result.preview_url);
    if (!url) throw new Error('草稿读取成功，但没有返回可审阅的预览地址');
    local.draft.url = url;
    local.previewOpened = false;
    $('#postReviewed').checked = false;
    handleSaved(run, documentFromEditor(), contextKey());
  }

  async function publishDraft() {
    if (!local.draft || isDirty() || local.published) throw new Error('请先保存最新内容，再发布草稿');
    if (!local.previewOpened) throw new Error('请先打开官方草稿预览，核对实际展示效果');
    if (!$('#postReviewed').checked) throw new Error('请勾选已核对完整内容');
    const latest = await read('community.getDraft', {draft_id: local.draft.id});
    if (payload(latest.result).moment_id) { local.published = true; updateProgress(); throw new Error('这份草稿已经发布，不会重复发帖'); }
    const document = documentFromEditor();
    const key = contextKey();
    await startWrite({action: 'community.publishDraft', context: requireContext(), data: {draft_id: local.draft.id, document}}, '#postResult', {
      summary: `发布「${document.title}」到 ${gameName() || getContext().appId} / ${$('#postGroup').selectedOptions[0].textContent}。\n使用已保存的完整草稿，发布不可在此撤回；审核中可能仅自己可见。`,
      onExecuted: run => handlePublished(run, key),
    });
  }

  function handlePublished(run, key) {
    if (key !== contextKey()) return;
    const result = payload(run.result);
    const url = safeUrl(result.publish_url || result.preview_url);
    if (!run.result?.ok || !result.moment_id) {
      renderInline('#postResult', {title: '没有确认发布成功', message: friendlyError(run), type: 'error', run});
      return;
    }
    local.published = true;
    const card = renderInline('#postResult', {title: '发布结果已返回', message: '发布成功不等于审核通过或立即公开。审核中可能仅自己可见，请不要重复发帖。', type: 'success', links: url ? [{label: '查看已发布帖子 →', url}] : [], run});
    const manage = button('查看已发内容', 'button secondary');
    manage.addEventListener('click', guard(() => showView('manage'), '正在读取已发内容…'));
    card.append(manage);
    local.momentsLoaded = false;
    updateProgress();
  }

  async function loadMoments() {
    const order = $('#momentOrder').value;
    const intent = $('#momentIntent').value;
    const data = {order, page: local.page, page_size: 20};
    if (intent) data.moment_intent = intent.split(',');
    const key = contextKey();
    const generation = local.generation;
    $('#momentsList').replaceChildren(node('div', 'loading-block', '正在读取社区帖子…'));
    const run = await read('community.moments', data);
    if (generation !== local.generation || key !== contextKey()) return;
    const result = payload(run.result);
    const list = Array.isArray(result.list) ? result.list : [];
    local.momentsLoaded = true;
    const target = $('#momentsList');
    target.replaceChildren();
    if (!list.length) target.append(emptyList(local.page > 1 ? '这一页没有更多公开可见的帖子。' : '当前筛选下没有公开可见的帖子。审核中的新帖可能不会出现在这里。'));
    for (const moment of list) {
      const card = node('article', 'moment-card');
      const main = node('div', 'moment-main');
      const tags = node('div', 'moment-tags');
      if (moment.status?.is_official) tags.append(node('span', 'moment-tag official', '官方'));
      if (moment.status?.is_scheduled) tags.append(node('span', 'moment-tag', '定时未发布'));
      if (moment.group_label) tags.append(node('span', 'moment-tag', moment.group_label));
      if (moment.has_video) tags.append(node('span', 'moment-tag', '含视频'));
      main.append(tags, node('h4', '', moment.title || (moment.has_video ? '无标题视频动态' : '无标题图文动态')), node('p', '', moment.summary || '这条帖子没有提供摘要，可查看正文。'));
      const meta = node('small', 'moment-meta', `发布：${time(moment.publish_time)} · 最后回复：${time(moment.commented_time)}`);
      const stat = node('span', 'moment-stat', `${moment.stat?.comments ?? '—'} 回复　${moment.stat?.ups ?? '—'} 点赞　${moment.stat?.pv_total ?? '—'} 浏览`);
      main.append(meta, stat);
      const actions = node('div', 'moment-actions');
      const detail = button('查看正文', 'button secondary');
      detail.addEventListener('click', guard(() => showMoment(moment.moment_id), '正在读取帖子正文…'));
      actions.append(detail);
      const url = safeUrl(moment.url);
      if (url) { const link = node('a', 'text-button', '打开官方帖子 →'); link.href = url; link.target = '_blank'; link.rel = 'noreferrer'; actions.append(link); }
      card.append(main, actions); target.append(card);
    }
    $('#momentsPage').textContent = `第 ${local.page} 页`;
    $('#momentsPrev').disabled = local.page <= 1;
    $('#momentsNext').disabled = list.length < 20;
  }

  async function showMoment(momentId) {
    if (!/^[1-9][0-9]*$/.test(String(momentId ?? ''))) throw new Error('帖子没有有效的 ID，不能读取详情');
    const run = await read('community.moment', {moment_id: String(momentId)});
    const result = payload(run.result);
    const target = $('#momentDetail');
    target.replaceChildren();
    target.append(node('h3', '', result.title || '帖子正文'), node('p', 'moment-detail-meta', time(result.publish_time)));
    const body = node('div', 'moment-detail-body', result.content || '这条帖子没有文字正文。');
    target.append(body);
    const images = Array.isArray(result.images) ? result.images : [];
    if (images.length) {
      const gallery = node('div', 'moment-detail-images');
      for (const item of images) {
        const url = safeUrl(typeof item === 'string' ? item : item?.url);
        if (url) { const image = node('img'); image.src = url; image.alt = '帖子图片'; image.loading = 'lazy'; gallery.append(image); }
      }
      target.append(gallery);
    }
    if (result.video) target.append(node('p', 'field-hint', `帖子含视频${result.video.duration_seconds ? ` · ${result.video.duration_seconds} 秒` : ''}，官方接口不提供播放地址，请在帖子页观看。`));
    const url = safeUrl(result.url);
    if (url) { const link = node('a', 'button secondary', '打开官方帖子'); link.href = url; link.target = '_blank'; link.rel = 'noreferrer'; target.append(link); }
    target.append(resultDetails(run));
    $('#momentDialog').showModal();
  }

  async function showView(view, load = true) {
    local.view = view;
    $$('[data-community-view]').forEach(element => { const active = element.dataset.communityView === view; element.classList.toggle('active', active); element.setAttribute('aria-selected', String(active)); });
    $('#communityCompose').classList.toggle('hidden', view !== 'compose');
    $('#communityDrafts').classList.toggle('hidden', view !== 'drafts');
    $('#communityManage').classList.toggle('hidden', view !== 'manage');
    if (view === 'drafts') {
      await hideOfficialEditor();
      renderDrafts();
      if (load && !local.draftsLoaded && !local.draftsLoading) return loadOfficialDrafts();
      if (load && local.draftsLoaded && !local.draftsLoading && Date.now() - local.draftsReadAt > 60000) {
        void loadOfficialDrafts().catch(error => toast(error.message, true));
      }
      return;
    }
    if (view === 'manage') {
      await hideOfficialEditor();
      if (!load || !getContext().appId) return;
      if (!local.momentsLoaded) return loadMoments();
      return;
    }
    if (!load) return;
    return syncOfficialEditor();
  }

  function insertFormat(kind) {
    const snippets = {heading: '\n\n### 小标题\n\n', list: '\n\n- 第一条要点\n- 第二条要点\n\n', quote: '\n\n> 需要特别强调的说明\n\n'};
    const input = $('#postBody');
    const start = input.selectionStart ?? input.value.length;
    input.value = `${input.value.slice(0, start)}${snippets[kind]}${input.value.slice(input.selectionEnd ?? start)}`;
    input.focus();
    input.selectionStart = input.selectionEnd = start + snippets[kind].length;
    markDirty();
  }

  let selectedTemplateId = 'version';
  let templateValues = {};
  const templateStorageKey = id => `taptap-post-template:${contextKey()}:${id}`;

  function renderTemplateChoices() {
    $('#postTemplateChoices').classList.remove('hidden');
    $('#postTemplateEditor').classList.add('hidden');
    $('#postTemplateChoices').replaceChildren();
    for (const template of POST_TEMPLATES) {
      const card = button('', 'post-template-card'); card.type = 'button'; card.dataset.template = template.id;
      card.append(node('span', '', template.icon), node('strong', '', template.name), node('small', '', template.description), node('em', '', `填写${template.short}内容 →`));
      card.addEventListener('click', () => selectTemplate(template.id));
      $('#postTemplateChoices').append(card);
    }
  }

  function selectTemplate(id) {
    selectedTemplateId = id;
    templateValues = {};
    try { templateValues = JSON.parse(localStorage.getItem(templateStorageKey(id)) || '{}'); } catch { /* Use an empty form. */ }
    const template = POST_TEMPLATES.find(item => item.id === id);
    $('#postTemplateChoices').classList.add('hidden');
    $('#postTemplateEditor').classList.remove('hidden');
    $('#postTemplateName').textContent = `${template.name} · 填写真实信息`;
    $('#postTemplateDescription').textContent = '上次填写的信息会保留在当前游戏下。生成后仍可自由修改，不会自动保存或发布。';
    const target = $('#postTemplateFields'); target.replaceChildren();
    for (const field of template.fields) {
      const label = node('label', '', `${field.label}${field.required ? ' *' : ''}`);
      const input = node(field.type === 'textarea' ? 'textarea' : 'input');
      input.id = `postTemplate_${field.key}`; input.placeholder = field.placeholder || ''; input.value = templateValues[field.key] || '';
      if (field.type !== 'textarea') input.maxLength = 180;
      input.addEventListener('input', () => {
        templateValues[field.key] = input.value;
        try { localStorage.setItem(templateStorageKey(id), JSON.stringify(templateValues)); } catch { /* Storage is optional. */ }
        updateTemplatePreview();
      });
      label.append(input); target.append(label);
    }
    const hasText = Boolean($('#postTitle').value.trim() || $('#postBody').value.trim());
    $('#postTemplateReplaceRow').classList.toggle('hidden', !hasText && !local.published);
    $('#postTemplateReplace').checked = false;
    updateTemplatePreview();
  }

  function updateTemplatePreview() {
    try {
      const content = createPostContent(selectedTemplateId, gameName(), templateValues);
      $('#postTemplatePreviewTitle').textContent = content.title;
      const preview = $('#postTemplatePreviewBody');
      preview.replaceChildren();
      preview.classList.remove('placeholder');
      for (const block of textBlocks(content.body)) {
        if (block.type === 'heading') preview.append(node('h5', 'template-preview-heading', block.children[0].text));
        else if (block.type === 'list') {
          const list = node('ul', 'template-preview-list');
          for (const item of block.children) list.append(node('li', '', item.children[0].text));
          preview.append(list);
        } else preview.append(node('p', block.info?.style === 'block-quote' ? 'template-preview-quote' : '', block.children[0].text));
      }
    } catch {
      $('#postTemplatePreviewTitle').textContent = '填写必填信息后生成完整帖子';
      $('#postTemplatePreviewBody').textContent = '这里会显示标题与正文。所有信息都来自你的填写，不会虚构版本功能、测试奖励或开放时间。';
      $('#postTemplatePreviewBody').classList.add('placeholder');
    }
  }

  async function openTemplates(preferred = 'version') {
    requireContext();
    await showView('compose');
    $('#communityAssistant').open = true;
    await ensureOptions();
    if (!POST_TEMPLATES.some(item => item.id === preferred)) preferred = 'version';
    selectedTemplateId = preferred;
    renderTemplateChoices();
    $('#postTemplateDialog').showModal();
  }

  function applyTemplate() {
    const content = createPostContent(selectedTemplateId, gameName(), templateValues);
    if (($('#postTitle').value.trim() || $('#postBody').value.trim() || local.published) && !$('#postTemplateReplace').checked) {
      throw new Error('编辑器已有文字，请勾选确认替换后再套用模板');
    }
    $('#postTitle').value = content.title;
    $('#postBody').value = content.body;
    if (local.published) {
      local.draft = null; local.published = false; local.previewOpened = false; local.assets = [];
      $('#postResult').replaceChildren(); $('#postMediaResult').replaceChildren(); $('#postReviewed').checked = false;
      renderAssets();
    }
    if (selectedTemplateId === 'version' && local.options) {
      const group = local.options.groups.find(item => item.enabled && /开发|更新|公告/.test(item.name));
      if (group) $('#postGroup').value = group.id;
    }
    $('#postTemplateDialog').close();
    markDirty();
    $('#postTitle').focus();
    toast('模板已填入，可继续修改；尚未保存或发布');
  }

  for (const selector of ['#postTitle', '#postBody']) $(selector).addEventListener('input', markDirty);
  for (const selector of ['#postGroup', '#postIdentity']) $(selector).addEventListener('change', markDirty);
  $('#reloadPostOptions').addEventListener('click', guard(loadOptions, '正在读取真实发帖选项…'));
  $('#choosePostImage').addEventListener('click', guard(() => chooseMedia('image'), '正在选择图片…'));
  $('#choosePostVideo').addEventListener('click', guard(() => chooseMedia('video'), '正在选择视频…'));
  $('#uploadPostMedia').addEventListener('click', guard(uploadMedia, '正在生成社区素材上传预览…'));
  $('#createPostDraft').addEventListener('click', guard(saveDraft, '正在生成完整草稿保存预览…'));
  $('#postReviewed').addEventListener('change', updateProgress);
  $('#publishPost').addEventListener('click', guard(publishDraft, '正在核对草稿并生成发布预览…'));
  $('#loadMoments').addEventListener('click', guard(loadMoments, '正在刷新社区帖子…'));
  for (const selector of ['#momentOrder', '#momentIntent']) $(selector).addEventListener('change', guard(() => { local.page = 1; return loadMoments(); }, '正在筛选帖子…'));
  $('#momentsPrev').addEventListener('click', guard(() => { if (local.page > 1) local.page -= 1; return loadMoments(); }, '正在读取上一页…'));
  $('#momentsNext').addEventListener('click', guard(() => { local.page += 1; return loadMoments(); }, '正在读取下一页…'));
  const nativeGuard = task => async event => {
    event?.preventDefault();
    try { await task(); } catch (error) { toast(error.message, true); }
  };
  $$('[data-community-view]').forEach(element => element.addEventListener('click', element.dataset.communityView === 'manage'
    ? guard(() => showView('manage'), '正在读取社区内容…')
    : nativeGuard(() => showView(element.dataset.communityView))));
  $$('[data-post-format]').forEach(element => element.addEventListener('click', () => insertFormat(element.dataset.postFormat)));
  $('#closeMoment').addEventListener('click', () => $('#momentDialog').close());
  $('#openPostTemplates').addEventListener('click', guard(() => openTemplates(), '正在准备帖子模板…'));
  $('#openOfficialDrafts').addEventListener('click', nativeGuard(openOfficialDrafts));
  $('#refreshDrafts').addEventListener('click', nativeGuard(loadOfficialDrafts));
  $('#draftSearch').addEventListener('input', event => { local.draftSearch = event.target.value; renderDrafts(); });
  $('#editOfficialDraft').addEventListener('click', nativeGuard(editSelectedDraft));
  $('#reloadOfficialEditor').addEventListener('click', nativeGuard(async () => {
    if (!await syncOfficialEditor()) throw new Error('请先回到社区官方编辑器');
    await desktop.officialEditor({action: 'reload'});
    $('#officialEditorStatus').textContent = '正在刷新官方页面…';
  }));
  $('#communityAssistant').addEventListener('toggle', () => {
    if ($('#communityAssistant').open && getContext().appId && local.optionsKey !== contextKey()) guard(ensureOptions, '正在读取真实发帖选项…')();
  });
  new ResizeObserver(queueOfficialBounds).observe($('#officialEditorHost'));
  window.addEventListener('resize', queueOfficialBounds);
  window.addEventListener('scroll', queueOfficialBounds, true);
  const dialogObserver = new MutationObserver(queueOfficialBounds);
  $$('dialog').forEach(dialog => dialogObserver.observe(dialog, {attributes: true, attributeFilter: ['open']}));
  $('#postTemplateBack').addEventListener('click', renderTemplateChoices);
  for (const selector of ['#closePostTemplates', '#cancelPostTemplate']) $(selector).addEventListener('click', () => $('#postTemplateDialog').close());
  $('#applyPostTemplate').addEventListener('click', guard(applyTemplate));
  reset();
  return {
    reset, showView, openTemplates, handleSaved, handlePublished,
    activate: async () => { active = true; return showView(local.view); },
    deactivate: async () => { active = false; await hideOfficialEditor(); },
    setObscured: value => {
      obscured = value;
      return syncOfficialEditor().catch(error => { $('#officialEditorStatus').textContent = `编辑器显示失败：${error.message}`; });
    },
  };
}
