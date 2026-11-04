import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {stageCommunityMedia} from '../lib/media-staging.mjs';
import {buildActionArgs} from '../lib/actions.mjs';

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('本机素材先复制到工作区暂存目录，可被官方 CLI 上传链路接受', async t => {
  const parent = await mkdtemp(path.join(toolRoot, 'tmp-media-test-'));
  t.after(() => rm(parent, {recursive: true, force: true}));
  const workspaceRoot = path.join(parent, 'workspace');
  const sourceDir = path.join(parent, 'pictures');
  const source = path.join(sourceDir, '更新 海报.png');
  await mkdir(workspaceRoot);
  await mkdir(sourceDir);
  await writeFile(source, 'image-fixture');
  const relative = await stageCommunityMedia({workspaceRoot, selected: source});
  assert.match(relative, /^output[\\/]taptap-ops[\\/]uploads[\\/].+更新 海报\.png$/);
  assert.equal(await readFile(path.join(workspaceRoot, relative), 'utf8'), 'image-fixture');
  assert.notEqual(path.resolve(workspaceRoot, relative), source);
  const {args} = buildActionArgs({action: 'community.uploadImage', context: {devId: '123', appId: '20001'}, file: relative, data: {}}, workspaceRoot);
  assert.equal(args[2], path.join(workspaceRoot, relative));
  assert.ok(args.includes('--dev-id') && args.includes('--app-id'));
});
