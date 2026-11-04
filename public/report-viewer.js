import {renderOperationsReport} from './report-view.js';

const target = document.querySelector('#reportDocument');
const desktop = window.taptapDesktop;

function showError(message) {
  target.replaceChildren();
  const panel = document.createElement('section'); panel.className = 'report-load-error';
  const title = document.createElement('h2'); title.textContent = '报告暂时无法打开';
  const detail = document.createElement('p'); detail.textContent = message;
  const retry = document.createElement('button'); retry.className = 'button primary'; retry.textContent = '重新读取';
  retry.addEventListener('click', () => location.reload());
  panel.append(title, detail, retry); target.append(panel);
}

async function loadReport() {
  if (!desktop) throw new Error('请在 TapTap 桌面工作台中打开报告');
  const id = new URLSearchParams(location.search).get('report') || '';
  if (!/^report-[a-z0-9-]+$/.test(id)) throw new Error('报告编号无效');
  const response = await desktop.request(`/api/reports/${id}/data`);
  const report = JSON.parse(response.content);
  if (report.kind !== 'operations' || !Array.isArray(report.entries)) throw new Error('这份文件不是可展示的经营分析报告');
  renderOperationsReport(target, report, {onNavigate: null});
  document.querySelector('#reportCreatedAt').textContent = `保存于 ${new Date(report.createdAt).toLocaleString('zh-CN')} · 数据来自 TapTap 官方本次返回`;
  document.querySelector('#printReport').disabled = false;
}

document.querySelector('#printReport').addEventListener('click', () => window.print());
document.querySelector('#closeReport').addEventListener('click', () => window.close());
document.querySelector('#printReport').disabled = true;
loadReport().catch(error => showError(error.message));
