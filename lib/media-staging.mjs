import {copyFile, mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

// Only an explicit user file choice reaches this helper. It creates a local
// staging copy; the separate write-preview/confirmation flow performs uploads.
export async function stageCommunityMedia({workspaceRoot, selected}) {
  if (!path.isAbsolute(workspaceRoot) || !path.isAbsolute(selected)) throw new Error('素材路径无效');
  const stageRoot = path.join(workspaceRoot, 'output', 'taptap-ops', 'uploads');
  await mkdir(stageRoot, {recursive: true});
  const filename = path.basename(selected).replace(/[<>:"/\\|?*]/g, '-');
  const staged = path.join(stageRoot, `${Date.now()}-${randomUUID().slice(0, 8)}-${filename}`);
  await copyFile(selected, staged);
  const relative = path.relative(workspaceRoot, staged);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('素材暂存位置无效');
  return relative;
}
