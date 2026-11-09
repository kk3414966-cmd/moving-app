// 存檔與統計：工作配對、當天成本、每月報表、卡費。
import * as db from './store.js';
import { DEFAULT_CATEGORIES, DEFAULT_CODES, BANKS, ymd, parseCode } from './parser.js';

export const codeInfo = raw => { const c = parseCode(raw || ''); return { truck: c.truck, services: c.services }; };

export const ACCOUNTS = [
  { id: 'cash', name: '現金', kind: '現金', use: '混用' },
  { id: 'bank', name: '銀行戶頭', kind: '銀行', use: '混用' },
  ...BANKS.map(b => ({ id: 'card-' + b, name: b, kind: '信用卡', use: '混用', sender: '' })),
];

// 第一次使用時放入預設資料
export async function seed() {
  if (!db.all('accounts').length) await db.addMany('accounts', ACCOUNTS);
  if (!db.all('categories').length) await db.addMany('categories', DEFAULT_CATEGORIES.map((c, i) => ({ ...c, id: 'cat' + i, order: i })));
  else for (const d of DEFAULT_CATEGORIES) { // 新版加的關鍵字補進去（使用者自己加的不動）
    const c = db.all('categories').find(x => x.name === d.name);
    const add = c ? d.keywords.filter(k => !(c.keywords || []).includes(k)) : [];
    if (add.length) await db.update('categories', c.id, { keywords: [...(c.keywords || []), ...add] });
  }
  if (!db.all('shortcuts').length) await db.addMany('shortcuts', [
    { id: 'sc1', label: '加油 $500', input: '-500加油', order: 1 },
    { id: 'sc2', label: '便當 $100', input: '-100便當', order: 2 },
    { id: 'sc3', label: '幫手 $1500', input: '-$1500幫手', order: 3 },
  ]);
  if (!db.get('settings', 'main')) await db.add('settings', { id: 'main', codes: DEFAULT_CODES, defaultAccount: '現金', pdfPasswords: {} });
}

export const codes = () => db.settings().codes || DEFAULT_CODES;
export const categories = () => db.all('categories').sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
export const catOf = name => categories().find(c => c.name === name);
export const isCard = name => BANKS.includes(name);

// 標籤（照使用者 TimeTree 的設定）
export const DEFAULT_LABELS = [
  { id: 1, name: '工作行程', color: '#2ecc87' }, { id: 6, name: '工作支出', color: '#e73b3b' },
  { id: 2, name: '其他工作', color: '#3dc2c8' }, { id: 3, name: '工作時數', color: '#47b2f7' },
  { id: 9, name: '休假安排', color: '#fdc02d' }, { id: 7, name: '記帳', color: '#f35f8c' },
  { id: 4, name: '出遊', color: '#948078' }, { id: 5, name: '黑色', color: '#212121' },
  { id: 8, name: '珊瑚粉', color: '#fb7f77' }, { id: 10, name: '紫色', color: '#b38bdc' },
];
export const labels = () => db.settings().labels || DEFAULT_LABELS;
export const labelOf = id => labels().find(l => l.id === +id) || labels()[0];

// 對話框輸入時自動配的標籤：工作、工作支出、記帳、記事
export const AUTO_KINDS = [['job', '工作'], ['workTx', '工作支出（幫手、油錢…）'], ['tx', '記帳（個人收支）'], ['note', '記事（一般行程）']];
export const autoLabels = () => ({ job: 1, workTx: 6, tx: 7, note: 2, ...(db.settings().autoLabels || {}) });
export const eventLabel = e => e.label ?? (e.type === 'job' ? autoLabels().job : autoLabels().note);
export const txLabelId = t => t.label ?? (t.biz === '公' ? autoLabels().workTx : autoLabels().tx);

// 這筆行程有沒有落在這一天（含多天、重複）
const dayNum = d => Math.round(new Date(d + 'T00:00:00Z') / 864e5);
export function covers(e, date) {
  const start = e.date, end = e.endDate && e.endDate > e.date ? e.endDate : e.date;
  if (date < start) return false;
  if (!e.repeat) return date <= end;
  const span = dayNum(end) - dayNum(start), off = dayNum(date) - dayNum(start);
  if (e.repeatUntil && date > e.repeatUntil) return false;
  if (e.repeat === 'daily') return true;
  if (e.repeat === 'weekly') return off % 7 <= span;
  const [, sm, sd] = start.split('-').map(Number), [, m, d] = date.split('-').map(Number);
  if (e.repeat === 'monthly') return span ? off % 30 <= span && d >= sd && d <= sd + span : d === sd;
  if (e.repeat === 'yearly') return m === sm && d >= sd && d <= sd + span;
  return date <= end;
}
export const eventsOn = date => db.all('events').filter(e => covers(e, date)).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
export const txsOn = date => db.all('transactions').filter(t => t.date === date).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
export const hasJob = date => db.all('events').some(e => e.date === date && e.type === 'job');

// 找出要被「$金額 …」標記完成的那筆未完成工作
function findOpenJob(ev) {
  const key = s => (s || '').replace(/\s+/g, '');
  const cands = db.all('events').filter(e => e.type === 'job' && !e.done &&
    (key(e.title) === key(ev.title) || (e.codeRaw === ev.codeRaw && e.client && e.client === ev.client)));
  if (!cands.length) return null;
  const dist = e => Math.abs(new Date(e.date) - new Date(ev.date));
  return cands.sort((a, b) => dist(a) - dist(b))[0];
}

// 每個支出分類算公帳還是私帳：'公' 一律公、'私' 一律私、'day' 當天有工作才算公
const DAY_BASED = ['加油', '停車', '過路費', '租車'];
export const bizModeOf = c => c?.bizMode || (c?.work ? (DAY_BASED.includes(c.name) ? 'day' : '公') : '私');
export function bizFor(tx, date) {
  if (tx.type !== 'expense') return tx.type === 'income' && tx.work ? '公' : (tx.type === 'income' ? '私' : '');
  const mode = bizModeOf(catOf(tx.category));
  return mode === 'day' ? (hasJob(date) ? '公' : '私') : mode;
}

// 改分類的公私設定，以前記的同分類全部一起改，回傳改了幾筆
// 平常手機裡只有最近 3 個月：要一起改以前的帳，先把那個分類的帳（和那幾天的行程）讀進來
async function loadCategory(name, withDays) {
  await db.ensureWhere('transactions', 'category', name);
  if (withDays) await loadDaysOf(db.all('transactions').filter(t => t.category === name));
}
async function loadDaysOf(list) {
  const dates = list.map(t => t.date).filter(Boolean).sort();
  if (dates.length) await db.ensureRange(dates[0], dates[dates.length - 1]);
}

export async function setCategoryBiz(id, mode) {
  const c = db.get('categories', id);
  await loadCategory(c.name, mode === 'day'); // 「當天有工作才算公」才要看以前的行程
  await db.update('categories', id, { bizMode: mode, work: mode !== '私' });
  let n = 0;
  for (const t of db.all('transactions').filter(t => t.type === 'expense' && t.category === c.name)) {
    const biz = bizFor(t, t.date);
    if (t.biz !== biz) { await db.update('transactions', t.id, { biz }); n++; }
  }
  return n;
}

// 分類改名：以前記的也跟著改名
export async function renameCategory(id, name) {
  const old = db.get('categories', id).name;
  await db.ensureWhere('transactions', 'category', old);
  await db.update('categories', id, { name });
  for (const t of db.all('transactions').filter(t => t.category === old)) await db.update('transactions', t.id, { category: name });
}

// 同一家店的消費：名稱包含關鍵字的全部改成同一個分類（公私也照新分類重算）
export const sameMerchant = (key, type = 'expense') => !key ? [] :
  db.all('transactions').filter(t => t.type === type && (t.note || '').toLowerCase().includes(key.toLowerCase()));
export async function recategorize(list, category) {
  await loadDaysOf(list); // 公私要看那天有沒有工作
  for (const t of list) await db.update('transactions', t.id, { category, biz: bizFor({ ...t, category }, t.date) });
}
// 記住「名稱包含 X → 分類 Y」，之後從 Gmail 抓到的自動套用
export const merchantRules = () => db.settings().merchantRules || {};
export const ruleFor = note => {
  const n = (note || '').toLowerCase();
  return Object.entries(merchantRules()).find(([k]) => n.includes(k.toLowerCase()))?.[1];
};

/** 把確認卡片上的解析結果寫入資料庫，回傳寫了哪些東西 */
export async function saveParsed(p, source = '手動') {
  const saved = [];
  let eventId = null;
  if (p.event) {
    const ev = { ...p.event, raw: p.raw, source };
    if (!ev.lead) { const ld = leadFromTitle(ev.title || p.raw); if (ld) ev.lead = ld; }
    if (ev.label == null) {
      const a = autoLabels(), workCost = p.txs.some(t => t.type === 'expense' && catOf(t.category)?.work);
      ev.label = ev.type === 'job' ? a.job : workCost ? a.workTx : p.txs.length ? a.tx : a.note;
    }
    const open = ev.type === 'job' && ev.done ? findOpenJob(ev) : null;
    if (open) {
      // 跟 TimeTree 習慣一樣：完成後標題最前面寫上實收金額
      const title = /^\s*(\$|\d+-\d+\s)/.test(open.title || '') ? open.title : `$${ev.amount} ${open.title || ''}`.trim();
      await db.update('events', open.id, { done: true, amount: ev.amount, doneRaw: p.raw, title });
      eventId = open.id; saved.push({ col: 'events', id: open.id, matched: true });
      p.txs.forEach(t => { if (t.matchJob) t.date = open.date; });
    } else {
      const r = await db.add('events', ev); eventId = r.id; saved.push({ col: 'events', id: r.id });
      // 「1105、06、09~12」這種好幾天的行程，每一天都建一筆
      for (const d of (p.dates || []).slice(1)) {
        const extra = await db.add('events', { ...ev, date: d, done: false, amount: 0 }); saved.push({ col: 'events', id: extra.id });
      }
    }
  }
  for (const t of p.txs) {
    const date = t.date || p.date;
    const tx = { ...t, date, time: t.time || p.time || '', source, raw: p.raw };
    delete tx.matchJob;
    if (eventId && ((p.event?.type === 'job' && t.type === 'income') || source === 'TimeTree')) tx.eventId = eventId;
    if (tx.type !== 'transfer' && !tx.biz) tx.biz = bizFor(tx, date);
    if (!tx.account && tx.type !== 'transfer') tx.account = db.settings().defaultAccount || '現金';
    const r = await db.add('transactions', tx); saved.push({ col: 'transactions', id: r.id });
  }
  return saved;
}

// ---- 統計 ----
const sum = (list, f = x => x.amount) => list.reduce((s, x) => s + (+f(x) || 0), 0);
export const monthOf = d => d.slice(0, 7);

export function dayInfo(date) {
  const txs = txsOn(date);
  const workIncome = sum(txs.filter(t => t.type === 'income' && t.biz === '公'));
  const workCost = sum(txs.filter(t => t.type === 'expense' && t.biz === '公'));
  return { events: eventsOn(date), txs, workIncome, workCost, net: workIncome - workCost };
}

export function monthStats(ym) {
  const txs = db.all('transactions').filter(t => monthOf(t.date) === ym);
  const jobs = db.all('events').filter(e => e.type === 'job' && monthOf(e.date) === ym);
  const inc = txs.filter(t => t.type === 'income'), exp = txs.filter(t => t.type === 'expense');
  const workInc = inc.filter(t => t.biz === '公'), workExp = exp.filter(t => t.biz === '公'), persExp = exp.filter(t => t.biz !== '公');
  const groupBy = (list, key) => list.reduce((m, x) => (m[key(x)] = (m[key(x)] || 0) + (+x.amount || 0), m), {});

  const service = {};
  for (const j of jobs) for (const s of j.services || []) {
    const o = service[s] = service[s] || { count: 0, done: 0, total: 0 };
    o.count++; if (j.done) { o.done++; o.total += +j.amount || 0; }
  }
  const t35 = jobs.filter(j => j.truck === '3.5').length;
  return {
    ym, workIncome: sum(workInc), workCost: sum(workExp), workNet: sum(workInc) - sum(workExp),
    workCostBy: groupBy(workExp, t => t.category), helper: sum(workExp.filter(t => t.category === '幫手')),
    jobs: jobs.length, jobsDone: jobs.filter(j => j.done).length, openJobs: jobs.filter(j => !j.done && j.date < ymd(new Date())),
    service, truck: { '3.5': t35, '2.7': jobs.length - t35 },
    personal: sum(persExp), personalBy: groupBy(persExp, t => t.category),
    byAccount: groupBy(exp, t => t.account || '現金'),
    totalIncome: sum(inc), totalExpense: sum(exp), flow: sum(inc) - sum(exp),
  };
}

// 本月要繳的卡費 = 上個月各卡消費（扣掉退款）
export function cardBills(ym) {
  const [y, m] = ym.split('-').map(Number);
  const prev = ymd(new Date(y, m - 2, 1)).slice(0, 7);
  const txs = db.all('transactions').filter(t => monthOf(t.date) === prev && isCard(t.account));
  const bills = Object.fromEntries(BANKS.map(b => [b, 0]));
  for (const t of txs) bills[t.account] += t.type === 'expense' ? +t.amount : t.type === 'income' ? -t.amount : 0;
  // 有抓到帳單的，直接用帳單上的「本期應繳」（截止日在這個月的那一期）
  const cs = db.settings().cardStatements || {}, dueDate = {}, estimated = {};
  for (const b of BANKS) {
    const st = (cs[b] || []).filter(s => (s.dueDate || '').slice(0, 7) === ym);
    if (st.length) { bills[b] = sum(st); dueDate[b] = st.map(s => s.dueDate).sort().pop(); }
    else estimated[b] = bills[b] > 0;
  }
  const paid = db.all('transactions').filter(t => t.type === 'transfer' && monthOf(t.date) === ym);
  const paidBy = Object.fromEntries(BANKS.map(b => [b, sum(paid.filter(t => t.to === b))]));
  return { prev, bills, total: sum(Object.values(bills), x => x), paidBy, dueDate, estimated };
}

export function recent(n = 40) {
  const list = [
    ...db.all('events').map(e => ({ col: 'events', rec: e })),
    ...db.all('transactions').filter(t => !t.eventId).map(t => ({ col: 'transactions', rec: t })),
  ];
  return list.sort((a, b) => (b.rec.createdAt || '').localeCompare(a.rec.createdAt || '')).slice(0, n).reverse();
}

// 去重：同帳戶、同金額、日期差 2 天內
export function findDuplicate(tx, skip = new Set()) {
  const list = db.all('transactions').filter(t => !skip.has(t.id));
  if (tx.externalId && list.some(t => t.externalId === tx.externalId)) return true;
  return list.some(t => t.account === tx.account && +t.amount === +tx.amount && t.type === tx.type &&
    Math.abs(new Date(t.date) - new Date(tx.date)) <= 2 * 864e5);
}

// 客源選項（可在設定裡自己改名稱）
export const DEFAULT_LEADS = ['回頭客', '粉專', 'Google 地圖', 'Google 廣告', '社團', '朋友介紹', 'AI 推薦', '其他'];
// 標題最後的來源字（地／回／粉）→ 客源。賴＝LINE 是回覆管道，不是客源，所以不填。
export const DEFAULT_LEAD_MAP = { '地': 'Google 地圖', '回': '回頭客', '粉': '粉專' };
export const leadFromTitle = t => { const w = String(t || '').trim().split(/\s+/); const last = w[w.length - 1] || ''; const k = last.includes('.') ? last.slice(last.lastIndexOf('.') + 1) : (w.length > 1 ? last : ''); const m = db.settings().leadMap || DEFAULT_LEAD_MAP; return (k && (m[k] || (leads().find(x => x.replace(/\s+/g, '') === k) || ''))) || ''; };
export const leads = () => db.settings().leads || DEFAULT_LEADS;
export const leadOptions = cur => { const ls = leads(); const all = cur && !ls.includes(cur) ? [...ls, cur] : ls; return `<option value="">（未填）</option>${all.map(x => `<option ${x === cur ? 'selected' : ''}>${x.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</option>`).join('')}`; };
