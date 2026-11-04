export async function settleOfficialNavigation(contents, {timeout = 15000} = {}) {
  if (contents.isDestroyed() || !contents.isLoading()) return;
  await new Promise(resolve => {
    let timer;
    const done = () => {
      clearTimeout(timer);
      contents.removeListener('did-stop-loading', done);
      contents.removeListener('did-finish-load', done);
      resolve();
    };
    contents.once('did-stop-loading', done);
    contents.once('did-finish-load', done);
    timer = setTimeout(done, timeout);
    if (!contents.isLoading()) done();
  });
}

export async function loadOfficialEditorDocument({contents, target, officialPage, settleTimeout = 15000}) {
  try {
    await contents.loadURL(target);
  } catch (error) {
    // TapTap SSO can start another navigation while loadURL is still pending.
    // Keep following that official handoff instead of surfacing ERR_ABORTED.
    if (error?.code !== 'ERR_ABORTED' && !/ERR_ABORTED/.test(error?.message || '')) throw error;
    if (!officialPage(contents.getURL())) throw error;
    await settleOfficialNavigation(contents, {timeout: settleTimeout});
  }
  return contents.getURL();
}
