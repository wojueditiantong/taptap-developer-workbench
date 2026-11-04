import {summarizeOperations} from './operations.mjs';

const SVG = 'http://www.w3.org/2000/svg';
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function number(value, digits = 0) {
  return value == null ? '—' : Number(value).toLocaleString('zh-CN', {maximumFractionDigits: digits});
}
function comparisonBadge(value) {
  const badge = node('span', `trend-comparison ${value?.tone === 'down' ? 'down' : ''}`, value?.label || '暂无前周期对比');
  return badge;
}
function chart(points, label, color, comparison = null) {
  const card = node('article', 'trend-card');
  const head = node('div', 'trend-heading');
  const copy = node('div'); copy.append(node('strong', '', label));
  if (comparison) copy.append(comparisonBadge(comparison));
  head.append(copy, node('span', '', points.length ? `期末 ${number(points.at(-1).value)}` : '未读取'));
  card.append(head);
  if (!points.length) { card.append(node('p', 'chart-empty', '本次没有读到每日趋势')); return card; }
  const width = 520, height = 180, left = 18, right = 18, top = 18, bottom = 34;
  const max = Math.max(1, ...points.map(point => point.value));
  const x = index => left + index * (width - left - right) / Math.max(1, points.length - 1);
  const y = value => top + (max - value) / max * (height - top - bottom);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${label}每日趋势，最高 ${max}`);
  for (const ratio of [0, .5, 1]) {
    const line = document.createElementNS(SVG, 'line');
    line.setAttribute('x1', left); line.setAttribute('x2', width - right);
    line.setAttribute('y1', top + ratio * (height - top - bottom)); line.setAttribute('y2', top + ratio * (height - top - bottom));
    line.setAttribute('class', 'chart-grid'); svg.append(line);
  }
  const coordinates = points.map((point, index) => `${x(index)},${y(point.value)}`).join(' ');
  const area = document.createElementNS(SVG, 'polygon');
  area.setAttribute('points', `${left},${height - bottom} ${coordinates} ${x(points.length - 1)},${height - bottom}`);
  area.setAttribute('fill', color); area.setAttribute('opacity', '.09'); svg.append(area);
  const line = document.createElementNS(SVG, 'polyline');
  line.setAttribute('points', coordinates); line.setAttribute('fill', 'none'); line.setAttribute('stroke', color); line.setAttribute('stroke-width', '3'); line.setAttribute('stroke-linejoin', 'round'); line.setAttribute('stroke-linecap', 'round'); svg.append(line);
  points.forEach((point, index) => {
    const dot = document.createElementNS(SVG, 'circle');
    dot.setAttribute('cx', x(index)); dot.setAttribute('cy', y(point.value)); dot.setAttribute('r', '4'); dot.setAttribute('fill', color); svg.append(dot);
    const title = document.createElementNS(SVG, 'title'); title.textContent = `${point.timestamp}：${point.value}`; dot.append(title);
  });
  for (const [index, position] of [[0, 'start'], [points.length - 1, 'end']]) {
    const text = document.createElementNS(SVG, 'text');
    text.setAttribute('x', x(index)); text.setAttribute('y', height - 8); text.setAttribute('text-anchor', position); text.setAttribute('class', 'chart-label'); text.textContent = points[index].timestamp.slice(5); svg.append(text);
  }
  card.append(svg);
  return card;
}

export function renderOperationsReport(target, report, {onNavigate = () => {}} = {}) {
  const summary = summarizeOperations(report.entries);
  target.innerHTML = '';
  const header = node('header', 'weekly-header');
  const title = node('div'); title.append(node('p', 'eyebrow', 'PERFORMANCE ANALYSIS'), node('h3', '', '本期经营分析'), node('p', '', `${report.range.start_date} — ${report.range.end_date}`));
  const badge = node('span', `report-health ${summary.warnings.length ? 'partial' : ''}`, `${summary.succeeded}／${summary.total} 组数据已更新`);
  header.append(title, badge); target.append(header);
  const range = node('div', 'comparison-strip');
  range.append(node('span', '', '本期与前周期使用相同天数和相同指标口径；不把首日与期末的变化冒充环比。'));
  const rangeRight = node('span'); rangeRight.append(node('strong', '', report.comparisonRange ? '对比区间　' : '对比状态　'), document.createTextNode(report.comparisonRange ? `${report.comparisonRange.start_date} — ${report.comparisonRange.end_date}` : '未提供'));
  range.append(rangeRight); target.append(range);
  const kpis = node('div', 'kpi-grid');
  for (const kpi of summary.kpis) {
    const card = node('article', `kpi-card ${kpi.key}`);
    card.append(node('span', '', kpi.label), node('strong', '', number(kpi.value, kpi.digits)), node('small', '', kpi.note), node('small', `comparison-note ${kpi.comparison?.tone || 'neutral'}`, kpi.comparison?.label || '暂无前周期对比')); kpis.append(card);
  }
  target.append(kpis);
  const decisions = node('section', 'decision-section');
  const decisionHead = node('div', 'decision-heading');
  const decisionCopy = node('div'); decisionCopy.append(node('h3', '', '本期经营建议'), node('p', '', '基于本期数据的排查建议，不把相关性当成原因'));
  decisionHead.append(decisionCopy, node('span', '', `${summary.actions.length} 项分析结论`)); decisions.append(decisionHead);
  const decisionGrid = node('div', 'decision-grid');
  for (const action of summary.actions) {
    const interactive = action.target && typeof onNavigate === 'function';
    const card = node(interactive ? 'button' : 'article', `decision-card ${action.kind}`);
    if (interactive) { card.type = 'button'; card.addEventListener('click', () => onNavigate(action.target)); }
    card.append(node('span', 'decision-icon', action.icon));
    const copy = node('div'); copy.append(node('strong', '', action.title), node('p', '', action.detail));
    if (action.action) copy.append(node('em', '', `${action.action} →`));
    card.append(copy); decisionGrid.append(card);
  }
  decisions.append(decisionGrid); target.append(decisions);
  const charts = node('div', 'trend-grid');
  charts.append(
    chart(summary.visitTrend, '商店页访问趋势', '#00acd0', summary.kpis.find(item => item.key === 'visits')?.comparison),
    chart(summary.downloadTrend, '新增下载请求趋势', '#7168d8', summary.kpis.find(item => item.key === 'downloads')?.comparison),
    chart(summary.topicTrend, '社区新帖趋势', '#30b894', summary.kpis.find(item => item.key === 'topics')?.comparison),
  );
  if (summary.forum) charts.lastElementChild.append(node('p', 'forum-note', `论坛全量快照：${number(summary.forum.followers)} 位关注者 · ${number(summary.forum.contentTotal)} 条未删除内容。本周期新增内容 ${number(summary.forum.posts)}，回复 ${number(summary.forum.replies)}。`));
  target.append(charts);
  if (summary.referenceRate) {
    const reference = node('article', 'reference-panel');
    const copy = node('div'); copy.append(node('h3', '', '访问—下载参考比'), node('p', '', '同周期下载请求量 ÷ 商店页 PV，仅用于观察相对变化；不是官方归因转化率，也不是实际安装率。'));
    const value = node('div', 'reference-value'); value.append(node('strong', '', `${summary.referenceRate.value.toFixed(2)}%`), node('span', '', summary.referenceRate.previous == null ? '暂无前周期参考值' : `前周期 ${summary.referenceRate.previous.toFixed(2)}%`));
    reference.append(copy, value); target.append(reference);
  }
  const detailGrid = node('div', 'weekly-detail-grid');
  const sourceCard = node('article', 'weekly-panel');
  sourceCard.append(node('h3', '', '访问从哪里来'), node('p', 'panel-caption', '占比以已识别来源分项合计为分母，不等于总 PV 占比'));
  for (const source of summary.sources) {
    const row = node('div', 'source-row');
    row.append(node('span', '', source.label), node('strong', '', number(source.value)), node('small', '', `来源分项占比 ${source.share.toFixed(1)}%`));
    const track = node('div', 'source-track'); const bar = node('i'); bar.style.width = `${source.percent}%`; track.append(bar); row.append(track); sourceCard.append(row);
  }
  if (!summary.sources.length) sourceCard.append(node('p', 'chart-empty', '暂无来源分项'));
  const insights = node('article', 'weekly-panel insight-panel');
  insights.append(node('h3', '', '数据观察'));
  const list = node('ul', 'insight-list');
  for (const text of summary.insights) list.append(node('li', '', text));
  if (!summary.insights.length) list.append(node('li', '', '本次没有足够数据生成观察，请先处理数据缺口。'));
  insights.append(list); detailGrid.append(sourceCard, insights); target.append(detailGrid);
  const reviewPanel = node('article', 'weekly-panel feedback-panel');
  const reviewHead = node('div', 'weekly-panel-heading'); reviewHead.append(node('h3', '', '玩家问题'), node('span', '', `本次读取 ${summary.negativeReviews.length} 条差评`)); reviewPanel.append(reviewHead);
  if (summary.reviewThemes.length) {
    const themes = node('div', 'feedback-themes');
    for (const theme of summary.reviewThemes) themes.append(node('span', '', `${theme.label} · ${theme.count} 条线索`));
    reviewPanel.append(themes, node('p', 'panel-caption', '按关键词归类，仅供人工排查；一条评价可能命中多个主题。'));
  }
  for (const review of summary.negativeReviews.slice(0, 5)) {
    const item = node('article', 'weekly-review');
    const meta = node('div', 'weekly-review-meta'); meta.append(node('span', 'stars', `${'★'.repeat(review.score)}${'☆'.repeat(Math.max(0, 5 - review.score))}`), node('span', `reply-status ${review.replied ? 'replied' : ''}`, review.replied ? '已官方回复' : '待关注'));
    item.append(meta, node('p', '', review.text), node('small', '', `${review.device} · ${review.played}`)); reviewPanel.append(item);
  }
  if (!summary.negativeReviews.length) reviewPanel.append(node('p', 'chart-empty', '本次没有读到差评正文'));
  target.append(reviewPanel);
  if (summary.warnings.length) {
    const warning = node('details', 'data-warning');
    warning.append(node('summary', '', `${summary.warnings.length} 组数据未更新，查看原因`));
    for (const item of summary.warnings) warning.append(node('p', '', `${item.label}：${item.message}`));
    target.append(warning);
  }
  const footer = node('div', 'report-links');
  const markdown = node('a', 'button secondary', '阅读完整分析报告'); markdown.href = report.markdownUrl;
  const data = node('a', 'button ghost', '官方原始数据'); data.href = report.dataUrl;
  footer.append(markdown, data); target.append(footer);
}
