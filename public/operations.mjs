const payload = entry => entry?.result?.data?.result ?? {};
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const metricNumber = value => {
  if (value == null || value === '') return null;
  const parsed = Number(String(value).replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
};
const metricEntry = (entries, metric, period = 'current') => entries.find(entry => entry.params?.metric === metric && (entry.period || 'current') === period)
  ?? (period === 'current' ? entries.find(entry => !entry.period && ({'商店页访问': 'pv', '下载': 'download', '预约': 'reserve', '评价趋势': 'review', '社区帖子': 'topic'}[entry.label] === metric)) : undefined);
const highlights = entry => payload(entry).highlights ?? [];
const highlightValue = (entry, index = 0) => metricNumber(highlights(entry)[index]?.value);

export function previousPeriodRange(range) {
  if (!range?.start_date && !range?.end_date) return null;
  const parse = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new Error('经营分析需要完整的开始日期和结束日期');
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`无效日期：${value}`);
    return date;
  };
  const start = parse(range.start_date);
  const end = parse(range.end_date);
  const days = Math.round((end - start) / 86400000) + 1;
  if (days < 1) throw new Error('开始日期不能晚于结束日期');
  if (days > 366) throw new Error('单次经营分析最长支持 366 天');
  const previousEnd = new Date(start.getTime() - 86400000);
  const previousStart = new Date(previousEnd.getTime() - (days - 1) * 86400000);
  const local = date => date.toISOString().slice(0, 10);
  return {start_date: local(previousStart), end_date: local(previousEnd)};
}

function trendFor(entry, key) {
  return (payload(entry).series ?? []).map(point => ({timestamp: point.timestamp, value: number(point.values?.[key])}));
}

function comparison(current, previous) {
  if (current == null || previous == null) return {percent: null, label: '暂无前周期对比', tone: 'neutral'};
  if (previous === 0) return {percent: null, label: current === 0 ? '前周期同为 0' : '前周期为 0，不计算增幅', tone: 'neutral'};
  const percent = (current - previous) / Math.abs(previous) * 100;
  return {percent, label: `较前周期 ${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`, tone: percent > 0 ? 'up' : percent < 0 ? 'down' : 'neutral'};
}

function kpi(entries, key, label, metric, note, digits = 0, highlightIndex = 0) {
  const entry = metricEntry(entries, metric);
  const previous = metricEntry(entries, metric, 'previous');
  const value = highlightValue(entry, highlightIndex);
  return {key, label, value, note, digits, comparison: comparison(value, highlightValue(previous, highlightIndex))};
}

const REVIEW_THEMES = [
  {label: '性能与稳定性', pattern: /闪退|崩溃|卡顿|掉帧|发热|黑屏|白屏|卡死|性能|加载|流畅/},
  {label: '操作与界面', pattern: /字体|界面|UI|操作|按键|手柄|地图|看不清|适配|分辨率|屏幕/i},
  {label: '网络与连接', pattern: /网络|断线|掉线|延迟|连接|服务器|联机/},
  {label: '玩法与内容', pattern: /玩法|剧情|关卡|角色|内容|任务|难度|平衡|更新|无聊/},
  {label: '付费与商业化', pattern: /付费|氪金|价格|退款|广告|内购|买断|充值/},
  {label: '账号与服务', pattern: /账号|登录|登陆|客服|存档|封号|验证码/},
];

function analyzeReviews(entry) {
  const reviews = (payload(entry).list ?? []).map(review => ({
    id: review.review_id, score: number(review.score), text: review.contents || '（无正文）',
    device: review.device || '设备未展示', played: review.played_tips || '时长未展示',
    replied: Boolean(review.has_official_comment), url: review.url,
  }));
  const themes = REVIEW_THEMES.map(theme => ({label: theme.label, count: reviews.filter(review => theme.pattern.test(review.text)).length}))
    .filter(theme => theme.count).sort((a, b) => b.count - a.count);
  return {reviews, themes};
}

function forumSummary(entries) {
  const entry = entries.find(item => item.action === 'stats.forum' && (item.period || 'current') === 'current');
  if (!entry?.result?.ok) return null;
  const data = payload(entry);
  const value = type => {
    const block = (data.results ?? []).find(item => item.type === type);
    const key = block?.columns?.[0]?.key;
    return key ? number(block.summary?.[key]) : 0;
  };
  return {followers: metricNumber(data.follow_total), contentTotal: metricNumber(data.content_total), posts: value('content_create'), replies: value('comment_create')};
}

export function summarizeOperations(entries) {
  const visits = metricEntry(entries, 'pv');
  const downloads = metricEntry(entries, 'download');
  const reviews = metricEntry(entries, 'review');
  const topics = metricEntry(entries, 'topic');
  const reserves = metricEntry(entries, 'reserve');
  const visitData = payload(visits);
  const reviewData = payload(reviews);
  const reviewSeries = reviewData.series ?? [];
  const latestScore = reviewSeries.at(-1)?.values?.score;
  const sourceTotals = new Map();
  for (const point of visitData.series ?? []) {
    for (const [key, value] of Object.entries(point.values ?? {})) {
      if (key !== 'pv_from_total') sourceTotals.set(key, (sourceTotals.get(key) ?? 0) + number(value));
    }
  }
  const labels = Object.fromEntries((visitData.columns ?? []).map(column => [column.key, column.label || column.key]));
  const sourceMax = Math.max(1, ...sourceTotals.values());
  const sourceTotal = [...sourceTotals.values()].reduce((sum, value) => sum + value, 0);
  const sources = [...sourceTotals.entries()].map(([key, value]) => ({label: labels[key] || key, value, percent: Math.round(value / sourceMax * 100), share: sourceTotal ? value / sourceTotal * 100 : 0}))
    .filter(item => item.value > 0).sort((a, b) => b.value - a.value).slice(0, 6);
  const feedback = analyzeReviews(entries.find(entry => entry.action === 'feedback.reviews'));
  const negativeReviews = feedback.reviews;
  const visitTrend = trendFor(visits, 'pv_from_total');
  const downloadTrend = trendFor(downloads, 'all_download_new');
  const topicTrend = trendFor(topics, 'topic');
  const peak = visitTrend.reduce((best, point) => point.value > (best?.value ?? -1) ? point : best, null);
  const kpis = [
    kpi(entries, 'visits', '商店页访问', 'pv', '本周期官方汇总'),
    kpi(entries, 'downloads', '新增下载请求', 'download', highlights(downloads)[1] ? `平台处理后 ${metricNumber(highlights(downloads)[1]?.value)?.toLocaleString('zh-CN') ?? '—'}` : '本周期官方汇总'),
    kpi(entries, 'topics', '社区新帖', 'topic', '本周期官方汇总'),
    kpi(entries, 'score', '期末玩家评分', 'review', `好评 ${highlights(reviews)[0]?.value ?? '—'} · 差评 ${highlights(reviews)[2]?.value ?? '—'}`, 1),
    kpi(entries, 'reserve', '新增预约', 'reserve', '本周期官方汇总'),
  ];
  kpis.find(item => item.key === 'score').value = latestScore ?? null;
  kpis.find(item => item.key === 'score').comparison = {percent: null, label: '期末评分快照', tone: 'neutral'};
  const visitsNow = highlightValue(visits);
  const downloadsNow = highlightValue(downloads);
  const visitsBefore = highlightValue(metricEntry(entries, 'pv', 'previous'));
  const downloadsBefore = highlightValue(metricEntry(entries, 'download', 'previous'));
  const referenceRate = visitsNow > 0 && downloadsNow != null ? {
    value: downloadsNow / visitsNow * 100,
    previous: visitsBefore > 0 && downloadsBefore != null ? downloadsBefore / visitsBefore * 100 : null,
  } : null;
  const forum = forumSummary(entries);
  const insights = [];
  if (kpis[0].comparison.percent != null) insights.push(`商店页访问较前一周期${kpis[0].comparison.percent >= 0 ? '增加' : '减少'} ${Math.abs(kpis[0].comparison.percent).toFixed(1)}%，对比区间长度相同。`);
  if (peak) insights.push(`访问峰值出现在 ${peak.timestamp}，当日 ${peak.value.toLocaleString('zh-CN')} 次。`);
  if (visitTrend.length > 1 && visitTrend[0].value) {
    const change = (visitTrend.at(-1).value - visitTrend[0].value) / visitTrend[0].value * 100;
    insights.push(`期末日访问较本周期首日${change >= 0 ? '增加' : '减少'} ${Math.abs(change).toFixed(1)}%，不代表同比或环比。`);
  }
  const unreplied = negativeReviews.filter(review => !review.replied).length;
  if (negativeReviews.length) insights.push(`本次读取 ${negativeReviews.length} 条差评，其中 ${unreplied} 条尚无官方回复。`);
  if (forum) insights.push(`论坛当前共有 ${forum.followers ?? '—'} 位关注者、${forum.contentTotal ?? '—'} 条未删除内容；这是全量快照，不计入本周期新增。`);
  const actions = [];
  if (unreplied) actions.push({kind: 'attention', icon: '评', title: `${unreplied} 条差评仍待人工关注`, detail: `先复核问题是否可复现、是否已有修复计划，再人工回复；工作台不会自动向玩家发言。${feedback.themes[0] ? `本期差评审阅线索以“${feedback.themes[0].label}”居多。` : ''}`, target: 'reviews', action: '查看玩家声音'});
  const visitChange = kpis[0].comparison.percent;
  if (visitChange != null && visitChange <= -10) actions.push({kind: 'attention', icon: '↘', title: `访问较前周期下降 ${Math.abs(visitChange).toFixed(1)}%`, detail: `优先核对主要来源是否同步回落，再检查近期版本、商店素材和社区承接；仅凭汇总数据不能确定原因。`});
  if (visitChange != null && visitChange >= 10) actions.push({kind: 'positive', icon: '↗', title: `访问较前周期增长 ${visitChange.toFixed(1)}%`, detail: `${sources[0] ? `当前最大来源分项是“${sources[0].label}”。` : ''}把增长期间的更新、发帖和外部活动记录下来，便于后续复盘，但不要把时间重合直接当成因果。`});
  if (referenceRate?.previous != null && referenceRate.value - referenceRate.previous <= -1) actions.push({kind: 'attention', icon: '转', title: '访问—下载参考比走弱', detail: `本期 ${referenceRate.value.toFixed(2)}%，前周期 ${referenceRate.previous.toFixed(2)}%。建议复核商店首屏、真实截图与包体信息；该比值不是官方归因转化率。`});
  if (sources[0]?.share >= 70) actions.push({kind: 'next', icon: '源', title: '访问来源较集中', detail: `“${sources[0].label}”占已识别来源分项合计 ${sources[0].share.toFixed(1)}%。保持现有承接的同时，可结合搜索与社区内容优化，避免只依赖单一入口。`});
  if (highlightValue(topics) === 0) actions.push({kind: 'next', icon: '帖', title: '本周期没有读到社区新帖', detail: '如果有真实版本进展，可以用模板整理一篇更新说明；没有可验证内容时，不必为了数量发帖。', target: 'template', action: '使用版本更新模板'});
  if (!actions.length && highlightValue(topics) > 0) actions.push({kind: 'next', icon: '帖', title: '把本期进展沉淀给玩家', detail: `本周期读到 ${highlightValue(topics)} 条社区新帖。可以结合玩家反复询问的问题，准备下一篇有事实依据的版本公告。`, target: 'template', action: '使用版本更新模板'});
  if (!actions.length) actions.push({kind: 'next', icon: '看', title: '先补齐可读数据', detail: '目前缺少足够的同口径数据形成趋势建议。先处理下方数据缺口，再重新生成经营分析。'});
  return {
    kpis, sources, insights, actions: actions.slice(0, 3), negativeReviews, reviewThemes: feedback.themes, referenceRate, forum,
    visitTrend, downloadTrend, topicTrend,
    warnings: entries.filter(entry => !entry.result?.ok).map(entry => ({label: entry.label, message: entry.result?.error?.hint || entry.result?.error?.message || '读取失败'})),
    succeeded: entries.filter(entry => entry.result?.ok).length, total: entries.length,
  };
}

export function operationsMarkdown({context, range, comparisonRange = null, entries, createdAt}) {
  const summary = summarizeOperations(entries);
  const format = value => value == null ? '未读取' : Number(value).toLocaleString('zh-CN');
  const lines = [
    '# TapTap 经营分析报告', '', `- 生成时间：${createdAt}`,
    `- 开发者 ID：${context.devId}`, `- 游戏 ID：${context.appId}`,
    `- 数据范围：${range.start_date || '平台默认'} 至 ${range.end_date || '平台默认'}`,
    ...(comparisonRange ? [`- 对比范围：${comparisonRange.start_date} 至 ${comparisonRange.end_date}`] : []), '',
    `> ${summary.succeeded}/${summary.total} 组数据成功返回。所有数值来自官方本次响应，失败项不以历史值补齐。`, '',
    '## 本期概览', '', '| 指标 | 数值 | 口径 |', '| --- | ---: | --- |',
    ...summary.kpis.map(kpi => `| ${kpi.label} | ${format(kpi.value)} | ${kpi.comparison?.label || kpi.note} |`), '',
    '## 经营诊断与建议', '', ...summary.actions.map(action => `### ${action.title}\n\n${action.detail}\n`), '',
    '## 本期观察', '', ...summary.insights.map(text => `- ${text}`), '',
  ];
  if (summary.referenceRate) lines.push('## 访问—下载参考比', '', `本期为 ${summary.referenceRate.value.toFixed(2)}%${summary.referenceRate.previous == null ? '' : `，前一周期为 ${summary.referenceRate.previous.toFixed(2)}%`}。这是同周期下载请求量除以商店页 PV 的参考比值，不是官方归因转化率或实际安装率。`, '');
  lines.push('## 商店访问来源', '', '| 来源 | 本期分项合计 | 来源分项占比 |', '| --- | ---: | ---: |',
    ...summary.sources.map(source => `| ${source.label} | ${source.value.toLocaleString('zh-CN')} | ${source.share.toFixed(1)}% |`), '',
    '## 每日趋势', '', '| 日期 | 商店页访问 | 新增下载请求 | 社区新帖 |', '| --- | ---: | ---: | ---: |',
    ...summary.visitTrend.map((point, index) => `| ${point.timestamp} | ${point.value} | ${summary.downloadTrend[index]?.value ?? '未读取'} | ${summary.topicTrend[index]?.value ?? '未读取'} |`), '',
    '## 近期差评', '');
  if (summary.reviewThemes.length) lines.push('主题按关键词归类，仅作人工排查线索，一条评价可能命中多个主题。', '', ...summary.reviewThemes.map(theme => `- ${theme.label}：${theme.count} 条`), '');
  lines.push(...summary.negativeReviews.flatMap(review => [`### ${review.score} 星 · ${review.replied ? '已回复' : '待关注'}`, '', review.text, '', `- ${review.device} · ${review.played}`, '']),
    '## 数据缺口', '', ...(summary.warnings.length ? summary.warnings.map(item => `- ${item.label}：${item.message}`) : ['- 无']), '',
    '<details><summary>官方原始返回（附录）</summary>', '');
  for (const entry of entries) lines.push(`### ${entry.label}`, '', '```json', JSON.stringify(entry.result ?? {error: '未执行'}, null, 2), '```', '');
  lines.push('</details>', '');
  return lines.join('\n');
}
