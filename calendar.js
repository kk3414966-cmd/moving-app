// 行事曆：照 TimeTree 的操作邏輯
//  月曆：多天行程連成長條、標籤顏色；點日期 → 當天清單；點行程 → 內容；右下「＋」新增
//  週曆、搜尋、新增／編輯表單（標題、全天、開始、結束、重複、標籤、備註）
import * as db from './store.js';
import * as L from './ledger.js';
import { parseLine, ymd } from './parser.js';

let C; // 從 app.js 傳進來：openModal, closeModal, toast, render, editTx, state
export const initCalendar = ctx => { C = ctx; };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + Math.round(+n || 0).toLocaleString('zh-TW');
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const today = () => ymd(new Date());
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return ymd(x); };
const ymAdd = (ym, n) => { const [y, m] = ym.split('-').map(Number); return ymd(new Date(y, m - 1 + n, 1)).slice(0, 7); };
const fmtDay = d => { const x = new Date(d + 'T00:00:00'); return `${x.getFullYear()}年${x.getMonth() + 1}月${x.getDate()}日（${WEEK[x.getDay()]}）`; };
const REPEAT = { '': '無重複', daily: '每天', weekly: '每週', monthly: '每月', yearly: '每年' };

export const evTitle = e => e.title || [e.codeRaw && e.codeRaw + '.', e.route, e.client].filter(Boolean).join(' ');
export const txLabel = t => `${t.type === 'income' ? '+' : t.type === 'expense' ? '-' : '⇄'}${Math.round(t.amount).toLocaleString('zh-TW')} ${t.note || t.category}`;
const isLate = e => e.type === 'job' && !e.done && e.date < today();
const colorOf = e => L.labelOf(e.label ?? 1).color;
const timeText = e => e.allDay || !e.time ? '全天' : `${e.time}${e.endTime && e.endTime !== e.time ? ' - ' + e.endTime : ''}`;

// 行事曆上要畫的東西：行程＋沒有連到工作的收支
function items() {
  const evs = db.all('events').map(e => ({ kind: 'ev', id: e.id, rec: e, multi: (e.endDate && e.endDate > e.date) || false, bar: e.allDay || !e.time || (e.endDate && e.endDate > e.date) }));
  const txs = db.all('transactions').filter(t => !t.eventId).map(t => ({ kind: 'tx', id: t.id, rec: { ...t, date: t.date }, multi: false, bar: false }));
  return [...evs, ...txs];
}
const coversItem = (it, d) => it.kind === 'tx' ? it.rec.date === d : L.covers(it.rec, d);

// ================= 月曆 =================
const LANES = 4;
export function calView() {
  const st = C.state;
  if (st.calMode === 'week') return weekView();
  const ym = st.calYm, [y, m] = ym.split('-').map(Number);
  const first = ymd(new Date(y, m - 1, 1)), lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const start = addDays(first, -lead), weeks = Math.ceil((lead + new Date(y, m, 0).getDate()) / 7);
  const all = items().filter(it => it.kind === 'tx' || true);
  let html = '';
  for (let w = 0; w < weeks; w++) {
    const days = [...Array(7)].map((_, i) => addDays(start, w * 7 + i));
    // 這一週每筆的連續區段
    const segs = [];
    for (const it of all) {
      if (it.kind === 'tx' && (it.rec.date < days[0] || it.rec.date > days[6])) continue;
      if (it.kind === 'ev' && !it.rec.repeat && (it.rec.date > days[6] || (it.rec.endDate || it.rec.date) < days[0])) continue;
      let s = -1;
      for (let i = 0; i <= 7; i++) {
        const on = i < 7 && coversItem(it, days[i]);
        if (on && s < 0) s = i;
        if (!on && s >= 0) { segs.push({ it, s, e: i - 1, cont: it.kind === 'ev' && days[s] > it.rec.date && !it.rec.repeat }); s = -1; }
      }
    }
    segs.sort((a, b) => (b.e - b.s) - (a.e - a.s) || (b.it.bar - a.it.bar) || (a.it.kind === 'tx') - (b.it.kind === 'tx') || (a.it.rec.time || '').localeCompare(b.it.rec.time || '') || a.s - b.s);
    const used = [...Array(7)].map(() => []), hidden = Array(7).fill(0);
    for (const sg of segs) {
      let lane = 0;
      while ([...Array(sg.e - sg.s + 1)].some((_, k) => used[sg.s + k][lane])) lane++;
      for (let k = sg.s; k <= sg.e; k++) used[k][lane] = true;
      sg.lane = lane;
      if (lane >= LANES - 1) for (let k = sg.s; k <= sg.e; k++) hidden[k]++;
    }
    // 某天有超過的，最後一格改成「+N」
    const bars = segs.filter(sg => sg.lane < LANES - 1 || (sg.lane === LANES - 1 && [...Array(sg.e - sg.s + 1)].every((_, k) => hidden[sg.s + k] <= 1)));
    const cells = days.map((d, i) => {
      const other = +d.slice(5, 7) !== m, dow = new Date(d + 'T00:00:00').getDay();
      const more = hidden[i] > 1 ? `<span class="tt-more">+${hidden[i]}</span>` : '';
      return `<div class="tc ${other ? 'other' : ''} ${d === today() ? 'today' : ''} ${d === st.selDay ? 'sel' : ''} d${dow}" data-day="${d}"><span class="dn">${+d.slice(8)}</span>${more}</div>`;
    }).join('');
    const segHtml = bars.map(sg => {
      const r = sg.it.rec, left = `calc(${sg.s} * 100% / 7 + 1px)`, width = `calc(${sg.e - sg.s + 1} * 100% / 7 - 2px)`, top = 17 + sg.lane * 15;
      if (sg.it.kind === 'tx') return `<div class="seg tx ${r.type}" style="left:${left};width:${width};top:${top}px">${esc(txLabel(r))}</div>`;
      const c = colorOf(r), late = isLate(r) ? 'late' : '';
      return sg.it.bar
        ? `<div class="seg bar ${late}" style="left:${left};width:${width};top:${top}px;background:${c}">${esc(evTitle(r))}</div>`
        : `<div class="seg dot ${late}" style="left:${left};width:${width};top:${top}px"><i style="background:${c}"></i>${esc(evTitle(r))}</div>`;
    }).join('');
    html += `<div class="tweek">${cells}<div class="tsegs">${segHtml}</div></div>`;
  }
  return `${head(`${y}年${m}月`)}
    <div class="twk">${['一', '二', '三', '四', '五', '六', '日'].map((w, i) => `<div class="${i === 5 ? 'sat' : i === 6 ? 'sun' : ''}">${w}</div>`).join('')}</div>
    <div id="calgrid" class="tmonth">${html}</div>${fab()}`;
}

const head = title => `<div class="cal-head"><h2>${title}</h2>
  <div class="cal-tools"><button data-c-search aria-label="搜尋">🔍</button><button data-c-today>今天</button>
  <span class="seg-toggle"><button data-c-mode="month" class="${C.state.calMode !== 'week' ? 'on' : ''}">月</button><button data-c-mode="week" class="${C.state.calMode === 'week' ? 'on' : ''}">週</button></span></div></div>`;
const fab = () => `<button class="fab" data-c-new aria-label="新增行程">＋</button>`;

// ================= 週曆 =================
function weekView() {
  const st = C.state, base = st.selDay || today(), dow = (new Date(base + 'T00:00:00').getDay() + 6) % 7;
  const mon = addDays(base, -dow + (st.weekOff || 0) * 7), days = [...Array(7)].map((_, i) => addDays(mon, i));
  const all = items();
  const rows = days.map(d => {
    const list = all.filter(it => coversItem(it, d)).sort((a, b) => (b.bar - a.bar) || (a.kind === 'tx') - (b.kind === 'tx') || (a.rec.time || '').localeCompare(b.rec.time || ''));
    const x = new Date(d + 'T00:00:00');
    return `<div class="wrow ${d === today() ? 'today' : ''}" data-day="${d}">
      <div class="wdate d${x.getDay()}"><b>${x.getDate()}</b><small>${WEEK[x.getDay()]}</small></div>
      <div class="wlist">${list.map(it => it.kind === 'tx'
        ? `<div class="wi tx ${it.rec.type}" data-c-tx="${it.id}">${esc(txLabel(it.rec))}</div>`
        : `<div class="wi ${isLate(it.rec) ? 'late' : ''}" data-c-ev="${it.id}"><i style="background:${colorOf(it.rec)}"></i><span class="wt">${timeText(it.rec)}</span>${esc(evTitle(it.rec))}</div>`).join('') || '<span class="muted">　</span>'}</div></div>`;
  }).join('');
  const t = `${+mon.slice(5, 7)}月${+mon.slice(8)}日 – ${+days[6].slice(5, 7)}月${+days[6].slice(8)}日`;
  return `${head(t)}<div class="week-nav"><button data-c-week="-1">‹ 上週</button><button data-c-week="1">下週 ›</button></div>
    <div id="calgrid" class="tweekview">${rows}</div>${fab()}`;
}

// ================= 當天清單 =================
export function openDay(date) {
  C.state.selDay = date;
  const all = items().filter(it => coversItem(it, date));
  const evs = all.filter(it => it.kind === 'ev').sort((a, b) => (b.bar - a.bar) || (a.rec.time || '').localeCompare(b.rec.time || ''));
  const txs = all.filter(it => it.kind === 'tx');
  const info = L.dayInfo(date);
  C.openModal(`<div class="sheet-head"><h3>${fmtDay(date)}</h3><button data-close>✕</button></div>
    ${evs.map(({ rec: e }) => `<div class="trow ${isLate(e) ? 'late' : ''}" data-c-ev="${e.id}">
      <span class="tt-time">${timeText(e).replace(' - ', '<br>')}</span><span class="bar" style="background:${colorOf(e)}"></span>
      <span class="tt-title">${esc(evTitle(e))}${e.type === 'job' ? `<small>${e.done ? '實收 ' + money(e.amount) : isLate(e) ? '還沒記收入' : '未完成'}</small>` : ''}</span></div>`).join('') || '<p class="muted center">沒有行程</p>'}
    ${txs.map(({ rec: t }) => `<div class="trow" data-c-tx="${t.id}"><span class="tt-time">${t.time || ''}</span>
      <span class="bar" style="background:${L.labelOf(7).color}"></span><span class="tt-title">${esc(txLabel(t))}<small>${esc(t.category)}｜${esc(t.account || t.to)}${t.biz === '公' ? '｜公' : ''}</small></span></div>`).join('')}
    ${info.workIncome || info.workCost ? `<p class="muted">工作收入 ${money(info.workIncome)}｜成本 ${money(info.workCost)}｜淨賺 <b>${money(info.net)}</b></p>` : ''}
    <button class="primary wide" data-c-new="${date}">＋ 新增行程</button>`);
}

// ================= 行程內容 =================
export function openEvent(id) {
  const e = db.get('events', id); if (!e) return;
  const code = L.codes(), lb = L.labelOf(e.label ?? 1);
  const range = e.endDate && e.endDate > e.date ? `${fmtDay(e.date)}${e.time ? ' ' + e.time : ''}<br>～ ${fmtDay(e.endDate)}${e.endTime ? ' ' + e.endTime : ''}` : `${fmtDay(e.date)}<br>${timeText(e)}`;
  C.openModal(`<div class="sheet-head"><button data-day="${e.date}">‹ 當天</button><button data-close>✕</button></div>
    <div class="ev-label" style="background:${lb.color}"></div>
    <h3 class="ev-title">${esc(evTitle(e))}</h3>
    <p class="ev-when">${range}</p>
    <div class="ev-meta"><span><i style="background:${lb.color}"></i>${esc(lb.name)}</span>${e.repeat ? `<span>🔁 ${REPEAT[e.repeat] || e.repeat}</span>` : ''}</div>
    ${e.type === 'job' ? `<p class="muted">${e.truck} 噸｜${(e.services || []).map(s => esc(code[s] || s)).join('、')}${e.from ? `｜${esc(e.from)}→${esc(e.to)}` : ''}${e.fromFloor !== '' && e.fromFloor != null ? `｜樓層 ${esc(e.fromFloor)}→${esc(e.toFloor)}` : ''}${e.contact ? '｜' + esc(e.contact) : ''}</p>
      ${e.done ? `<p><span class="tag ok">實收 ${money(e.amount)}</span></p>` : `<div class="row ${isLate(e) ? 'late' : ''}"><input type="number" inputmode="numeric" placeholder="實收金額" data-amt="${e.id}"><button class="primary" data-c-done="${e.id}">完成</button></div>`}` : ''}
    ${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}
    <div class="row"><button class="primary" data-c-edit="${e.id}">編輯</button><button data-c-dup="${e.id}">複製行程</button><button data-c-copy="${e.id}">複製文字</button><button class="danger" data-c-del="${e.id}">刪除</button></div>`);
}

async function markDone(id) {
  const amt = +document.querySelector(`[data-amt="${id}"]`).value;
  if (!amt) return C.toast('請輸入實收金額');
  const j = db.get('events', id);
  await db.update('events', id, { done: true, amount: amt });
  await db.add('transactions', { type: 'income', amount: amt, category: '搬家', work: true, biz: '公', account: '現金', date: j.date, time: j.time || '', note: j.title, eventId: id, source: '手動' });
  C.toast('已標記完成'); openEvent(id); C.render();
}

// ================= 新增／編輯表單 =================
export function openForm(id, date, copyFrom) {
  const src = id ? db.get('events', id) : copyFrom ? { ...db.get('events', copyFrom), done: false, amount: 0 } : null;
  const e = src || { title: '', date: date || C.state.selDay || today(), allDay: false, time: '', endTime: '', label: 1, repeat: '', note: '' };
  const end = e.endDate || e.date;
  const allDay = e.allDay || !e.time;
  C.openModal(`<form id="evform">
    <div class="sheet-head"><button type="button" data-close>取消</button><b>${id ? '編輯行程' : '建立新行程'}</b><button type="submit" class="primary">保存</button></div>
    <input name="title" class="f-title" placeholder="行程標題（必填）" value="${esc(e.title)}" autocomplete="off">
    <div class="f-row"><span>全天</span><label class="switch"><input type="checkbox" name="allDay" ${allDay ? 'checked' : ''}><i></i></label></div>
    <div class="f-row"><span>開始</span><div><input type="date" name="date" value="${e.date}"><input type="time" name="time" value="${e.time || '10:00'}" class="tm"></div></div>
    <div class="f-row"><span>結束</span><div><input type="date" name="endDate" value="${end}"><input type="time" name="endTime" value="${e.endTime || (e.time ? addHour(e.time) : '11:00')}" class="tm"></div></div>
    <div class="f-row"><span>重複</span><select name="repeat">${Object.entries(REPEAT).map(([v, t]) => `<option value="${v}" ${(e.repeat || '') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="f-row col"><span>標籤</span><div class="labels">${L.labels().map(l => `<label class="lb"><input type="radio" name="label" value="${l.id}" ${+(e.label ?? 1) === l.id ? 'checked' : ''}><i style="background:${l.color}"></i>${esc(l.name || '　')}</label>`).join('')}</div></div>
    <div class="f-row col"><span>備註</span><textarea name="note" rows="6" placeholder="備註">${esc(e.note || '')}</textarea></div>
    ${id ? '<button type="button" class="danger wide" data-c-del="' + id + '">刪除這個行程</button>' : ''}
  </form>`);
  const f = document.querySelector('#evform');
  const sync = () => f.querySelectorAll('.tm').forEach(t => t.classList.toggle('hide', f.allDay.checked));
  sync(); f.allDay.addEventListener('change', sync);
  f.date.addEventListener('change', () => { if (f.endDate.value < f.date.value) f.endDate.value = f.date.value; });
  if (!id) setTimeout(() => f.title.focus(), 50);
  f.onsubmit = async ev => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    if (!d.title.trim()) return C.toast('請輸入行程標題');
    const rec = {
      title: d.title.trim(), date: d.date, endDate: d.endDate > d.date ? d.endDate : '', allDay: f.allDay.checked,
      time: f.allDay.checked ? '' : d.time, endTime: f.allDay.checked ? '' : d.endTime, repeat: d.repeat, label: +d.label, note: d.note,
    };
    // 標題是代號寫法就當成工作（例如 03.西區北區0.3 nam 賴）
    const p = parseLine(rec.title, { now: new Date(rec.date + 'T00:00:00') });
    if (p?.event?.type === 'job') {
      const j = p.event;
      Object.assign(rec, { type: 'job', codeRaw: j.codeRaw, truck: j.truck, services: j.services, route: j.route, from: j.from, to: j.to, fromFloor: j.fromFloor, toFloor: j.toFloor, client: j.client, contact: j.contact });
      if (!id && j.done) Object.assign(rec, { done: true, amount: j.amount });
    } else rec.type = 'event';
    if (id) await db.update('events', id, rec); else await db.add('events', { ...rec, done: rec.done || false, amount: rec.amount || 0, source: '手動' });
    C.toast('已保存'); C.state.selDay = rec.date; C.closeModal(); C.render();
  };
}
const addHour = t => { const [h, m] = t.split(':').map(Number); return `${String(Math.min(h + 1, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };

// ================= 搜尋 =================
function openSearch() {
  C.openModal(`<div class="sheet-head"><h3>搜尋行程</h3><button data-close>✕</button></div>
    <input id="c-q" placeholder="輸入客人名字、地點、關鍵字" autocomplete="off"><div id="c-res"></div>`);
  const q = document.querySelector('#c-q'), res = document.querySelector('#c-res');
  q.focus();
  q.oninput = () => {
    const k = q.value.trim().toLowerCase();
    if (!k) { res.innerHTML = ''; return; }
    const hit = db.all('events').filter(e => `${e.title} ${e.note || ''}`.toLowerCase().includes(k)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);
    res.innerHTML = hit.map(e => `<div class="trow" data-c-ev="${e.id}"><span class="tt-time">${e.date.slice(2).replace(/-/g, '/')}</span><span class="bar" style="background:${colorOf(e)}"></span><span class="tt-title">${esc(evTitle(e))}</span></div>`).join('') || '<p class="muted center">找不到</p>';
  };
}

// ================= 點擊 =================
document.addEventListener('click', async ev => {
  const t = ev.target.closest('[data-c-ev],[data-c-tx],[data-c-new],[data-c-edit],[data-c-dup],[data-c-copy],[data-c-del],[data-c-done],[data-c-mode],[data-c-today],[data-c-search],[data-c-week]');
  if (!t) return;
  ev.stopPropagation();
  const d = t.dataset, st = C.state;
  if (d.cEv) openEvent(d.cEv);
  else if (d.cTx) C.editTx(d.cTx);
  else if (d.cNew !== undefined) openForm(null, d.cNew || st.selDay || today());
  else if (d.cEdit) openForm(d.cEdit);
  else if (d.cDup) openForm(null, null, d.cDup);
  else if (d.cCopy) { const e = db.get('events', d.cCopy); navigator.clipboard?.writeText(`${evTitle(e)}${e.note ? '\n' + e.note : ''}`).then(() => C.toast('已複製')); }
  else if (d.cDel) {
    if (!confirm('確定要刪除這個行程嗎？')) return;
    await db.remove('events', d.cDel);
    for (const x of db.all('transactions').filter(x => x.eventId === d.cDel)) await db.remove('transactions', x.id);
    C.toast('已刪除'); C.closeModal(); C.render();
  }
  else if (d.cDone) markDone(d.cDone);
  else if (d.cMode) { st.calMode = d.cMode; st.weekOff = 0; C.render(); }
  else if (d.cToday !== undefined) { st.calYm = today().slice(0, 7); st.selDay = today(); st.weekOff = 0; C.render(); }
  else if (d.cSearch !== undefined) openSearch();
  else if (d.cWeek) { st.weekOff = (st.weekOff || 0) + +d.cWeek; C.render(); }
}, true);

// 左右滑換月（週曆換週）
let touch = null;
document.addEventListener('touchstart', e => { touch = e.target.closest('#calgrid') ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
document.addEventListener('touchend', e => {
  if (!touch) return;
  const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y; touch = null;
  if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
  const st = C.state;
  if (st.calMode === 'week') st.weekOff = (st.weekOff || 0) + (dx < 0 ? 1 : -1);
  else st.calYm = ymAdd(st.calYm, dx < 0 ? 1 : -1);
  C.render();
});
