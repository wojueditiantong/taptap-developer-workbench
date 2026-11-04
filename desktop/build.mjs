import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builder = path.join(toolRoot, 'node_modules', 'electron-builder', 'cli.js');
const node = path.join(toolRoot, 'node_modules', 'node', 'bin', 'node.exe');
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ASAR;
const child = spawn(node, [builder, '--win', 'portable', '--x64'], {cwd: toolRoot, stdio: 'inherit', env});
child.on('error', error => {console.error(error); process.exitCode = 1;});
child.on('close', code => {process.exitCode = code ?? 1;});
