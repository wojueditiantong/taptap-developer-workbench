import {randomUUID} from 'node:crypto';
import {buildActionArgs} from './actions.mjs';
import {fingerprintRun} from './cli.mjs';
import {releaseMarkdown} from './release.mjs';
import {operationsMarkdown, previousPeriodRange} from './operations.mjs';

const newRunId = () => `run-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
const newReportId = () => `report-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

export function createRunService({store, runCli, root}) {
  const executionLocks = new Set();

  async function executeBuilt({action, args, data, input, mode, fingerprint, parentId = null}) {
    const id = newRunId();
    const idempotencyKey = action.risk === 'write' ? `ops-${fingerprint.slice(0, 40)}` : null;
    const finalArgs = [...args];
    if (action.risk === 'write') {
      finalArgs.push('--idempotency-key', idempotencyKey);
      finalArgs.push(mode === 'execute' ? '--yes' : '--dry-run');
    }
    const run = {
      id,
      parentId,
      action: action.id,
      label: action.label,
      risk: action.risk,
      mode,
      status: 'running',
      fingerprint,
      idempotencyKey,
      input: {context: input.context, data, file: input.file, service: input.service, method: input.method},
      baseArgs: [...args],
      args: finalArgs,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.saveRun(run);
    try {
      const result = await runCli(finalArgs, {timeoutMs: action.file ? 15 * 60 * 1000 : undefined});
      run.result = result;
      run.status = result.ok ? (mode === 'preview' ? 'awaiting_confirmation' : 'succeeded') : 'failed';
    } catch (error) {
      run.result = {ok: false, error: {type: 'internal', hint: error.message}};
      run.status = 'failed';
    }
    run.updatedAt = new Date().toISOString();
    await store.saveRun(run);
    return run;
  }

  async function runAction(input) {
    const {action, args, data} = buildActionArgs(input, root);
    const fingerprint = fingerprintRun(action.id, args);
    return executeBuilt({action, args, data, input, mode: action.risk === 'write' ? 'preview' : 'read', fingerprint});
  }

  async function confirmExecute(previewId, confirmation) {
    const preview = await store.getRun(previewId);
    if (preview.risk !== 'write' || preview.mode !== 'preview') throw new Error('该运行单不是写入预览');
    if (preview.status !== 'awaiting_confirmation' || !preview.result?.ok) throw new Error('预览未成功，不能执行写入');
    if (preview.executionId) return store.getRun(preview.executionId);
    if (confirmation !== `确认${preview.label}`) throw new Error(`请输入“确认${preview.label}”以匹配本次预览`);
    if (executionLocks.has(previewId)) throw new Error('该预览正在执行，请勿重复提交');
    executionLocks.add(previewId);
    try {
      const baseArgs = preview.baseArgs ?? preview.args.slice(0, -3);
      const action = {id: preview.action, label: preview.label, risk: 'write', file: preview.input.file};
      const executed = await executeBuilt({
        action,
        args: baseArgs,
        data: preview.input.data,
        input: preview.input,
        mode: 'execute',
        fingerprint: preview.fingerprint,
        parentId: preview.id,
      });
      preview.executionId = executed.id;
      preview.updatedAt = new Date().toISOString();
      await store.saveRun(preview);
      return executed;
    } finally {
      executionLocks.delete(previewId);
    }
  }

  async function runWorkflow(kind, input) {
    const context = input.context ?? {};
    const range = {start_date: input.start_date || '', end_date: input.end_date || ''};
    const comparisonRange = kind === 'operations' ? previousPeriodRange(range) : null;
    const queryRange = Object.fromEntries(Object.entries(range).filter(([, value]) => Boolean(value)));
    const currentMetrics = [
      ['pv', '商店页访问'], ['download', '下载'], ['reserve', '预约'], ['review', '评价趋势'], ['topic', '社区帖子'],
    ].map(([metric, label]) => ['stats.metric', {metric, ...queryRange}, label, 'current']);
    const previousMetrics = comparisonRange ? [
      ['pv', '前周期商店页访问'], ['download', '前周期下载'], ['reserve', '前周期预约'], ['topic', '前周期社区帖子'],
    ].map(([metric, label]) => ['stats.metric', {metric, ...comparisonRange}, label, 'previous']) : [];
    const specs = kind === 'release'
      ? [
          ['auth.status', {}, '登录状态'],
          ['app.status', {}, '上架完整度'],
          ['app.packages', {}, '包体候选与绑定'],
          ['package.overview', {}, '包体与自测'],
          ['app.module.basic', {module_id: 'basic-info'}, '基础资料'],
          ['app.module.assets', {module_id: 'assets-upload'}, '图片与视频'],
          ['app.module.platform', {module_id: 'platform-status'}, '平台与分发'],
          ['app.module.release', {module_id: 'release-settings'}, '发布设置'],
          ['qualification.status', {}, '资质状态'],
          ['test.overview', {}, '测试计划'],
          ['app.versions', {}, '版本历史'],
        ]
      : [
          ...currentMetrics,
          ...previousMetrics,
          ['stats.forum', {type: ['forum_pv', 'forum_uv', 'content_create', 'comment_create'], ...queryRange}, '论坛趋势', 'current'],
          ['feedback.reviews', {score: 'negative', page: 1, page_size: 50, order: 'update'}, '近期差评正文（默认近一个月）', 'current'],
        ];
    // Validate the shared context before starting a multi-request workflow.
    buildActionArgs({action: specs[1][0], context, data: specs[1][1]}, root);
    const entries = [];
    for (const [action, data, label, period = 'current'] of specs) {
      const run = await runAction({action, context, data});
      entries.push({label, action, runId: run.id, params: data, period, result: run.result});
    }
    const createdAt = new Date().toISOString();
    const id = newReportId();
    const markdown = kind === 'release'
      ? releaseMarkdown({context, entries, createdAt})
      : operationsMarkdown({context, range, comparisonRange, entries, createdAt});
    const report = await store.saveReport(id, markdown, {kind, context, range, comparisonRange, entries, createdAt});
    return {...report, kind, range, comparisonRange, entries};
  }

  return {runAction, confirmExecute, runWorkflow};
}
