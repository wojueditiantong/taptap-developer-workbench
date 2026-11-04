import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';

const SENSITIVE = /(^|_)(access_?token|refresh_?token|secret|cookie|openid|authorization|master_?key|signed_?url)$/i;

export function redact(value, key = '') {
  if (SENSITIVE.test(key)) return '[已脱敏]';
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redact(child, childKey)]));
  }
  return value;
}

export function parseCliOutput(stdout, stderr, code) {
  const text = stdout.trim();
  const errorText = stderr.trim();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {ok: code === 0, data: null};
  } catch {
    payload = {ok: code === 0, data: {text: text || errorText || null}};
  }
  // Native CLI validation failures are JSON on stderr, with an empty stdout.
  // Preserve their actionable message instead of reducing the UI to a process code.
  if (!text && errorText) {
    try {
      const parsedError = JSON.parse(errorText);
      if (parsedError && typeof parsedError === 'object' && !Array.isArray(parsedError)) payload = parsedError;
    } catch { /* Ordinary diagnostic stderr remains available in process.stderr. */ }
  }
  return redact({...payload, process: {exitCode: code, stderr: errorText || null}});
}

export function createCliRunner({cliPath, cwd, native = false, timeoutMs = 120000, maxOutput = 8 * 1024 * 1024}) {
  return function runCli(args, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(native ? cliPath : process.execPath, native ? args : [cliPath, ...args], {
        cwd,
        shell: false,
        windowsHide: true,
        env: {...process.env, NO_COLOR: '1', CI: '1', ELECTRON_RUN_AS_NODE: '1', ...(native ? {TAPTAP_CLI_BUNDLED_SKILLS_ROOT: path.resolve(cliPath, '../..')} : {})},
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: options.signal,
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        reject(new Error(`CLI 执行超过 ${Math.round((options.timeoutMs ?? timeoutMs) / 1000)} 秒，已停止等待`));
      }, options.timeoutMs ?? timeoutMs);

      const append = (current, chunk) => {
        const next = current + chunk.toString('utf8');
        if (next.length > maxOutput) {
          settled = true;
          child.kill('SIGTERM');
          clearTimeout(timeout);
          reject(new Error('CLI 输出超过本地安全上限'));
          return current;
        }
        return next;
      };
      child.stdout.on('data', chunk => { if (!settled) stdout = append(stdout, chunk); });
      child.stderr.on('data', chunk => { if (!settled) stderr = append(stderr, chunk); });
      child.on('error', error => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
      child.on('close', code => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(parseCliOutput(stdout, stderr, code ?? 1));
      });
    });
  };
}

export function fingerprintRun(action, args) {
  return createHash('sha256').update(JSON.stringify({action, args})).digest('hex');
}
