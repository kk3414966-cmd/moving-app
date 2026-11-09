import * as db from './store.js';
import { parseLine, summarize, ymd, BANKS, DEFAULT_CODES } from './parser.js';
import * as L from './ledger.js';
import { aiReady, askClaude, itemsToParsed } from './ai.js';
import * as F from './files.js';
import * as G from './gmail.js';
import * as CAL from './calendar.js';
import * as AV from './availability.js';
import { mountQuotes } from './quotes.js';
import { openSiteCms } from './sitecms.js';
const { evTitle, txLabel } = CAL;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => (+n < 0 ? '-$' : '$') + Math.abs(Math.round(+n || 0)).toLocaleString('zh-TW');
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const today = () => ymd(new Date());
const md = d => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
const ymAdd = (ym, n) => { const [y, m] = ym.split('-').map(Number); return ymd(new Date(y, m - 1 + n, 1)).slice(0, 7); };

const state = { tab: 'chat', calYm: today().slice(0, 7), calMode: 'month', selDay: today(), statsYm: today().slice(0, 7), pending: null, busy: '' };

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

// ================= 對話框 =================
// 右邊是我打的字，左邊是 App 記成什麼（顏色跟行事曆標籤一樣）
const hhmm = iso => { const d = new Date(iso); return isNaN(d) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const dayLabel = d => d === today() ? '今天' : d === ymd(new Date(Date.now() - 864e5)) ? '昨天' : `${md(d)}（${WEEK[new Date(d + 'T00:00:00').getDay()]}）`;

function recCard({ col, rec }) {
  const when = `${md(rec.date)}${rec.time ? ' ' + rec.time : ''}`;
  if (col === 'events') {
    const color = L.labelOf(L.eventLabel(rec)).color, late = rec.type === 'job' && !rec.done && rec.date < today();
    const tag = rec.type === 'job' ? `<span class="tag ${rec.done ? 'ok' : 'warn'}">${rec.done ? '已完成' : late ? '未記收入' : '待完成'}</span>` : '';
    return `<div class="rec ${late ? 'late' : ''}" data-ev="${rec.id}" style="--c:${color}">
      <span class="ico">${rec.type === 'job' ? '🚚' : '📅'}</span>
      <div class="rec-main"><b>${esc(evTitle(rec))}</b><small>${rec.type === 'job' ? '工作' : '行程'}・${when}${rec.note ? '・有備註' : ''}</small></div>${tag}</div>`;
  }
  const color = L.labelOf(L.txLabelId(rec)).color, sign = rec.type === 'income' ? '+' : rec.type === 'expense' ? '−' : '⇄';
  const acc = rec.type === 'transfer' ? '繳' + rec.to : rec.account || '現金';
  return `<div class="rec" data-edit="transactions:${rec.id}" style="--c:${color}">
    <span class="ico">${rec.type === 'income' ? '💰' : rec.type === 'transfer' ? '💳' : '🧾'}</span>
    <div class="rec-main"><b>${esc(rec.category)}${rec.note && rec.note !== rec.category ? `<em>${esc(rec.note)}</em>` : ''}</b>
      <small>${esc(acc)}・${rec.biz === '公' ? '公帳' : '私帳'}・${when}</small></div>
    <span class="rec-amt ${rec.type}">${sign}${money(rec.amount).replace('-', '')}</span></div>`;
}

function chatPanel() {
  const s = L.monthStats(today().slice(0, 7)), bills = L.cardBills(today().slice(0, 7)), evs = L.eventsOn(today());
  return `<aside class="side">
    <div class="side-card"><h4>今天 ${md(today())}（${WEEK[new Date().getDay()]}）</h4>
      ${evs.map(e => `<div class="side-ev" data-ev="${e.id}" style="--c:${L.labelOf(L.eventLabel(e)).color}"><span>${e.time || '全天'}</span>${esc(evTitle(e))}</div>`).join('') || '<p class="muted">今天沒有行程</p>'}</div>
    <div class="side-card" data-go="stats"><h4>這個月</h4>
      <div class="kv"><span>工作收入</span><b class="g">${money(s.workIncome)}</b></div>
      <div class="kv"><span>工作淨利</span><b>${money(s.workNet)}</b></div>
      <div class="kv"><span>個人花費</span><b class="r">${money(s.personal)}</b></div>
      <div class="kv"><span>本月卡費</span><b>${money(bills.total)}</b></div></div>
  </aside>`;
}

function chatView() {
  const ym = today().slice(0, 7), bills = L.cardBills(ym), d = +today().slice(8);
  const unpaid = BANKS.filter(b => bills.bills[b] > 0 && bills.paidBy[b] < bills.bills[b]);
  const open = L.monthStats(ym).openJobs.length + L.monthStats(ymAdd(ym, -1)).openJobs.length;
  const banners = [];
  if (d <= 10 && unpaid.length) banners.push(`<div class="banner" data-go="stats">💳 本月要繳卡費 ${money(bills.total)}（${unpaid.map(b => `${b} ${money(bills.bills[b])}`).join('、')}）</div>`);
  if (open) banners.push(`<div class="banner warn" data-go="cal">⚠ 有 ${open} 筆過去的工作還沒記收入</div>`);
  // 同一句話記出來的幾筆放在一起
  const groups = [];
  for (const it of L.recent(60)) {
    const g = groups[groups.length - 1], key = `${it.rec.raw || it.rec.id}|${(it.rec.createdAt || '').slice(0, 16)}`;
    if (g && g.key === key) g.items.push(it); else groups.push({ key, raw: it.rec.raw, at: it.rec.createdAt, items: [it] });
  }
  let lastDay = '';
  const log = groups.map(g => {
    const day = g.at ? ymd(new Date(g.at)) : '';
    const sep = day && day !== lastDay ? `<div class="day-sep"><span>${dayLabel(day)}</span></div>` : '';
    lastDay = day || lastDay;
    return `${sep}${g.raw ? `<div class="msg me"><div class="say">${esc(g.raw)}</div><time>${hhmm(g.at)}</time></div>` : ''}
      <div class="msg bot">${g.items.map(recCard).join('')}</div>`;
  }).join('');
  const examples = ['-120晚餐', '+500 回收紙箱', '1105 14:00 03.西屯太平0.3 王小明 賴', '老婆上課 1109、10、11'];
  return `<div class="chat-wrap"><div class="chat">${banners.join('')}
    <div id="log">${log || `<div class="welcome"><div class="w-ico">💬</div><h3>打一句話就記好了</h3><p class="muted">支出、收入、工作、行程都打在下面，按 Enter 存檔。點一點試試看：</p>
      <div class="ex">${examples.map(x => `<button data-prefill="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>`}</div>
    ${state.busy ? `<div class="msg bot"><div class="typing">${esc(state.busy)}</div></div>` : ''}</div>${chatPanel()}</div>`;
}

// 按 Enter 直接存檔，存完馬上出現在行事曆；要改就點那一筆
async function submitInput(text) {
  let p = parseLine(text, { categories: L.categories() });
  if (!p) return;
  if (p.kind === 'unknown') {
    if (aiReady()) {
      state.busy = 'Claude 解析中…'; render();
      try { const items = await askClaude('parse', text); p = items.length ? { ...itemsToParsed(text, items), dates: p.dates } : p; }
      catch (e) { toast(e.message); }
      state.busy = '';
    }
    if (p.kind === 'unknown') p.kind = 'event';
  }
  const saved = await L.saveParsed(p);
  const days = (p.dates || [p.date]).map(md).join('、');
  toast(saved.some(s => s.matched) ? '已找到這筆工作，標記完成' : `已記到 ${days}${p.event ? '' : '（' + summarize(p).split('｜').slice(0, 2).join(' ') + '）'}`);
  render();
}

// 行事曆在 calendar.js

// ================= 統計 =================
function bars(data, fmt = money) {
  const max = Math.max(1, ...data.map(d => Math.abs(d.v)));
  return `<div class="bars">${data.map(d => `<div class="bar"><span class="v">${fmt(d.v)}</span>
    <i style="height:${Math.round(Math.abs(d.v) / max * 100)}%" class="${d.v < 0 ? 'neg' : ''}"></i><span class="l">${esc(d.l)}</span></div>`).join('')}</div>`;
}
const PALETTE = ['#2f7de1', '#f08c2e', '#2bb673', '#9b59b6', '#e74c3c', '#16a5a5', '#d4a017', '#7f8c8d', '#c2185b', '#5d6d7e'];
// 滑鼠移上去（手機點一下）跳出細項：哪一天、買了什麼、多少；點細項可以改分類
const byDate = (a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''));
function tip(list) {
  const rows = list.slice().sort(byDate).map(t => `<div class="tip-row" data-edit="transactions:${t.id}">
    <span class="d">${md(t.date)}</span><span class="w">${esc(txTitle(t))}<small>${esc(t.category)}｜${esc(t.account || '現金')}</small></span>
    <b class="${t.type === 'income' ? 'g' : 'r'}">${money(t.amount)}</b></div>`).join('');
  return `<div class="tip">${rows ? `<div class="tip-h">${list.length} 筆・點一筆可以修改</div>${rows}` : '<p class="muted">沒有明細</p>'}</div>`;
}

function leadTip(evs, pick) {
  const nameOf = e => e.client || (e.title || '').replace(/^\s*\$?\d*\s*\d{1,2}\.\S+\s*/, '').trim() || '（沒名字）';
  const rows = evs.slice().sort(byDate).map(e => `<div class="tip-row" data-ev="${e.id}"><span class="d">${md(e.date)}</span><span class="w">${esc(nameOf(e))}<small>${esc(e.title || '')}</small></span>${pick ? `<select data-lead="${e.id}">${L.leadOptions('')}</select>` : `<b class="g">${e.done ? money(e.amount) : '未完成'}</b>`}</div>`).join('');
  return `<div class="tip"><div class="tip-h">${evs.length} 件・${pick ? '直接選客源就會存' : '點一筆可以看／修改'}</div>${rows}</div>`;
}

function donut(obj, lists = {}) {
  const entries = Object.entries(obj).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (!total) return '<p class="muted">這個月沒有資料</p>';
  let a = 0;
  const arcs = entries.map(([k, v], i) => {
    const a0 = a, a1 = a + v / total * Math.PI * 2; a = a1;
    const p = t => `${50 + 40 * Math.sin(t)},${50 - 40 * Math.cos(t)}`;
    if (entries.length === 1) return `<circle cx="50" cy="50" r="40" fill="none" stroke="${PALETTE[0]}" stroke-width="18"/>`;
    return `<path d="M${p(a0)} A40 40 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}" fill="none" stroke="${PALETTE[i % 10]}" stroke-width="18"/>`;
  }).join('');
  return `<div class="donut"><svg viewBox="0 0 100 100">${arcs}<text x="50" y="54" text-anchor="middle">${money(total)}</text></svg>
    <ul>${entries.map(([k, v], i) => `<li class="${lists[k] ? 'has-tip' : ''}"><i style="background:${PALETTE[i % 10]}"></i>${esc(k)}<b>${money(v)}</b><small>${Math.round(v / total * 100)}%</small>${lists[k] ? tip(lists[k]) : ''}</li>`).join('')}</ul></div>`;
}

// 統計分三頁：工作／個人／卡費；每一筆都能點回行事曆那一天
function txTitle(t) {
  const ev = t.eventId && db.get('events', t.eventId);
  return ev ? evTitle(ev) : (t.note || t.category);
}
function detailRows(list) {
  return list.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''))).map(t => `<tr data-day="${t.date}" class="link-row">
    <td>${md(t.date)}<small>（${WEEK[new Date(t.date + 'T00:00:00').getDay()]}）</small></td><td class="ttl">${esc(txTitle(t))}<small>${esc(t.category)}</small></td>
    <td class="${t.type === 'income' ? 'g' : 'r'}">${t.type === 'income' ? '+' : '-'}${money(t.amount)}</td></tr>`).join('');
}

function statsView() {
  db.ensureMonths(state.statsYm, 6); // 舊月份、近 6 個月趨勢：沒讀過的才去讀
  const ym = state.statsYm, s = L.monthStats(ym), code = L.codes(), bills = L.cardBills(ym), tab = state.statsTab || 'work';
  const trend = [-5, -4, -3, -2, -1, 0].map(n => { const m = ymAdd(ym, n); return { m, s: L.monthStats(m) }; });
  const txs = db.all('transactions').filter(t => t.date.slice(0, 7) === ym && t.type !== 'transfer');
  const head = `<div class="month-nav"><button data-stats="-1">‹</button><h2>${ym.replace('-', ' 年 ')} 月</h2><button data-stats="1">›</button></div>
    <div class="stab">${[['work', '工作'], ['personal', '個人'], ['card', '卡費']].map(([k, t]) => `<button data-stab="${k}" class="${tab === k ? 'on' : ''}">${t}</button>`).join('')}</div>`;

  if (tab === 'work') {
    const CAR = ['加油', '停車', '過路費', '租車', '車輛保養'];
    const wInc = txs.filter(t => t.biz === '公' && t.type === 'income'), wExp = txs.filter(t => t.biz === '公' && t.type === 'expense');
    const lHelper = wExp.filter(t => t.category === '幫手'), lCar = wExp.filter(t => CAR.includes(t.category));
    const lOther = wExp.filter(t => t.category !== '幫手' && !CAR.includes(t.category));
    const tot = l => l.reduce((a, t) => a + +t.amount, 0);
    const helper = tot(lHelper), car = tot(lCar), other = tot(lOther);
    const otherNames = [...new Set(lOther.map(t => t.category))].slice(0, 4).join('、') || '介紹費、收購、包材…';
    const frow = (label, v, list, cls) => `<tr class="has-tip"><td>${label}<span class="hint">ⓘ</span>${tip(list)}</td><td class="${cls}">${money(v)}</td></tr>`;
    // 每天：收入、成本、淨賺
    const days = {};
    for (const t of txs.filter(t => t.biz === '公')) {
      const d = days[t.date] ||= { inc: 0, cost: 0 };
      if (t.type === 'income') d.inc += +t.amount; else d.cost += +t.amount;
    }
    const mJobs = db.all('events').filter(e => e.type === 'job' && (e.date || '').slice(0, 7) === ym);
    const leadMap = {}; const leadMissingList = [];
    for (const e of mJobs) { if (!e.lead) { leadMissingList.push(e); continue; } const o = leadMap[e.lead] ||= { n: 0, sum: 0, evs: [] }; o.n++; o.evs.push(e); if (e.done) o.sum += +e.amount || 0; }
    const leadRows = Object.entries(leadMap).sort((a, b) => b[1].n - a[1].n);
    const svc = Object.entries(s.service).sort((a, b) => b[1].count - a[1].count);
    // 工作收入（搬家、清運…）和家具收入（二手家具賣出）分開算；加起來還是原本的總收入，淨利不變
    const lFurn = wInc.filter(t => t.category === '二手家具賣出'), lJob = wInc.filter(t => t.category !== '二手家具賣出');
    return `${head}
    <section><h3>淨利</h3>
      <table class="formula">
        ${frow('工作收入（搬家、清運…）', tot(lJob), lJob, 'g')}
        ${frow('＋ 家具收入（二手家具賣出）', tot(lFurn), lFurn, 'g')}
      </table>
      <table class="formula">
        ${frow('總收入（工作＋家具）', s.workIncome, wInc, 'g')}
        ${frow('－ 幫手', helper, lHelper, 'r')}
        ${frow('－ 車子（油錢、停車、過路費、修車）', car, lCar, 'r')}
        ${frow(`－ 其他成本（${esc(otherNames)}）`, other, lOther, 'r')}
        <tr class="total"><td>＝ 淨利（真正賺到的）</td><td>${money(s.workNet)}</td></tr>
      </table>
      <p class="muted">滑鼠移到每一行上（手機點一下）可以看細項。</p>
      <p class="muted">工作 ${s.jobs} 件（完成 ${s.jobsDone}）｜3.5 噸 ${s.truck['3.5']} 次、2.7 噸 ${s.truck['2.7']} 次</p>
    </section>
    <section><h3>每天明細 <small class="muted">點一下看那天的行事曆</small></h3>
      <table><tr><th>日期</th><th>收入</th><th>成本</th><th>淨賺</th></tr>
      ${Object.keys(days).sort().map(d => `<tr data-day="${d}" class="link-row"><td>${md(d)}<small>（${WEEK[new Date(d + 'T00:00:00').getDay()]}）</small></td>
        <td class="g">${days[d].inc ? money(days[d].inc) : ''}</td><td class="r">${days[d].cost ? money(days[d].cost) : ''}</td><td><b>${money(days[d].inc - days[d].cost)}</b></td></tr>`).join('') || '<tr><td colspan="4" class="muted">這個月沒有資料</td></tr>'}</table>
    </section>
    <section><h3>客源 <small class="muted">客人怎麼找到你（點行程→客源）</small></h3>
      <table><tr><th>客源</th><th>件數</th><th>已收金額</th></tr>
      ${leadRows.map(([k, v]) => `<tr class="has-tip"><td>${esc(k)}<span class="hint">ⓘ</span>${leadTip(v.evs)}</td><td>${v.n}</td><td>${v.sum ? money(v.sum) : '—'}</td></tr>`).join('')|| '<tr><td colspan="3" class="muted">這個月沒有工作</td></tr>'}</table>
      ${leadMissingList.length ? `<div class="has-tip muted lead-miss">還有 ${leadMissingList.length} 件沒填客源 <span class="hint">ⓘ</span>${leadTip(leadMissingList, true)}</div>` : ''}
    </section>
    <section><h3>服務項目</h3><table><tr><th>服務</th><th>次數</th><th>平均收</th></tr>
      ${svc.map(([k, v]) => `<tr><td>${esc(k)} ${esc(code[k] || '')}</td><td>${v.count}</td><td>${v.done ? money(v.total / v.done) : '—'}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">沒有工作</td></tr>'}</table>
      <h4>近 6 個月淨利</h4>${bars(trend.map(t => ({ l: +t.m.slice(5) + '月', v: t.s.workNet })))}
    </section>`;
  }

  if (tab === 'personal') {
    const pers = txs.filter(t => t.biz !== '公'), persExp = pers.filter(t => t.type === 'expense');
    const otherIncome = pers.filter(t => t.type === 'income').reduce((a, t) => a + +t.amount, 0);
    const group = (list, key) => list.reduce((m, t) => ((m[key(t)] ||= []).push(t), m), {});
    const byCat = group(persExp, t => t.category), byAcc = group(txs.filter(t => t.type === 'expense'), t => t.account || '現金');
    const left = s.workNet + otherIncome - s.personal;
    return `${head}
    <section><h3>這個月剩多少</h3>
      <table class="formula">
        <tr><td>工作淨利</td><td class="g">${money(s.workNet)}</td></tr>
        ${otherIncome ? `<tr><td>＋ 其他收入</td><td class="g">${money(otherIncome)}</td></tr>` : ''}
        <tr><td>－ 個人花費</td><td class="r">${money(s.personal)}</td></tr>
        <tr class="total"><td>＝ 這個月存下來</td><td>${money(left)}</td></tr>
      </table></section>
    <section><h3>個人花費 <small class="muted">滑鼠移上去（手機點一下）看細項</small></h3>${donut(s.personalBy, byCat)}
      <h4>付款方式</h4><table>${['現金', ...BANKS].map(a => `<tr class="has-tip"><td>${a}<span class="hint">ⓘ</span>${tip(byAcc[a] || [])}</td><td>${money(s.byAccount[a] || 0)}</td></tr>`).join('')}</table></section>
    <section><h3>明細 <small class="muted">點一下看那天的行事曆</small></h3><table>${detailRows(pers)}</table></section>
    <section><h4>近 6 個月個人花費</h4>${bars(trend.map(t => ({ l: +t.m.slice(5) + '月', v: t.s.personal })))}</section>`;
  }

  return `${head}
  <section><h3>本月要繳的卡費</h3><p class="muted">照銀行帳單上的「本期應繳」；還沒抓到帳單的標「估計」（用上個月刷的錢估）。</p>
    <table><tr><th>卡</th><th>應繳</th><th>截止日</th><th></th></tr>${BANKS.map(b => `<tr><td>${b}</td><td>${money(bills.bills[b])}${bills.estimated[b] ? '<small>估計</small>' : ''}</td>
      <td>${bills.dueDate[b] ? md(bills.dueDate[b]) : ''}</td><td>${bills.paidBy[b] ? '已繳 ' + money(bills.paidBy[b]) : ''}</td></tr>`).join('')}
      <tr class="total"><td>合計</td><td>${money(bills.total)}</td><td></td><td></td></tr></table>
    <p class="muted">繳完在對話框打「繳台新 12000」，會記成轉帳，不會重複算成花費。</p></section>
  <section><h3>刷卡明細 <small class="muted">點一下看那天的行事曆</small></h3>
    ${BANKS.map(b => { const l = db.all('transactions').filter(t => t.account === b && t.source === 'Gmail' && t.date.slice(0, 7) === bills.prev);
      return l.length ? `<h4>${b}（${bills.prev.replace('-', '/')} 月刷的）</h4><table>${detailRows(l)}</table>` : ''; }).join('') || '<p class="muted">還沒有從 Gmail 抓到刷卡紀錄</p>'}</section>`;
}

// ================= 修改視窗 =================
// 彈出視窗：點視窗外的空白處、或按手機的「返回」，都能關掉（返回靠 history 記一格）
let modalPushed = false, modalBacking = false;
function openModal(html) {
  const b = $('#modal-body'); b.onclick = b.onkeydown = b.onchange = null;
  b.innerHTML = html; $('#modal').classList.add('open');
  if (!modalPushed) { history.pushState({ modal: 1 }, ''); modalPushed = true; }
}
// 視窗最上面一條：標題＋右上角關閉，捲到哪裡都按得到
const modalHead = (title, back) => `<div class="modal-head">${back ? '<button class="icon-btn" data-back aria-label="回設定">‹</button>' : ''}<h3>${esc(title)}</h3><button class="icon-btn x" data-close aria-label="關閉">✕</button></div>`;
function closeModal() {
  $('#modal').classList.remove('open'); $('#modal-body').innerHTML = '';
  if (modalPushed) { modalPushed = false; modalBacking = true; history.back(); }
}
window.addEventListener('popstate', () => {
  if (modalBacking) { // 是我們自己關視窗時退的那一格；若剛好又開了新視窗，補回一格
    modalBacking = false;
    if ($('#modal').classList.contains('open')) { history.pushState({ modal: 1 }, ''); modalPushed = true; }
    return;
  }
  if (modalPushed) { modalPushed = false; $('#modal').classList.remove('open'); $('#modal-body').innerHTML = ''; } // 按返回
});
let downOnBackdrop = false; // 從視窗裡按下、拖到外面放開，不算點空白處
$('#modal').addEventListener('pointerdown', e => { downOnBackdrop = e.target === e.currentTarget; });
$('#modal').addEventListener('click', e => { if (e.target === e.currentTarget && downOnBackdrop) closeModal(); });

function editRecord(col, id, draft) {
  const r = draft || db.get(col, id);
  if (!r) return;
  const cats = L.categories(), accs = db.all('accounts').map(a => a.name);
  const opt = (list, v) => list.map(x => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const f = (label, name, v, type = 'text') => `<label>${label}<input name="${name}" type="${type}" value="${esc(v)}"></label>`;
  let body;
  if (col === 'events') body = `
    <label>類型<select name="type"><option value="job" ${r.type === 'job' ? 'selected' : ''}>工作</option><option value="event" ${r.type !== 'job' ? 'selected' : ''}>行程／記事</option></select></label>
    ${f('日期', 'date', r.date, 'date')}${f('時間', 'time', r.time, 'time')}${f('內容', 'title', r.title)}
    <fieldset class="jobonly"><legend>工作資料</legend>
      ${f('代號', 'codeRaw', r.codeRaw)}${f('起點', 'from', r.from)}${f('終點', 'to', r.to)}
      ${f('起點樓層', 'fromFloor', r.fromFloor)}${f('終點樓層', 'toFloor', r.toFloor)}${f('客戶', 'client', r.client)}${f('聯絡方式', 'contact', r.contact)}
      <label>客源（客人怎麼找到你）<select name="lead">${L.leadOptions(r.lead)}</select></label>
      <label class="check"><input type="checkbox" name="done" ${r.done ? 'checked' : ''}> 已完成</label>${f('實收金額', 'amount', r.amount || '', 'number')}
    </fieldset>
    <label>備註（完整內容）<textarea name="note" rows="6">${esc(r.note || '')}</textarea></label>`;
  else body = `
    <label>收支<select name="type">${[['expense', '支出'], ['income', '收入'], ['transfer', '繳卡費（轉帳）']].map(([v, t]) => `<option value="${v}" ${r.type === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    ${f('金額', 'amount', r.amount, 'number')}${f('日期', 'date', r.date, 'date')}${f('時間', 'time', r.time, 'time')}
    <label>分類<select name="category">${opt(cats.map(c => c.name).concat(['繳卡費']), r.category)}<option value="__new">＋ 新增分類…</option></select></label>
    <div class="add-row hide" id="newcat"><input id="newcat-name" placeholder="新分類的名稱，例如：淘寶"><button type="button" class="primary" id="newcat-ok">加入</button></div>
    ${draft ? '' : `<div class="sync hide" id="sync">
      <label class="check"><input type="checkbox" name="syncAll" checked> 名稱有「<input name="syncKey" class="inline" value="${esc((r.note || '').split(/[\s*]/)[0])}">」的消費全部一起改（<b id="sync-n">0</b> 筆）</label>
      <label class="check"><input type="checkbox" name="syncRule" checked> 以後抓到這種消費，自動用這個分類</label></div>`}
    <label>帳戶${r.type === 'transfer' ? '（繳哪張卡）' : ''}<select name="${r.type === 'transfer' ? 'to' : 'account'}">${opt(accs, r.type === 'transfer' ? r.to : r.account)}</select></label>
    <label>公／私<select name="biz">${opt(['公', '私'], r.biz)}</select></label>${f('備註', 'note', r.note)}`;
  openModal(`<h3>${draft ? '修改後再確認' : '修改'}</h3><form id="edit-form">${body}
    <div class="row"><button class="primary" type="submit">${draft ? '確認存檔' : '儲存'}</button>${draft ? '' : '<button type="button" class="danger" data-del>刪除</button>'}<button type="button" data-close>取消</button></div></form>`);
  const form = $('#edit-form');
  const toggle = () => form.querySelector('.jobonly')?.classList.toggle('hide', form.type.value !== 'job');
  toggle(); form.type.addEventListener('change', toggle);
  // 改分類：可以新增分類，也可以把同一家店的消費全部一起改
  const sync = form.querySelector('#sync');
  const others = () => L.sameMerchant(form.syncKey.value.trim(), form.type.value).filter(t => t.id !== id);
  const showSync = () => {
    if (!sync) return;
    sync.classList.toggle('hide', form.category.value === r.category);
    $('#sync-n').textContent = others().length;
  };
  if (col === 'transactions') {
    const nc = form.querySelector('#newcat'), ncName = form.querySelector('#newcat-name');
    let lastCat = form.category.value;
    form.category.addEventListener('change', () => {
      if (form.category.value === '__new') { nc.classList.remove('hide'); ncName.focus(); form.category.value = lastCat; return; }
      lastCat = form.category.value; showSync();
    });
    const addNew = async () => {
      const name = ncName.value.trim();
      if (!name) return toast('先打分類名稱');
      if (!L.catOf(name)) await db.add('categories', { name, kind: form.type.value === 'income' ? 'income' : 'expense', work: false, bizMode: '私', keywords: [], order: L.categories().length });
      if (![...form.category.options].some(o => o.value === name)) form.category.insertAdjacentHTML('afterbegin', `<option>${esc(name)}</option>`);
      form.category.value = lastCat = name; nc.classList.add('hide'); ncName.value = ''; showSync();
    };
    form.querySelector('#newcat-ok').onclick = addNew;
    ncName.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addNew(); } });
    form.syncKey?.addEventListener('input', showSync);
  }
  form.onsubmit = async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const { syncAll, syncKey, syncRule } = data; delete data.syncAll; delete data.syncKey; delete data.syncRule;
    let msg = '已儲存';
    if (col === 'transactions' && !draft && data.category !== r.category) {
      if (data.biz === r.biz) data.biz = L.bizFor({ ...r, ...data }, data.date); // 公私照新分類重算
      const key = (syncKey || '').trim();
      if (syncAll && key) { const list = others(); await L.recategorize(list, data.category); msg = `已把 ${list.length + 1} 筆一起改成「${data.category}」`; }
      if (syncRule && key) await db.saveSettings({ merchantRules: { ...L.merchantRules(), [key]: data.category } });
    }
    if (col === 'events') { data.done = !!form.done?.checked; data.amount = +data.amount || 0; Object.assign(data, data.type === 'job' ? L.codeInfo(data.codeRaw) : {}); data.route = (data.from || '') + (data.to && data.to !== data.from ? data.to : ''); }
    else { data.amount = +data.amount || 0; if (data.type === 'transfer') { data.from = '銀行戶頭'; data.category = '繳卡費'; } }
    if (draft) {
      const p = state.pending; state.pending = null;
      if (col === 'events') p.event = { ...p.event, ...data }; else p.txs[draft._i] = { ...p.txs[draft._i], ...data };
      await L.saveParsed(p); toast('已存檔');
    } else {
      await db.update(col, id, data);
      if (col === 'events' && data.done) { // 同步連動的收入
        const tx = db.all('transactions').find(t => t.eventId === id);
        if (tx) await db.update('transactions', tx.id, { amount: data.amount, date: data.date });
        else if (data.amount) await db.add('transactions', { type: 'income', amount: data.amount, category: '搬家', work: true, biz: '公', account: '現金', date: data.date, time: data.time, note: data.title, eventId: id, source: '手動' });
      }
      toast(msg);
    }
    closeModal(); render();
  };
  form.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!confirm('確定要刪除這筆嗎？')) return;
    await db.remove(col, id);
    if (col === 'events') for (const t of db.all('transactions').filter(t => t.eventId === id)) await db.remove('transactions', t.id);
    toast('已刪除'); closeModal(); render();
  });
}

// ================= 設定 =================
function settingsView() {
  const st = db.settings(), code = L.codes();
  const accs = db.all('accounts'), cats = L.categories(), scs = db.all('shortcuts').sort((a, b) => a.order - b.order);
  const year = today().slice(0, 4), ym = today().slice(0, 7);
  openModal(`${modalHead('設定')}
  <details class="set-grp"><summary><b>📒 記帳與客人</b><small>分類、客源、工作代號</small></summary>
  <section><h4>分類與關鍵字</h4><p class="muted">設定每個分類算公帳還是私帳（一鍵把以前的全部改過來），以及打字時用哪些字自動分類。目前 ${cats.length} 個分類。</p>
    <button class="primary" data-act="cat-editor">編輯分類</button></section>
  <section><h4>客源項目</h4><p class="muted">客人怎麼找到你。可以新增（例：整理師配合）、刪除（例：回頭客）、直接改名。改名會連以前的行程一起改。</p>
    <div id="lead-box"></div></section>
  <section><h4>代號對照表</h4><p class="muted">一行一個：數字=意思（0 固定代表 3.5 噸車）</p>
    <textarea id="code-text" rows="10">${esc(Object.entries(code).map(([k, v]) => `${k}=${v}`).join('\n'))}</textarea><button data-act="save-code">儲存</button></section>
  </details>
  <details class="set-grp"><summary><b>📅 行事曆</b><small>時間顯示、標籤顏色</small></summary>
  <section><h4>時間顯示</h4><p class="muted">行事曆的時間要用 24 小時制（15:30）還是 12 小時制（下午 3:30）。</p>
    <button data-c-tf>時間顯示：${st.timeFormat === '12' ? '12' : '24'} 小時制（點一下切換）</button></section>
  <section><h4>行事曆標籤</h4><p class="muted">改標籤名稱、顏色，以及對話框輸入時工作／記帳／記事自動用哪個標籤。</p>
    <button class="primary" data-c-labels>編輯標籤</button></section>
  </details>
  <details class="set-grp"><summary><b>🌐 官網</b><small>換照片、案例、評論、二手家具</small></summary>
  <section><h4>官網內容</h4><p class="muted">換封面照、加搬家影片和案例、貼 Google 評論、上架二手家具。</p>
    <button class="primary" data-act="site-cms">編輯官網內容</button></section>
  </details>
  <details class="set-grp"><summary><b>📥 匯入／匯出</b><small>Excel 匯出、舊資料與帳單匯入</small></summary>
  <section><h4>匯出 Excel</h4><div class="row">
    <button data-export="${ym}">匯出本月</button><button data-export="${year}">匯出 ${year} 全年（報稅用）</button></div></section>
  <section><h4>匯入</h4>
    <label>TimeTree 舊資料（JSON 或 CSV：日期、標題、備註）<input type="file" accept=".json,.csv" id="tt-file"></label>
    <label>網銀下載的帳單（CSV／Excel／PDF）
      <select id="bill-bank">${BANKS.map(b => `<option>${b}</option>`).join('')}</select><input type="file" accept=".csv,.xls,.xlsx,.pdf" id="bill-file"></label>
  </section>
  </details>
  <details class="set-grp"><summary><b>✉️ Gmail 自動記帳</b><small>讀取刷卡通知、PDF 密碼</small></summary>
  <section><h4>Gmail 自動記帳</h4>
    <p class="muted">${st.gmailLinked ? '已連結過 Gmail。' : '尚未連結。'}只要求「唯讀」權限，只搜尋四家銀行的信，不會要你的 Gmail 密碼。</p>
    <div class="row"><button class="primary" data-act="gmail">讀取 Gmail 刷卡紀錄（最近 40 天）</button>
      <button data-act="gmail-reset">清除後全部重新抓（最近 90 天）</button>
      <button data-act="gmail-history">抓以前的帳單（90 天以前，全部）</button></div>
    <p class="muted">信用卡電子帳單 PDF 的密碼（多半是身分證字號），只存在你自己的資料裡：</p>
    ${BANKS.map(b => `<label>${b}<input type="password" data-pw="${b}" value="${esc(st.pdfPasswords?.[b] || '')}" autocomplete="off"></label>`).join('')}
    <label>寄件者 Email（選填，讓搜尋更準）${accs.filter(a => a.kind === '信用卡').map(a => `<input data-sender="${a.id}" placeholder="${a.name} 的寄件者，例如 service@xxx.com.tw" value="${esc(a.sender || '')}">`).join('')}</label>
    <button data-act="save-gmail">儲存密碼與寄件者</button>
  </section>
  </details>
  <details class="set-grp"><summary><b>👤 帳號</b><small>登入狀態、登出</small></summary>
  <section><h4>帳號</h4>
    <p>${db.getMode() === 'local' ? '目前是<b>本機試用模式</b>：資料只存在這支手機的瀏覽器。照「設定教學」連上 Firebase 後就能雲端同步。' : `已登入：${esc(db.userName())}`}</p>
    ${db.getMode() === 'cloud' ? '<button data-act="logout">登出</button>' : ''}
  </section>
  </details>
  <div class="row"><button data-close>關閉</button></div>`);

  renderLeadBox();
  G.preload().catch(() => {}); // 先載好 Google 授權元件，手機按下去才不會被擋
  $('#tt-file').onchange = async e => importTimeTree(e.target.files[0]);
  $('#bill-file').onchange = async e => importBillFile(e.target.files[0], $('#bill-bank').value);
}

async function saveSettingsForm(act) {
  if (act === 'save-gmail') {
    const pw = {}; document.querySelectorAll('[data-pw]').forEach(i => { if (i.value) pw[i.dataset.pw] = i.value; });
    await db.saveSettings({ pdfPasswords: pw });
    for (const i of document.querySelectorAll('[data-sender]')) await db.update('accounts', i.dataset.sender, { sender: i.value.trim() });
  } else if (act === 'save-sc') {
    for (const s of db.all('shortcuts')) await db.remove('shortcuts', s.id);
    await db.addMany('shortcuts', $('#sc-text').value.split('\n').map(l => l.split('=')).filter(x => x[1]).map(([label, input], i) => ({ label: label.trim(), input: input.trim(), order: i })));
  } else if (act === 'save-code') {
    const codes = Object.fromEntries($('#code-text').value.split('\n').map(l => l.split('=')).filter(x => x[1]).map(([k, v]) => [k.trim(), v.trim()]));
    await db.saveSettings({ codes: Object.keys(codes).length ? codes : DEFAULT_CODES });
  }
  toast('已儲存');
}

// ================= 客源項目（新增／刪除／改名）=================
let leadDel = ''; // 按了垃圾桶、等確認的那個客源
function renderLeadBox() {
  const box = $('#lead-box'); if (!box) return;
  const ls = L.leads();
  box.innerHTML = ls.map(x => `<div class="lead-row"><input class="lead-edit" data-lead-orig="${esc(x)}" value="${esc(x)}">
      ${leadDel === x ? '<button class="danger sm" data-lead-del>確定刪除</button><button class="sm" data-lead-keep>不要</button>' : `<button class="icon-btn" data-lead-arm="${esc(x)}" title="刪除">🗑</button>`}</div>
    ${leadDel === x ? `<p class="warn sm-note">以前標「${esc(x)}」的 ${db.all('events').filter(e => e.lead === x).length} 件行程會變成「未填」，之後可以再補選別的。</p>` : ''}`).join('')
    + `<div class="add-row"><input id="lead-new" placeholder="＋ 新增客源，例如：整理師配合"><button class="primary" data-lead-add>＋ 新增</button></div>`;
  if (!box.dataset.bound) {
    box.dataset.bound = 1;
    box.addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return;
      const cur = L.leads();
      if (b.dataset.leadArm !== undefined) { leadDel = b.dataset.leadArm; await db.ensureWhere('events', 'lead', leadDel); renderLeadBox(); }
      else if (b.dataset.leadKeep !== undefined) { leadDel = ''; renderLeadBox(); }
      else if (b.dataset.leadDel !== undefined) {
        const x = leadDel; leadDel = '';
        await db.ensureWhere('events', 'lead', x);
        for (const ev of db.all('events').filter(ev => ev.lead === x)) await db.update('events', ev.id, { lead: '' });
        await db.saveSettings({ leads: cur.filter(y => y !== x) }); toast(`已刪除「${x}」`); renderLeadBox();
      } else if (b.dataset.leadAdd !== undefined) {
        const n = $('#lead-new').value.trim();
        if (!n) return toast('先打名稱');
        if (cur.includes(n)) return toast('已經有這個了');
        await db.saveSettings({ leads: [...cur, n] }); toast(`已新增「${n}」`); renderLeadBox();
      }
    });
    box.addEventListener('change', async e => {
      const i = e.target.closest('.lead-edit'); if (!i) return;
      const o = i.dataset.leadOrig, n = i.value.trim(), cur = L.leads();
      if (!n || n === o || cur.includes(n)) { if (!n) toast('名稱不能空白，要拿掉請按垃圾桶'); renderLeadBox(); return; }
      await db.ensureWhere('events', 'lead', o);
      for (const ev of db.all('events').filter(ev => ev.lead === o)) await db.update('events', ev.id, { lead: n });
      await db.saveSettings({ leads: cur.map(y => y === o ? n : y) }); toast(`已改成「${n}」`); renderLeadBox();
    });
  }
}

// ================= 分類設定 =================
// 一張卡片一個分類：名稱、公帳／私帳、關鍵字（點 ✕ 刪、打字按 Enter 加）
const BIZ_MODES = [['公', '公帳'], ['day', '有工作那天算公'], ['私', '私帳']];
let delArm = ''; // 按了垃圾桶、等確認的那個分類
async function addCategory(kind) {
  const i = document.querySelector(`[data-cat-new="${kind}"]`), name = (i?.value || '').trim();
  if (!name) { toast('先打分類名稱'); i?.focus(); return false; }
  if (L.catOf(name)) { toast('已經有這個分類'); return false; }
  await db.add('categories', { name, kind, work: false, bizMode: '私', keywords: [], order: L.categories().length });
  toast(`已新增「${name}」`); return true;
}
function openCategoryEditor() {
  const keep = $('#modal-body').scrollTop, open = $('#modal').classList.contains('open') && $('.cat-ed');
  const cats = L.categories();
  const card = c => {
    const mode = c.kind === 'income' ? (c.work ? '公' : '私') : L.bizModeOf(c);
    const modes = c.kind === 'income' ? [['公', '工作收入'], ['私', '個人收入']] : BIZ_MODES;
    return `<div class="cat">
      <div class="cat-top"><input class="cat-name" data-cat-name="${c.id}" value="${esc(c.name)}">
        ${delArm === c.id ? `<button class="danger sm" data-cat-del="${c.id}">確定刪除</button><button class="sm" data-cat-keep>不要</button>`
          : `<button class="icon-btn" data-cat-arm="${c.id}" title="刪除分類">🗑</button>`}</div>
      ${delArm === c.id ? `<p class="warn sm-note">${(n => n ? `以前的 ${n} 筆會改到「${c.kind === 'income' ? '其他收入' : '其他支出'}」` : '這個分類沒有記過帳')(db.all('transactions').filter(t => t.category === c.name).length)}</p>` : ''}
      <div class="seg3">${modes.map(([m, t]) => `<button data-cat-biz="${c.id}|${m}" class="${mode === m ? 'on m-' + m : ''}">${t}</button>`).join('')}</div>
      <div class="kws">${(c.keywords || []).map((k, i) => `<span class="kw">${esc(k)}<button data-kw-del="${c.id}|${i}">✕</button></span>`).join('')}
        <input class="kw-add" data-kw-add="${c.id}" placeholder="＋ 加關鍵字，按 Enter"></div></div>`;
  };
  const group = (title, list, kind) => `<h4>${title}</h4><div class="cat-list">${list.map(card).join('')}</div>
    <div class="add-row"><input data-cat-new="${kind}" placeholder="新${kind === 'income' ? '收入' : '支出'}分類的名稱，例如：淘寶">
      <button class="primary" data-cat-add="${kind}">＋ 新增</button></div>`;
  const rules = Object.entries(L.merchantRules());
  openModal(`${modalHead('分類與關鍵字', true)}<div class="cat-ed">
    <div class="howto"><b>怎麼用？</b>
      <p>① 按「公帳／私帳」：這個分類以前記的帳會<b>全部一起改</b>，不用一筆一筆改。「有工作那天算公」＝那天有搬家才算公帳。</p>
      <p>② 關鍵字：打字記帳時內容有這個字，就自動歸到這個分類。例：「中油」→ 加油。</p></div>
    ${group('支出', cats.filter(c => c.kind !== 'income'), 'expense')}
    ${group('收入', cats.filter(c => c.kind === 'income'), 'income')}
    ${rules.length ? `<h4>信用卡消費自動分類</h4><p class="muted">在明細改分類時勾「以後自動用這個分類」就會出現在這裡。</p>
      <div class="kws">${rules.map(([k, v]) => `<span class="kw">${esc(k)} → ${esc(v)}<button data-rule-del="${esc(k)}">✕</button></span>`).join('')}</div>` : ''}
  </div>`);
  if (open) $('#modal-body').scrollTop = keep;
  const body = $('#modal-body');
  body.onclick = async e => {
    const b = e.target.closest('[data-cat-biz],[data-cat-del],[data-cat-arm],[data-cat-keep],[data-kw-del],[data-cat-add],[data-rule-del],[data-back]');
    if (!b) return;
    const d = b.dataset;
    if (d.back !== undefined) { delArm = ''; return settingsView(); }
    if (d.catArm) delArm = d.catArm;
    else if (d.catKeep !== undefined) delArm = '';
    else if (d.catBiz) {
      const [id, mode] = d.catBiz.split('|'), c = db.get('categories', id);
      if (c.kind === 'income') await db.update('categories', id, { work: mode === '公' });
      else { const n = await L.setCategoryBiz(id, mode); toast(`「${c.name}」改成${BIZ_MODES.find(x => x[0] === mode)[1]}，以前的 ${n} 筆一起改好了`); }
    } else if (d.kwDel) {
      const [id, i] = d.kwDel.split('|'), c = db.get('categories', id);
      await db.update('categories', id, { keywords: c.keywords.filter((_, k) => k !== +i) });
    } else if (d.catAdd) {
      if (!await addCategory(d.catAdd)) return;
    } else if (d.catDel) {
      const c = db.get('categories', d.catDel), fallback = c.kind === 'income' ? '其他收入' : '其他支出';
      delArm = '';
      if (c.name === fallback) toast(`「${fallback}」不能刪`);
      else {
        await db.ensureWhere('transactions', 'category', c.name); // 3 個月以前的也一起改
        await L.recategorize(db.all('transactions').filter(t => t.category === c.name), fallback);
        await db.remove('categories', c.id); toast(`已刪除「${c.name}」`);
      }
    } else if (d.ruleDel) {
      const r = { ...L.merchantRules() }; delete r[d.ruleDel]; await db.saveSettings({ merchantRules: r });
    }
    openCategoryEditor();
  };
  body.onkeydown = async e => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const n = e.target.closest('[data-cat-new]');
    if (n) { e.preventDefault(); if (await addCategory(n.dataset.catNew)) openCategoryEditor(); return; }
    const i = e.target.closest('[data-kw-add]');
    if (!i) return;
    e.preventDefault();
    const kw = i.value.trim(), c = db.get('categories', i.dataset.kwAdd);
    if (kw && !(c.keywords || []).includes(kw)) await db.update('categories', c.id, { keywords: [...(c.keywords || []), kw] });
    openCategoryEditor();
    document.querySelector(`[data-kw-add="${c.id}"]`)?.focus();
  };
  body.onchange = async e => {
    const i = e.target.closest('[data-cat-name]');
    if (!i) return;
    const name = i.value.trim(), c = db.get('categories', i.dataset.catName);
    if (!name || name === c.name) { i.value = c.name; return; }
    if (L.catOf(name)) { toast('已經有這個分類'); i.value = c.name; return; }
    await L.renameCategory(c.id, name); toast('已改名，以前的帳也一起改了');
  };
}

// 匯入確認清單（Gmail／帳單檔）
function reviewImport(items, title, extra = {}) {
  const { bills = [], replaceIds = [] } = extra, skip = new Set(replaceIds);
  const errors = items.filter(x => x.error), list = items.filter(x => !x.error);
  // 套用「名稱有 X → 分類 Y」的規則，公私照分類的設定
  list.forEach(x => { x.dup = L.findDuplicate(x, skip); x.category = L.ruleFor(x.note) || x.category; x.biz = x.biz || L.bizFor(x, x.date) || '私'; });
  const cats = L.categories().map(c => c.name);
  openModal(`<h3>${esc(title)}</h3>
    ${errors.map(e => `<p class="warn">${esc(e.error)}</p>`).join('')}
    ${bills.length ? `<div class="item"><b>帳單應繳金額</b>${bills.map(b => `<div>${esc(b.bank)}：${money(b.amount)}${b.dueDate ? `（${md(b.dueDate)} 前繳）` : ''}</div>`).join('')}</div>` : ''}
    ${replaceIds.length ? `<p class="muted">有帳單的期間，之前從刷卡通知記的 ${replaceIds.length} 筆會換成帳單上的明細，不會重複算。</p>` : ''}
    <p class="muted">共 ${list.length} 筆，${list.filter(x => x.dup).length} 筆疑似重複（已取消勾選）。看過、改好分類後按確認。</p>
    <div class="imp">${list.map((x, i) => `<div class="item ${x.dup ? 'dup' : ''}"><label class="check"><input type="checkbox" data-pick="${i}" ${x.dup ? '' : 'checked'}>
      ${md(x.date)} ${x.type === 'income' ? '退款 ' : ''}${money(x.amount)}｜${esc(x.account)}｜${esc(x.note)}</label>
      <select data-cat="${i}">${cats.map(c => `<option ${c === x.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <select data-biz="${i}"><option ${x.biz === '私' ? 'selected' : ''}>私</option><option ${x.biz === '公' ? 'selected' : ''}>公</option></select></div>`).join('')}</div>
    <div class="row"><button class="primary" data-act="imp-ok">確認匯入</button><button data-close>取消</button></div>`);
  $('#modal-body').querySelector('[data-act="imp-ok"]').onclick = async () => {
    const picked = list.filter((x, i) => document.querySelector(`[data-pick="${i}"]`).checked).map(x => {
      const i = list.indexOf(x);
      const { dup, kindOfMail, ...rest } = x;
      return { ...rest, category: document.querySelector(`[data-cat="${i}"]`).value, biz: document.querySelector(`[data-biz="${i}"]`).value };
    });
    for (const id of replaceIds) await db.remove('transactions', id);
    await db.addMany('transactions', picked.map(x => ({ ...x, createdAt: new Date().toISOString() })));
    if (bills.length) {
      const cs = { ...(db.settings().cardStatements || {}) };
      for (const b of bills) cs[b.bank] = [...(cs[b.bank] || []).filter(x => x.msgId !== b.msgId), b];
      await db.saveSettings({ cardStatements: cs });
    }
    toast(`已匯入 ${picked.length} 筆`); closeModal(); render();
  };
}

async function readGmail(reset, history) {
  const ready = G.connect().catch(e => e); // 一按就先要 Google 授權，手機才不會擋視窗
  try {
    // 要知道哪些信已經匯過：平常讀近 130 天就夠（帳單會列到上個月的刷卡）；
    // 清除重抓、抓以前的帳單才把 Gmail 匯入的全部讀進來（約 3,000 筆，很少用）
    if (reset || history) await db.ensureWhere('transactions', 'source', 'Gmail');
    else await db.ensureRange(ymd(new Date(Date.now() - 130 * 864e5)), today());
    if (history) toast('連結 Gmail 中…（以前的帳單比較多，要等幾分鐘）');
    else if (reset) {
      // 清掉之前從 Gmail 匯入的，全部重新抓
      if (!confirm('要清除之前從 Gmail 匯入的信用卡資料，全部重新抓一次嗎？（你自己記的帳不會動）')) return;
      const prev = db.all('transactions').filter(t => t.source === 'Gmail');
      for (const t of prev) await db.remove('transactions', t.id);
      await db.saveSettings({ cardStatements: {} });
      toast(`已清除 ${prev.length} 筆，重新抓取中…`);
    } else toast('連結 Gmail 中…');
    const auth = await ready; if (auth instanceof Error) throw auth;
    const r = await G.fetchCardTransactions(reset || history ? 90 : 40, msg => toast(msg), history);
    if (!r.items.length && !r.bills.length) return toast(history ? '沒有找到以前的帳單' : '沒有找到新的刷卡紀錄');
    reviewImport(r.items, history ? 'Gmail 以前的帳單' : 'Gmail 刷卡紀錄', r);
  } catch (e) { toast(e.message); }
}

async function importBillFile(file, bank) {
  if (!file) return;
  try {
    toast('讀取檔案中…');
    const pw = db.settings().pdfPasswords || {};
    const text = await F.fileToText(file, [pw[bank], pw.all]);
    toast('整理消費明細中…');
    const found = await askClaude('statement', `卡別：${bank}\n${text.slice(0, 55000)}`);
    reviewImport(found.map((it, i) => ({ type: it.kind === 'income' ? 'income' : 'expense', amount: it.amount, date: it.date, time: it.time, category: it.category,
      account: bank, note: it.merchant || it.title, source: '匯入檔', externalId: `${file.name}#${i}` })).filter(x => x.amount > 0), `${bank} 帳單匯入`);
  } catch (e) { toast(e.message); }
}

async function importTimeTree(file) {
  if (!file) return;
  try {
    const list = await F.readTimeTree(file);
    const jobs = list.filter(p => p.event?.type === 'job'), done = jobs.filter(p => p.event.done);
    const txs = list.flatMap(p => p.txs.filter(t => !t.matchJob));
    openModal(`<h3>TimeTree 匯入預覽</h3>
      <p>共 ${list.length} 筆：工作 ${jobs.length} 筆（已完成 ${done.length}）、行程 ${list.length - jobs.length} 筆、另外收支 ${txs.length} 筆。</p>
      <div class="imp">${list.slice(0, 30).map(p => `<div class="item"><small>${p.date}</small> ${esc(summarize(p))}</div>`).join('')}${list.length > 30 ? `<p class="muted">…還有 ${list.length - 30} 筆</p>` : ''}</div>
      <div class="row"><button class="primary" data-act="tt-ok">確認匯入</button><button data-close>取消</button></div>`);
    $('#modal-body').querySelector('[data-act="tt-ok"]').onclick = async () => {
      toast('匯入中，請稍等…');
      const sorted = list.sort((a, b) => a.date.localeCompare(b.date));
      for (const p of sorted) await L.saveParsed(p, 'TimeTree');
      toast(`已匯入 ${list.length} 筆`); closeModal(); render();
    };
  } catch (e) { toast('檔案讀取失敗：' + e.message); }
}

async function doExport(range) {
  try {
    const from = range.length === 4 ? `${range}-01-01` : `${range}-01`;
    const to = range.length === 4 ? `${range}-12-31` : ymd(new Date(+range.slice(0, 4), +range.slice(5), 0));
    await F.exportExcel(from, to, `搬家記帳_${range}.xlsx`);
  } catch (e) { toast(e.message); }
}

// 快捷按鈕：最近手動記過的帳（不同金額／項目各一個），點一下就再記一筆今天的
function recentTx() {
  const seen = new Set(), out = [];
  const list = db.all('transactions').filter(t => t.source === '手動' && (t.type === 'expense' || t.type === 'income') && !t.eventId)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  for (const t of list) {
    const key = `${t.type}|${t.amount}|${t.note || t.category}|${t.account}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push(t);
    if (out.length >= 8) break;
  }
  return out;
}
const txInput = t => `${t.type === 'income' ? '+' : '-'}${t.amount}${t.note || t.category}${BANKS.includes(t.account) ? ' ' + t.account : ''}`;


// ---- 客人確認報價單 → 自動加進行事曆（只有開著 APP 時才會加，下次打開也會補上）----
const calBusy = new Set();
function quoteDate(txt) {
  const t = String(txt || '').replace(/[：]/g, ':');
  const m = t.match(/(?:(\d{4})[\/\-年])?(\d{1,2})[\/月\-](\d{1,2})/);
  if (!m) return null;
  const now = new Date(); let y = +m[1] || now.getFullYear();
  const mo = +m[2], d = +m[3]; if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (!m[1] && new Date(y, mo - 1, d + 1) < now) y += 1;
  const tm = t.slice(m.index + m[0].length).match(/(\d{1,2}):(\d{2})/);
  const p2 = n => String(n).padStart(2, '0');
  return { date: `${y}-${p2(mo)}-${p2(d)}`, time: tm ? `${p2(+tm[1])}:${tm[2]}` : '' };
}
async function quoteToCalendar() {
  for (const q of db.quotesAll()) {
    if (q.status !== '已確認' || q.calDone || calBusy.has(q.id)) continue;
    calBusy.add(q.id);
    try {
      const dt = quoteDate(q.date);
      const area = x => (String(x || '').match(/[\u4e00-\u9fa5]{1,3}[區鄉鎮市]/) || [''])[0];
      const route = [area(q.from), area(q.to)].filter(Boolean).join('');
      const title = [route, q.name].filter(Boolean).join(' ');
      const note = ['報價單 ' + (q.no || ''), '舊址：' + (q.from || ''), '新址：' + (q.to || ''), '總價 NT$' + q.total + '，訂金 NT$' + q.dep, q.sig ? '客人已簽名' : '', q.custNote ? '客人備註：' + q.custNote : '', q.date ? '客人填的日期：' + q.date : ''].filter(Boolean).join('\n');
      if (!dt) { await db.quoteUpdate(q.id, { calDone: true, calFail: true }); toast('「' + q.name + '」確認了，但日期看不懂，請自己加行程'); continue; }
      const endT = dt.time ? (() => { const [h, mi] = dt.time.split(':').map(Number); return String((h + 1) % 24).padStart(2, '0') + ':' + String(mi).padStart(2, '0'); })() : '';
      await db.add('events', { type: 'event', title, date: dt.date, endDate: '', allDay: !dt.time, time: dt.time, endTime: endT, repeat: '', label: 0, note, lead: '', done: false, amount: 0, source: '報價單', quoteId: q.id });
      await db.quoteUpdate(q.id, { calDone: true });
      toast('「' + q.name + '」確認了，已加進行事曆 ' + dt.date);
    } catch (e) { calBusy.delete(q.id); }
  }
}

// ================= 主框架 =================
let quoteRoot = null, quoteApi = null;
function render() {
  const view = $('#view');
  if (state.tab === 'quote') {
    // 報價單分頁有自己的畫面狀態（草稿、輸入中的內容），換分頁或資料同步時不要重畫
    if (!quoteRoot) {
      quoteRoot = document.createElement('div'); quoteRoot.id = 'qroot';
      quoteApi = mountQuotes(quoteRoot, {
        settings: db.settings, saveSettings: db.saveSettings,
        quotes: db.quotesAll, saveQuote: db.quoteSave, updateQuote: db.quoteUpdate,
      });
    } else quoteApi.refresh();
    if (view.firstChild !== quoteRoot) { view.innerHTML = ''; view.appendChild(quoteRoot); }
  } else {
    view.innerHTML = state.tab === 'chat' ? chatView() : state.tab === 'cal' ? CAL.calView() : statsView();
  }
  document.querySelectorAll('nav [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  $('#composer').classList.toggle('hide', state.tab !== 'chat');
  $('#shortcuts').innerHTML = recentTx().map(t => `<button data-sc="${t.id}">${esc(txLabel(t))}</button>`).join('');
  $('#net').textContent = navigator.onLine ? '' : '離線中';
  if (state.tab === 'chat') { const log = $('#log'); if (log) log.scrollTop = log.scrollHeight; window.scrollTo(0, document.body.scrollHeight); }
  else if (state.lastTab !== state.tab) window.scrollTo(0, 0);
  state.lastTab = state.tab;
}

// 左滑／右滑切換分頁：對話框 ⇄ 行事曆 ⇄ 統計
// 不搶別人的手勢：月曆格子（本來就是左右滑換月）、彈出視窗、輸入框、可橫向捲動的區塊（常用記帳按鈕）、長按拖移中都不切
const TAB_ORDER = ['chat', 'cal', 'stats', 'quote'];
let swipe0 = null;
document.addEventListener('touchstart', e => {
  const el = e.target;
  const skip = e.touches.length !== 1 || $('#modal').classList.contains('open') ||
    el.closest('#calgrid, textarea, input, select, canvas, #qroot, #shortcuts, .tip, .bars');
  swipe0 = skip ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
}, { passive: true });
document.addEventListener('touchend', e => {
  const s = swipe0; swipe0 = null;
  if (!s || Date.now() - s.t > 700 || $('#modal').classList.contains('open')) return;
  const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
  if (Math.abs(dx) < 80 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
  const i = TAB_ORDER.indexOf(state.tab), n = i + (dx < 0 ? 1 : -1);
  if (n < 0 || n >= TAB_ORDER.length) return;
  state.tab = TAB_ORDER[n]; render();
}, { passive: true });

document.addEventListener('click', async e => {
  // 手機沒有滑鼠：點一下打開細項，再點一下收起來
  if (e.target.closest('select[data-lead]')) return; // 在清單裡選客源：不要展開／收起、也不要打開行程
  const ht = e.target.closest('.has-tip');
  if (ht && !e.target.closest('.tip')) {
    document.querySelectorAll('.has-tip.open').forEach(x => x !== ht && x.classList.remove('open'));
    ht.classList.toggle('open'); return;
  }
  if (!ht) document.querySelectorAll('.has-tip.open').forEach(x => x.classList.remove('open'));
  const t = e.target.closest('[data-tab],[data-edit],[data-ev],[data-act],[data-stats],[data-stab],[data-scat],[data-close],[data-sc],[data-prefill],[data-go],[data-export],[data-day],#gear');
  if (!t) return;
  const d = t.dataset;
  if (t.id === 'gear') return settingsView();
  if (d.tab) { state.tab = d.tab; render(); if (d.tab === 'chat') $('#input').focus(); }
  else if (d.go) { state.tab = d.go; render(); }
  else if (d.edit) { const [col, id] = d.edit.split(':'); editRecord(col, id); }
  else if (d.ev) CAL.openForm(d.ev);
  else if (d.stats) { state.statsYm = ymAdd(state.statsYm, +d.stats); render(); }
  else if (d.stab) { state.statsTab = d.stab; state.statsCat = ''; render(); window.scrollTo(0, 0); }
  else if (d.scat !== undefined) { state.statsCat = state.statsCat === d.scat ? '' : d.scat; render(); }
  else if (d.close !== undefined) closeModal();
  else if (d.day) CAL.openDay(d.day);
  else if (d.sc) { const tx = db.get('transactions', d.sc); if (tx) submitInput(txInput(tx)); }
  else if (d.prefill) { closeModal(); state.tab = 'chat'; render(); const i = $('#input'); i.value = d.prefill; i.focus(); }
  else if (d.export) doExport(d.export);
  else if (d.act === 'ok') confirmPending();
  else if (d.act === 'no') { state.pending = null; render(); }
  else if (d.act === 'fix') {
    const p = state.pending;
    if (p.event) editRecord('events', null, { ...p.event });
    else editRecord('transactions', null, { ...p.txs[0], _i: 0 });
  }
  else if (d.act === 'gmail') readGmail();
  else if (d.act === 'gmail-reset') readGmail(true);
  else if (d.act === 'gmail-history') readGmail(false, true);
  else if (d.act === 'cat-editor') openCategoryEditor();
  else if (d.act === 'site-cms') openSiteCms({ openModal, closeModal, toast, modalHead });
  else if (d.act === 'logout') db.logout();
  else if (d.act === 'login') db.login().catch(err => toast('登入失敗：' + err.message));
  else if (d.act?.startsWith('save-')) saveSettingsForm(d.act);
});

$('#composer').addEventListener('submit', e => {
  e.preventDefault();
  const i = $('#input'), v = i.value.trim();
  if (!v) return;
  i.value = ''; grow(); submitInput(v); i.focus();
});
// 電腦：Enter 送出，Shift＋Enter 換行；手機：Enter 就是換行，要送出按右邊的 ➤（貼上的多行文字會保留）
const coarse = matchMedia('(pointer: coarse)').matches;
$('#input').enterKeyHint = coarse ? 'enter' : 'send';
const grow = () => { const i = $('#input'); i.style.height = 'auto'; i.style.height = Math.min(i.scrollHeight, 160) + 'px'; };
$('#input').addEventListener('input', grow);
$('#input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !coarse) { e.preventDefault(); $('#composer').requestSubmit(); }
});
CAL.initCalendar({ openModal, closeModal, toast, render: () => render(), editTx: id => editRecord('transactions', id), state });
window.addEventListener('online', render);
window.addEventListener('offline', render);

(async function start() {
  const r = await db.init();
  if (r.needLogin) {
    $('#view').innerHTML = `<div class="login"><h2>搬家記帳</h2><p>請用你的 Google 帳號登入，資料只有你自己看得到。</p><button class="primary" data-act="login">用 Google 登入</button></div>`;
    $('#composer').classList.add('hide');
    return;
  }
  db.onChange(() => { quoteToCalendar(); if (!$('#modal').classList.contains('open')) render(); });
  render();
  // 等雲端資料對完才放預設值、算官網，免得手機暫存還沒齊就蓋掉
  db.synced().then(async ok => {
    if (!ok) return;
    await L.seed();
    AV.start(); // 行程有變動就自動更新官網「已滿日期」
  });
  $('#input').focus();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
