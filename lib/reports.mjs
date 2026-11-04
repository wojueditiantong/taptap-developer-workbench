function resultSummary(result) {
  if (!result) return '未执行';
  if (result.ok) return '读取成功';
  const error = result.error;
  return [error?.type, error?.subtype, error?.hint].filter(Boolean).join(' · ') || '读取失败';
}

export function releaseMarkdown({context, entries, createdAt}) {
  const ok = entries.filter(entry => entry.result?.ok).length;
  return [
    '# TapTap 上架体检',
    '',
    `- 生成时间：${createdAt}`,
    `- 开发者 ID：${context.devId}`,
    `- 游戏 ID：${context.appId}`,
    `- 只读检查：${ok}/${entries.length} 项成功返回`,
    '',
    '> 体检不会上传、保存草稿、提审或上线。某项失败时应先处理登录、权限或上下文问题；成功返回也不等于审核通过。',
    '',
    ...entries.flatMap(entry => [
      `## ${entry.label}`,
      '',
      `结果：${resultSummary(entry.result)}`,
      '',
      '```json',
      JSON.stringify(entry.result ?? {error: '未执行'}, null, 2),
      '```',
      '',
    ]),
  ].join('\n');
}
