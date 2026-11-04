import {mkdir, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';

async function writeAtomic(file, value) {
  await mkdir(path.dirname(file), {recursive: true});
  const temp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
  try {
    // Windows may briefly hold a newly created file while it is being indexed.
    // Only retry transient file locks; persistent permission failures still surface.
    for (let attempt = 0; ; attempt += 1) {
      try { await rename(temp, file); return; }
      catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 3) throw error;
        await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
  } catch (error) {
    await rm(temp, {force: true}).catch(() => {});
    throw error;
  }
}

export function createStore(outputRoot) {
  const runsRoot = path.join(outputRoot, 'runs');
  const reportsRoot = path.join(outputRoot, 'reports');
  const stateFile = path.join(outputRoot, 'state.json');

  async function saveRun(run) {
    await writeAtomic(path.join(runsRoot, `${run.id}.json`), run);
  }

  async function getRun(id) {
    if (!/^run-[a-z0-9-]+$/.test(id)) throw new Error('无效运行编号');
    return JSON.parse(await readFile(path.join(runsRoot, `${id}.json`), 'utf8'));
  }

  async function listRuns(limit = 40) {
    await mkdir(runsRoot, {recursive: true});
    const files = (await readdir(runsRoot)).filter(file => file.endsWith('.json'));
    const runs = await Promise.all(files.slice(-limit * 2).map(async file => {
      try { return JSON.parse(await readFile(path.join(runsRoot, file), 'utf8')); }
      catch { return null; }
    }));
    return runs.filter(Boolean)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(({result, ...run}) => ({...run, hasResult: Boolean(result)}));
  }

  async function saveState(state) {
    const safe = {
      devId: String(state.devId ?? '').trim(),
      appId: String(state.appId ?? '').trim(),
      updatedAt: new Date().toISOString(),
    };
    await writeAtomic(stateFile, safe);
    return safe;
  }

  async function getState() {
    try { return JSON.parse(await readFile(stateFile, 'utf8')); }
    catch { return {devId: '', appId: ''}; }
  }

  async function saveReport(id, markdown, payload) {
    if (!/^report-[a-z0-9-]+$/.test(id)) throw new Error('无效报告编号');
    await mkdir(reportsRoot, {recursive: true});
    await writeFile(path.join(reportsRoot, `${id}.md`), markdown);
    await writeAtomic(path.join(reportsRoot, `${id}.json`), payload);
    return {id, markdownUrl: `/api/reports/${id}/markdown`, dataUrl: `/api/reports/${id}/data`};
  }

  async function getReport(id, kind) {
    if (!/^report-[a-z0-9-]+$/.test(id)) throw new Error('无效报告编号');
    const extension = kind === 'markdown' ? 'md' : 'json';
    return readFile(path.join(reportsRoot, `${id}.${extension}`), 'utf8');
  }

  async function listReports() {
    await mkdir(reportsRoot, {recursive: true});
    return (await readdir(reportsRoot)).filter(file => file.endsWith('.json')).sort().reverse();
  }

  return {saveRun, getRun, listRuns, saveState, getState, saveReport, getReport, listReports};
}
