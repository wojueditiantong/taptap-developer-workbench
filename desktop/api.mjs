export function createDesktopApi({auth, store, service, clearAuthorizationSession = async () => {}}) {
  return async function request(pathname, {method = 'GET', body = null} = {}) {
    const hasBody = body !== null && body !== undefined;
    const input = () => typeof body === 'string' ? JSON.parse(body || '{}') : (body || {});
    if (pathname === '/api/health' && method === 'GET') return {ok: true, name: 'TapTap 开发者工作台', mode: 'desktop'};
    if (pathname === '/api/catalog' && method === 'GET') return service.catalog();
    if (pathname === '/api/auth' && method === 'GET') return auth.getStatus();
    if (pathname === '/api/auth' && method === 'POST') return auth.start();
    if (pathname === '/api/auth' && method === 'DELETE') return auth.cancel();
    if (pathname === '/api/auth/logout' && method === 'POST') {
      const result = await auth.logout();
      await clearAuthorizationSession();
      await store.saveState({devId: '', appId: ''});
      return result;
    }
    if (pathname === '/api/state' && method === 'GET') return store.getState();
    if (pathname === '/api/state' && method === 'PUT' && hasBody) return store.saveState(input());
    if (pathname === '/api/runs' && method === 'GET') return {runs: await store.listRuns()};
    if (pathname === '/api/runs' && method === 'POST' && hasBody) return service.runAction(input());
    if (pathname === '/api/reports' && method === 'GET') return {reports: await store.listReports()};
    const run = pathname.match(/^\/api\/runs\/(run-[a-z0-9-]+)(\/execute)?$/);
    if (run && method === 'GET' && !run[2]) return store.getRun(run[1]);
    if (run && method === 'POST' && run[2]) return service.confirmExecute(run[1], input().confirmation);
    const report = pathname.match(/^\/api\/reports\/(report-[a-z0-9-]+)\/(markdown|data)$/);
    if (report && method === 'GET') return {content: await store.getReport(report[1], report[2]), kind: report[2]};
    if (pathname === '/api/workflows/release-check' && method === 'POST') return service.runWorkflow('release', input());
    if (pathname === '/api/workflows/operations-report' && method === 'POST') return service.runWorkflow('operations', input());
    throw new Error('应用不支持这个操作');
  };
}
