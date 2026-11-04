import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile, stat} from 'node:fs/promises';
import {createCliRunner} from './lib/cli.mjs';
import {createStore} from './lib/store.mjs';
import {createRunService} from './lib/run-service.mjs';
import {publicCatalog} from './lib/actions.mjs';
import {createAuthService} from './lib/auth-service.mjs';

const toolRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = toolRoot;
const publicRoot = path.join(toolRoot, 'public');
const outputRoot = path.join(workspaceRoot, 'output', 'taptap-ops');
const cliPath = path.join(toolRoot, 'node_modules', '@taptap', 'cli', 'scripts', 'run.js');
const store = createStore(outputRoot);
const runCli = createCliRunner({cliPath, cwd: workspaceRoot});
const service = createRunService({store, runCli, root: workspaceRoot});
const auth = createAuthService({runCli});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const content = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(content),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
  });
  res.end(content);
}

async function jsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024 * 1024) throw new Error('请求内容超过 1 MiB 上限');
  }
  if (!body) return {};
  try { return JSON.parse(body); }
  catch { throw new Error('请求必须是有效 JSON'); }
}

async function staticFile(res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(publicRoot, relative);
  if (path.relative(publicRoot, file).startsWith('..')) return send(res, 403, {error: '禁止访问'});
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not file');
    const content = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
    });
    res.end(content);
  } catch {
    send(res, 404, {error: '页面不存在'});
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/health' && req.method === 'GET') {
      return send(res, 200, {ok: true, name: 'TapTap 开发者工作台', cli: '2026.10.31', workspaceRoot});
    }
    if (url.pathname === '/api/catalog' && req.method === 'GET') return send(res, 200, {actions: publicCatalog()});
    if (url.pathname === '/api/auth' && req.method === 'GET') return send(res, 200, auth.getStatus());
    if (url.pathname === '/api/auth' && req.method === 'POST') return send(res, 200, await auth.start());
    if (url.pathname === '/api/auth' && req.method === 'DELETE') return send(res, 200, auth.cancel());
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') return send(res, 200, await auth.logout());
    if (url.pathname === '/api/state' && req.method === 'GET') return send(res, 200, await store.getState());
    if (url.pathname === '/api/state' && req.method === 'PUT') return send(res, 200, await store.saveState(await jsonBody(req)));
    if (url.pathname === '/api/runs' && req.method === 'GET') return send(res, 200, {runs: await store.listRuns()});
    if (url.pathname === '/api/runs' && req.method === 'POST') return send(res, 200, await service.runAction(await jsonBody(req)));
    if (url.pathname === '/api/reports' && req.method === 'GET') return send(res, 200, {reports: await store.listReports()});

    const runMatch = url.pathname.match(/^\/api\/runs\/(run-[a-z0-9-]+)(\/execute)?$/);
    if (runMatch && req.method === 'GET' && !runMatch[2]) return send(res, 200, await store.getRun(runMatch[1]));
    if (runMatch && req.method === 'POST' && runMatch[2]) {
      const body = await jsonBody(req);
      return send(res, 200, await service.confirmExecute(runMatch[1], body.confirmation));
    }
    const reportMatch = url.pathname.match(/^\/api\/reports\/(report-[a-z0-9-]+)\/(markdown|data)$/);
    if (reportMatch && req.method === 'GET') {
      const content = await store.getReport(reportMatch[1], reportMatch[2]);
      return send(res, 200, content, reportMatch[2] === 'markdown' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8');
    }
    if (url.pathname === '/api/workflows/release-check' && req.method === 'POST') {
      return send(res, 200, await service.runWorkflow('release', await jsonBody(req)));
    }
    if (url.pathname === '/api/workflows/operations-report' && req.method === 'POST') {
      return send(res, 200, await service.runWorkflow('operations', await jsonBody(req)));
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, {error: '接口不存在'});
    if (req.method !== 'GET') return send(res, 405, {error: '方法不允许'});
    return staticFile(res, url.pathname);
  } catch (error) {
    return send(res, 400, {ok: false, error: error.message});
  }
});

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
const port = Number(argument('--port', process.env.PORT || 7100));
const host = argument('--host', process.env.HOST || '127.0.0.1');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('无效端口');
server.listen(port, host, () => {
  console.log(`TapTap 开发者工作台已启动：http://${host}:${port}/`);
  console.log('写入动作只生成预览，必须在界面中再次确认才会执行。');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    auth.cancel();
    server.close(() => process.exit(0));
  });
}
