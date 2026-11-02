import * as db from './store.js';
import { parseLine, summarize, ymd, BANKS, DEFAULT_CODES } from './parser.js';
import * as L from './ledger.js';
import { aiReady, askClaude, itemsToParsed } from './ai.js';
import * as F from './files.js';
import * as G from './gmail.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + Math.round(+n || 0).toLocaleString('zh-TW');
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const today = () => ymd(new Date());
const md = d => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
const ymAdd = (ym, n) => { const [y, m] = ym.split('-').map(Number); return ymd(new Date(y, m - 1 + n, 1)).slice(0, 7); };

const state = { tab: 'chat', calYm: today().slice(0, 7), statsYm: today().slice(0, 7), pending: null, busy: '' };

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

// ================= 對話框 =================
function itemLine({ col, rec }) {
  if (col === 'events') {
    if (rec.type === 'job') {
      const late = !rec.done && rec.date < today();
      return `<div class="bubble job ${late ? 'late' : ''}" data-ev="${rec.id}">
        <b>${md(rec.date)}${rec.time ? ' ' + rec.time : ''}</b> ${esc(rec.title)}
        <span class="tag ${rec.done ? 'ok' : 'warn'}">${rec.done ? '實收 ' + money(rec.amount) : late ? '未記收入' : '未完成'}</span>${rec.note ? '<small>有備註</small>' : ''}</div>`;
    }
    return `<div class="bubble event" data-ev="${rec.id}"><b>${md(rec.date)}${rec.time ? ' ' + rec.time : ''}</b> ${esc(rec.title)}${rec.note ? '<small>有備註</small>' : ''}</div>`;
  }
  const sign = rec.type === 'income' ? '+' : rec.type === 'expense' ? '-' : '⇄';
  return `<div class="bubble tx ${rec.type}" data-edit="transactions:${rec.id}">
    <span class="amt">${sign}${money(rec.amount)}</span> ${esc(rec.category)}｜${esc(rec.type === 'transfer' ? '繳' + rec.to : rec.account)}${rec.biz === '公' ? '｜公' : ''}
    <small>${md(rec.date)} ${esc(rec.time)} ${esc(rec.note)}</small></div>`;
}

function chatView() {
  const ym = today().slice(0, 7), bills = L.cardBills(ym), d = +today().slice(8);
  const unpaid = BANKS.filter(b => bills.bills[b] > 0 && bills.paidBy[b] < bills.bills[b]);
  const open = L.monthStats(ym).openJobs.length + L.monthStats(ymAdd(ym, -1)).openJobs.length;
  const banners = [];
  if (d <= 10 && unpaid.length) banners.push(`<div class="banner" data-go="stats">本月要繳卡費 ${money(bills.total)}（${unpaid.map(b => `${b} ${money(bills.bills[b])}`).join('、')}）</div>`);
  if (open) banners.push(`<div class="banner warn" data-go="cal">有 ${open} 筆過去的工作還沒記收入</div>`);
  return `${banners.join('')}
  <div id="log">${L.recent().map(itemLine).join('') || '<p class="empty">打一行字按 Enter 就記好了，例如：<br><code>-120晚餐</code>　<code>1105 11:00 03.西屯太平0.0 王小明 賴</code></p>'}</div>
  ${state.busy ? `<div class="muted center">${esc(state.busy)}</div>` : ''}`;
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

// ================= 行事曆（仿 TimeTree：格子裡直接看到當天行程）=================
const WEEK_MON = ['一', '二', '三', '四', '五', '六', '日'];
const evTitle = e => e.title || [e.codeRaw && e.codeRaw + '.', e.route, e.client].filter(Boolean).join(' ');
const txLabel = t => `${t.type === 'income' ? '+' : t.type === 'expense' ? '-' : '⇄'}${Math.round(t.amount).toLocaleString('zh-TW')} ${t.note || t.category}`;

function dayItems(date) {
  const evs = L.eventsOn(date).sort((a, b) => (a.time ? 1 : 0) - (b.time ? 1 : 0) || (a.time || '').localeCompare(b.time || ''));
  const txs = L.txsOn(date).filter(t => !t.eventId);
  return { evs, txs };
}

function calView() {
  const ym = state.calYm, [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1), lead = (first.getDay() + 6) % 7;
  const start = new Date(y, m - 1, 1 - lead), weeks = Math.ceil((lead + new Date(y, m, 0).getDate()) / 7);
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const dt = new Date(start); dt.setDate(start.getDate() + i);
    const date = ymd(dt), other = dt.getMonth() !== m - 1, { evs, txs } = dayItems(date);
    const lines = [
      ...evs.map(e => {
        const late = e.type === 'job' && !e.done && date < today();
        const cls = e.type === 'job' ? (e.done ? 'job done' : 'job') : 'ev';
        return `<div class="chip ${cls} ${e.time ? 'timed' : 'allday'} ${late ? 'late' : ''}">${e.time ? `<i></i>` : ''}${esc(evTitle(e))}</div>`;
      }),
      ...txs.map(t => `<div class="chip tx ${t.type}">${esc(txLabel(t))}</div>`),
    ];
    const max = 4, more = lines.length - max;
    cells.push(`<div class="cell ${other ? 'other' : ''} ${date === today() ? 'today' : ''} w${dt.getDay()}" data-day="${date}">
      <span class="dn">${dt.getDate()}</span>${lines.slice(0, more > 0 ? max - 1 : max).join('')}${more > 0 ? `<div class="more">+${more + 1}</div>` : ''}</div>`);
  }
  return `<div class="cal-head"><h2>${y}年${m}月</h2>
      <div><button data-cal-today>今天</button><button data-cal="-1">‹</button><button data-cal="1">›</button></div></div>
    <div class="grid tt" id="calgrid">${WEEK_MON.map((w, i) => `<div class="wk ${i === 6 ? 'sun' : i === 5 ? 'sat' : ''}">${w}</div>`).join('')}${cells.join('')}</div>`;
}

function daySheet(date) {
  const info = L.dayInfo(date), { evs, txs } = dayItems(date), d = new Date(date);
  const row = e => {
    const late = e.type === 'job' && !e.done && date < today();
    return `<div class="trow ${late ? 'late' : ''}" data-ev="${e.id}"><span class="tt-time">${e.time || '全天'}</span>
      <span class="bar ${e.type === 'job' ? 'job' : 'ev'}"></span><span class="tt-title">${esc(evTitle(e))}
      ${e.type === 'job' ? `<small>${e.done ? '實收 ' + money(e.amount) : late ? '還沒記收入' : '未完成'}</small>` : ''}${e.note ? '<small>有備註</small>' : ''}</span></div>`;
  };
  openModal(`<div class="sheet-head"><h3>${+date.slice(5, 7)}月${+date.slice(8)}日（${WEEK[d.getDay()]}）</h3><button data-close>✕</button></div>
    ${evs.map(row).join('') || '<p class="muted">沒有行程</p>'}
    ${txs.map(t => `<div class="trow" data-edit="transactions:${t.id}"><span class="tt-time">${t.time || ''}</span>
      <span class="bar ${t.type}"></span><span class="tt-title">${esc(txLabel(t))}<small>${esc(t.category)}｜${esc(t.account || t.to)}${t.biz === '公' ? '｜公' : ''}</small></span></div>`).join('')}
    ${info.workIncome || info.workCost ? `<p class="muted">當天工作收入 ${money(info.workIncome)}｜成本 ${money(info.workCost)}｜淨賺 <b>${money(info.net)}</b></p>` : ''}
    <button class="primary wide" data-prefill="${date.slice(5, 7)}${date.slice(8)} ">＋ 在這天新增</button>`);
}

// 點一筆行程：看完整內容（含貼上的估價單）
function eventDetail(id) {
  const e = db.get('events', id); if (!e) return;
  const code = L.codes(), d = new Date(e.date), late = e.type === 'job' && !e.done && e.date < today();
  openModal(`<div class="sheet-head"><button data-day="${e.date}">‹ ${+e.date.slice(5, 7)}/${+e.date.slice(8)}</button><button data-close>✕</button></div>
    <h3 class="ev-title">${esc(evTitle(e))}</h3>
    <p>${+e.date.slice(5, 7)}月${+e.date.slice(8)}日（${WEEK[d.getDay()]}）${e.time ? ' ' + e.time : '　全天'}</p>
    ${e.type === 'job' ? `<p class="muted">${e.truck} 噸｜${(e.services || []).map(s => esc(code[s] || s)).join('、')}${e.from ? `｜${esc(e.from)}→${esc(e.to)}` : ''}${e.fromFloor !== '' && e.fromFloor != null ? `｜樓層 ${esc(e.fromFloor)}→${esc(e.toFloor)}` : ''}${e.contact ? '｜' + esc(e.contact) : ''}</p>
      ${e.done ? `<p><span class="tag ok">實收 ${money(e.amount)}</span></p>` : `<div class="row ${late ? 'late' : ''}"><input type="number" inputmode="numeric" placeholder="實收金額" data-amt="${e.id}"><button class="primary" data-done="${e.id}">完成</button></div>`}` : ''}
    ${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}
    <div class="row"><button data-edit="events:${e.id}">編輯</button><button data-copy="${e.id}">複製文字</button></div>`);
}

async function markDone(id) {
  const amt = +document.querySelector(`[data-amt="${id}"]`).value;
  if (!amt) return toast('請輸入實收金額');
  const j = db.get('events', id);
  await db.update('events', id, { done: true, amount: amt });
  await db.add('transactions', { type: 'income', amount: amt, category: '搬家', work: true, biz: '公', account: '現金', date: j.date, time: j.time || '', note: j.title, eventId: id, source: '手動' });
  toast('已標記完成'); eventDetail(id); render();
}

// ================= 統計 =================
function bars(data, fmt = money) {
  const max = Math.max(1, ...data.map(d => Math.abs(d.v)));
  return `<div class="bars">${data.map(d => `<div class="bar"><span class="v">${fmt(d.v)}</span>
    <i style="height:${Math.round(Math.abs(d.v) / max * 100)}%" class="${d.v < 0 ? 'neg' : ''}"></i><span class="l">${esc(d.l)}</span></div>`).join('')}</div>`;
}
const PALETTE = ['#2f7de1', '#f08c2e', '#2bb673', '#9b59b6', '#e74c3c', '#16a5a5', '#d4a017', '#7f8c8d', '#c2185b', '#5d6d7e'];
function donut(obj) {
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
    <ul>${entries.map(([k, v], i) => `<li><i style="background:${PALETTE[i % 10]}"></i>${esc(k)}<b>${money(v)}</b><small>${Math.round(v / total * 100)}%</small></li>`).join('')}</ul></div>`;
}

function statsView() {
  const ym = state.statsYm, s = L.monthStats(ym), code = L.codes(), bills = L.cardBills(ym);
  const trend = [-5, -4, -3, -2, -1, 0].map(n => { const m = ymAdd(ym, n); return { m, s: L.monthStats(m) }; });
  const svc = Object.entries(s.service).sort((a, b) => b[1].count - a[1].count);
  return `<div class="month-nav"><button data-stats="-1">‹</button><h2>${ym.replace('-', ' 年 ')} 月</h2><button data-stats="1">›</button></div>
  <section><h3>工作</h3>
    <div class="cards three"><div class="card"><small>工作收入</small><b class="g">${money(s.workIncome)}</b></div>
      <div class="card"><small>工作成本</small><b class="r">${money(s.workCost)}</b></div>
      <div class="card"><small>淨利</small><b>${money(s.workNet)}</b></div></div>
    <div class="cards three"><div class="card"><small>工作件數</small><b>${s.jobs}</b><small>已完成 ${s.jobsDone}</small></div>
      <div class="card"><small>3.5 噸 / 2.7 噸</small><b>${s.truck['3.5']} / ${s.truck['2.7']}</b></div>
      <div class="card"><small>幫手費</small><b class="r">${money(s.helper)}</b></div></div>
    <table><tr><th>服務</th><th>次數</th><th>平均收</th></tr>
      ${svc.map(([k, v]) => `<tr><td>${esc(k)} ${esc(code[k] || '')}</td><td>${v.count}</td><td>${v.done ? money(v.total / v.done) : '—'}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">沒有工作</td></tr>'}</table>
    <h4>工作成本明細</h4>${donut(s.workCostBy)}
    <h4>近 6 個月工作淨利</h4>${bars(trend.map(t => ({ l: +t.m.slice(5) + '月', v: t.s.workNet })))}
  </section>
  <section><h3>個人支出</h3>${donut(s.personalBy)}
    <h4>近 6 個月個人支出</h4>${bars(trend.map(t => ({ l: +t.m.slice(5) + '月', v: t.s.personal })))}
    <h4>各付款方式支出</h4><table>${['現金', ...BANKS, '銀行戶頭'].map(a => `<tr><td>${a}</td><td>${money(s.byAccount[a] || 0)}</td></tr>`).join('')}</table>
  </section>
  <section><h3>財務流動</h3>
    <div class="cards three"><div class="card"><small>總收入</small><b class="g">${money(s.totalIncome)}</b></div>
      <div class="card"><small>總支出</small><b class="r">${money(s.totalExpense)}</b></div>
      <div class="card"><small>淨流動</small><b>${money(s.flow)}</b></div></div>
    ${bars(trend.map(t => ({ l: +t.m.slice(5) + '月', v: t.s.flow })))}
    <p class="muted">繳卡費算轉帳，不重複算成支出。</p>
  </section>
  <section><h3>本月要繳的卡費</h3><p class="muted">= ${bills.prev.replace('-', ' 年 ')} 月各卡消費</p>
    <table>${BANKS.map(b => `<tr><td>${b}</td><td>${money(bills.bills[b])}</td><td>${bills.paidBy[b] ? '已繳 ' + money(bills.paidBy[b]) : ''}</td></tr>`).join('')}
      <tr class="total"><td>合計</td><td>${money(bills.total)}</td><td></td></tr></table>
    <p class="muted">繳完在對話框打「繳台新 12000」就會記成轉帳。</p>
  </section>`;
}

// ================= 修改視窗 =================
function openModal(html) { $('#modal-body').innerHTML = html; $('#modal').classList.add('open'); }
function closeModal() { $('#modal').classList.remove('open'); $('#modal-body').innerHTML = ''; }

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
      <label class="check"><input type="checkbox" name="done" ${r.done ? 'checked' : ''}> 已完成</label>${f('實收金額', 'amount', r.amount || '', 'number')}
    </fieldset>
    <label>備註（完整內容）<textarea name="note" rows="6">${esc(r.note || '')}</textarea></label>`;
  else body = `
    <label>收支<select name="type">${[['expense', '支出'], ['income', '收入'], ['transfer', '繳卡費（轉帳）']].map(([v, t]) => `<option value="${v}" ${r.type === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    ${f('金額', 'amount', r.amount, 'number')}${f('日期', 'date', r.date, 'date')}${f('時間', 'time', r.time, 'time')}
    <label>分類<select name="category">${opt(cats.map(c => c.name).concat(['繳卡費']), r.category)}</select></label>
    <label>帳戶${r.type === 'transfer' ? '（繳哪張卡）' : ''}<select name="${r.type === 'transfer' ? 'to' : 'account'}">${opt(accs, r.type === 'transfer' ? r.to : r.account)}</select></label>
    <label>公／私<select name="biz">${opt(['公', '私'], r.biz)}</select></label>${f('備註', 'note', r.note)}`;
  openModal(`<h3>${draft ? '修改後再確認' : '修改'}</h3><form id="edit-form">${body}
    <div class="row"><button class="primary" type="submit">${draft ? '確認存檔' : '儲存'}</button>${draft ? '' : '<button type="button" class="danger" data-del>刪除</button>'}<button type="button" data-close>取消</button></div></form>`);
  const form = $('#edit-form');
  const toggle = () => form.querySelector('.jobonly')?.classList.toggle('hide', form.type.value !== 'job');
  toggle(); form.type.addEventListener('change', toggle);
  form.onsubmit = async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
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
      toast('已儲存');
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
  openModal(`<h3>設定</h3>
  <section><h4>帳號</h4>
    <p>${db.getMode() === 'local' ? '目前是<b>本機試用模式</b>：資料只存在這支手機的瀏覽器。照「設定教學」連上 Firebase 後就能雲端同步。' : `已登入：${esc(db.userName())}`}</p>
    ${db.getMode() === 'cloud' ? '<button data-act="logout">登出</button>' : ''}
  </section>
  <section><h4>匯出 Excel</h4><div class="row">
    <button data-export="${ym}">匯出本月</button><button data-export="${year}">匯出 ${year} 全年（報稅用）</button></div></section>
  <section><h4>匯入</h4>
    <label>TimeTree 舊資料（JSON 或 CSV：日期、標題、備註）<input type="file" accept=".json,.csv" id="tt-file"></label>
    <label>網銀下載的帳單（CSV／Excel／PDF）
      <select id="bill-bank">${BANKS.map(b => `<option>${b}</option>`).join('')}</select><input type="file" accept=".csv,.xls,.xlsx,.pdf" id="bill-file"></label>
  </section>
  <section><h4>Gmail 自動記帳</h4>
    <p class="muted">${st.gmailLinked ? '已連結過 Gmail。' : '尚未連結。'}只要求「唯讀」權限，只搜尋四家銀行的信，不會要你的 Gmail 密碼。</p>
    <button class="primary" data-act="gmail">讀取 Gmail 刷卡紀錄（最近 40 天）</button>
    <p class="muted">信用卡電子帳單 PDF 的密碼（多半是身分證字號），只存在你自己的資料裡：</p>
    ${BANKS.map(b => `<label>${b}<input type="password" data-pw="${b}" value="${esc(st.pdfPasswords?.[b] || '')}" autocomplete="off"></label>`).join('')}
    <label>寄件者 Email（選填，讓搜尋更準）${accs.filter(a => a.kind === '信用卡').map(a => `<input data-sender="${a.id}" placeholder="${a.name} 的寄件者，例如 service@xxx.com.tw" value="${esc(a.sender || '')}">`).join('')}</label>
    <button data-act="save-gmail">儲存密碼與寄件者</button>
  </section>
  <section><h4>快捷按鈕</h4><p class="muted">一行一個：顯示文字=輸入內容</p>
    <textarea id="sc-text" rows="4">${esc(scs.map(s => `${s.label}=${s.input}`).join('\n'))}</textarea><button data-act="save-sc">儲存</button></section>
  <section><h4>分類與關鍵字</h4><p class="muted">一行一個：名稱｜收入或支出｜公或私｜關鍵字,關鍵字</p>
    <textarea id="cat-text" rows="10">${esc(cats.map(c => `${c.name}｜${c.kind === 'income' ? '收入' : '支出'}｜${c.work ? '公' : '私'}｜${(c.keywords || []).join(',')}`).join('\n'))}</textarea>
    <button data-act="save-cat">儲存</button></section>
  <section><h4>代號對照表</h4><p class="muted">一行一個：數字=意思（0 固定代表 3.5 噸車）</p>
    <textarea id="code-text" rows="10">${esc(Object.entries(code).map(([k, v]) => `${k}=${v}`).join('\n'))}</textarea><button data-act="save-code">儲存</button></section>
  <div class="row"><button data-close>關閉</button></div>`);

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
  } else if (act === 'save-cat') {
    const lines = $('#cat-text').value.split('\n').map(l => l.split('｜')).filter(x => x[0]?.trim());
    for (const c of db.all('categories')) await db.remove('categories', c.id);
    await db.addMany('categories', lines.map(([name, kind, biz, kw], i) => ({ name: name.trim(), kind: (kind || '').includes('收') ? 'income' : 'expense', work: (biz || '').includes('公'), keywords: (kw || '').split(/[,，]/).map(s => s.trim()).filter(Boolean), order: i })));
  } else if (act === 'save-code') {
    const codes = Object.fromEntries($('#code-text').value.split('\n').map(l => l.split('=')).filter(x => x[1]).map(([k, v]) => [k.trim(), v.trim()]));
    await db.saveSettings({ codes: Object.keys(codes).length ? codes : DEFAULT_CODES });
  }
  toast('已儲存');
}

// 匯入確認清單（Gmail／帳單檔）
function reviewImport(items, title) {
  const errors = items.filter(x => x.error), list = items.filter(x => !x.error);
  list.forEach(x => { x.dup = L.findDuplicate(x); x.biz = x.biz || '私'; });
  const cats = L.categories().map(c => c.name);
  openModal(`<h3>${esc(title)}</h3>
    ${errors.map(e => `<p class="warn">${esc(e.error)}</p>`).join('')}
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
    await db.addMany('transactions', picked.map(x => ({ ...x, createdAt: new Date().toISOString() })));
    toast(`已匯入 ${picked.length} 筆`); closeModal(); render();
  };
}

async function readGmail() {
  try {
    toast('連結 Gmail 中…');
    const items = await G.fetchCardTransactions(40, msg => toast(msg));
    if (!items.length) return toast('沒有找到新的刷卡紀錄');
    reviewImport(items, 'Gmail 刷卡紀錄');
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

// ================= 主框架 =================
function render() {
  const view = $('#view');
  view.innerHTML = state.tab === 'chat' ? chatView() : state.tab === 'cal' ? calView() : statsView();
  document.querySelectorAll('nav [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  $('#composer').classList.toggle('hide', state.tab !== 'chat');
  $('#shortcuts').innerHTML = recentTx().map(t => `<button data-sc="${t.id}">${esc(txLabel(t))}</button>`).join('');
  $('#net').textContent = navigator.onLine ? '' : '離線中';
  if (state.tab === 'chat') { const log = $('#log'); if (log) log.scrollTop = log.scrollHeight; window.scrollTo(0, document.body.scrollHeight); }
  else if (state.lastTab !== state.tab) window.scrollTo(0, 0);
  state.lastTab = state.tab;
}

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-tab],[data-edit],[data-ev],[data-act],[data-cal],[data-cal-today],[data-stats],[data-done],[data-close],[data-sc],[data-prefill],[data-go],[data-export],[data-copy],[data-day],#gear');
  if (!t) return;
  const d = t.dataset;
  if (t.id === 'gear') return settingsView();
  if (d.tab) { state.tab = d.tab; render(); if (d.tab === 'chat') $('#input').focus(); }
  else if (d.go) { state.tab = d.go; render(); }
  else if (d.edit) { const [col, id] = d.edit.split(':'); editRecord(col, id); }
  else if (d.ev) eventDetail(d.ev);
  else if (d.cal) { state.calYm = ymAdd(state.calYm, +d.cal); render(); }
  else if (d.calToday !== undefined) { state.calYm = today().slice(0, 7); render(); }
  else if (d.stats) { state.statsYm = ymAdd(state.statsYm, +d.stats); render(); }
  else if (d.done) markDone(d.done);
  else if (d.close !== undefined) closeModal();
  else if (d.copy) { const ev = db.get('events', d.copy); navigator.clipboard?.writeText(`${evTitle(ev)}${ev.note ? '\n' + ev.note : ''}`).then(() => toast('已複製')); }
  else if (d.day) daySheet(d.day);
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
// Enter 送出；要換行用 Shift＋Enter（貼上的多行文字會保留）
const grow = () => { const i = $('#input'); i.style.height = 'auto'; i.style.height = Math.min(i.scrollHeight, 160) + 'px'; };
$('#input').addEventListener('input', grow);
$('#input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); }
});
// 行事曆左右滑換月
let touchX = null;
document.addEventListener('touchstart', e => { touchX = e.target.closest('#calgrid') ? e.touches[0].clientX : null; }, { passive: true });
document.addEventListener('touchend', e => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX; touchX = null;
  if (Math.abs(dx) > 60) { state.calYm = ymAdd(state.calYm, dx < 0 ? 1 : -1); render(); }
});
window.addEventListener('online', render);
window.addEventListener('offline', render);

(async function start() {
  const r = await db.init();
  if (r.needLogin) {
    $('#view').innerHTML = `<div class="login"><h2>搬家記帳</h2><p>請用你的 Google 帳號登入，資料只有你自己看得到。</p><button class="primary" data-act="login">用 Google 登入</button></div>`;
    $('#composer').classList.add('hide');
    return;
  }
  await L.seed();
  db.onChange(() => { if (!$('#modal').classList.contains('open')) render(); });
  render();
  $('#input').focus();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
