import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCliRunner, parseCliOutput} from '../lib/cli.mjs';

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('原生 CLI 的 stderr JSON 错误会进入可读错误信息', () => {
  const result = parseCliOutput('', JSON.stringify({ok: false, error: {type: 'validation', message: 'unknown flag "--dev-id"'}}), 2);
  assert.equal(result.ok, false);
  assert.equal(result.error.message, 'unknown flag "--dev-id"');
  assert.equal(result.process.exitCode, 2);
});

test('桌面执行层直接运行官方 Windows 原生 CLI，不经过 Node 启动器', {skip: process.platform !== 'win32'}, async () => {
  const cliPath = path.join(toolRoot, 'node_modules', '@taptap', 'cli', 'bin', 'taptap-cli-windows-amd64.exe');
  const runCli = createCliRunner({cliPath, cwd: toolRoot, native: true, timeoutMs: 15000});
  const result = await runCli(['version', '--format', 'json']);
  assert.equal(result.ok, true);
  assert.equal(result.data.name, '@taptap/cli');
  assert.equal(result.process.exitCode, 0);
});
