// 檔案相關：Excel 匯出、TimeTree 舊資料匯入、上傳帳單（CSV／Excel／PDF）轉文字。
import * as db from './store.js';
import { parseLine } from './parser.js';
import { monthStats, categories, codes } from './ledger.js';

const libs = {};
function loadScript(src) {
  return libs[src] ||= new Promise((ok, fail) => {
    const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error('載入失敗，請確認網路'));
    document.head.appendChild(s);
  });
}
export const loadXLSX = () => loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js').then(() => window.XLSX);
export async function loadPDF() {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  return window.pdfjsLib;
}

// ---- 匯出 Excel ----
export async function exportExcel(from, to, filename) {
  const XLSX = await loadXLSX();
  await db.ensureRange(from, to); // 匯出舊月份：先把那段日期讀進來
  const inRange = d => d >= from && d <= to;
  const code = codes();
  const jobs = db.all('events').filter(e => e.type === 'job' && inRange(e.date)).sort((a, b) => a.date.localeCompare(b.date));
  const txs = db.all('transactions').filter(t => inRange(t.date)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(jobs.map(j => ({
    日期: j.date, 時間: j.time, 代號: j.codeRaw, 車型: j.truck + ' 噸', 服務: (j.services || []).map(s => code[s] || s).join('、'),
    起點: j.from, 終點: j.to, 起點樓層: j.fromFloor, 終點樓層: j.toFloor, 客戶: j.client, 聯絡方式: j.contact,
    完成: j.done ? '是' : '否', 實收: j.done ? +j.amount : '',
  }))), '工作明細');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(txs.map(t => ({
    日期: t.date, 時間: t.time, 收支: { income: '收入', expense: '支出', transfer: '轉帳' }[t.type], 金額: +t.amount,
    分類: t.category, 帳戶: t.type === 'transfer' ? `${t.from}→${t.to}` : t.account, 公私: t.biz, 備註: t.note, 來源: t.source,
  }))), '收支明細');
  const months = [];
  for (let d = new Date(from.slice(0, 7) + '-01'); d <= new Date(to); d.setMonth(d.getMonth() + 1)) months.push(d.toISOString().slice(0, 7));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(months.map(m => { const s = monthStats(m); return {
    月份: m, 工作收入: s.workIncome, 工作成本: s.workCost, 工作淨利: s.workNet, 幫手費: s.helper, 工作件數: s.jobs,
    個人支出: s.personal, 總收入: s.totalIncome, 總支出: s.totalExpense, 淨流動: s.flow,
  }; })), '月彙總');
  XLSX.writeFile(wb, filename);
}

// ---- TimeTree 舊資料匯入 ----
// 接受 JSON 陣列 [{date, title, note}] 或 CSV（欄位：日期,標題,備註）
export async function readTimeTree(file) {
  const text = await file.text();
  let rows;
  if (file.name.toLowerCase().endsWith('.json')) rows = JSON.parse(text);
  else {
    const XLSX = await loadXLSX();
    const ws = XLSX.read(text, { type: 'string' }).Sheets.Sheet1 || Object.values(XLSX.read(text, { type: 'string' }).Sheets)[0];
    rows = XLSX.utils.sheet_to_json(ws).map(r => ({ date: r.date || r.日期, title: r.title || r.標題, note: r.note || r.備註, time: r.time || r.時間 }));
  }
  const cats = categories();
  return rows.filter(r => r.date && r.title).map(r => {
    const date = String(r.date).slice(0, 10).replace(/\//g, '-');
    const p = parseLine(String(r.title), { now: new Date(date + 'T00:00'), categories: cats });
    if (!p) return null;
    p.date = date; p.time = r.time || (p.time === '00:00' ? '' : p.time); p.dates = [date];
    // TimeTree 的每一筆都保留成行程（標題照原本），收支掛在行程底下
    if (!p.event) p.event = { type: 'event', title: String(r.title) };
    p.event.title = String(r.title).trim(); // 標題完全照 TimeTree 原本的寫法（含前面的金額）
    if (p.event) {
      Object.assign(p.event, { date, time: p.time, allDay: !!r.allDay || !p.time, label: r.label || 1, endTime: r.endTime || '' });
      if (r.endDate && String(r.endDate).slice(0, 10) > date) p.event.endDate = String(r.endDate).slice(0, 10);
      const freq = String(r.repeat || '').match(/FREQ=(\w+)/);
      if (freq) p.event.repeat = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' }[freq[1]] || '';
      if (r.note) p.event.note = r.note;
      if (p.kind === 'unknown') p.kind = 'event';
    }
    p.txs.forEach(t => { t.date = date; t.time = p.time; });
    return p;
  }).filter(Boolean);
}

// ---- 上傳帳單 → 文字（再交給 Claude 解析）----
export async function fileToText(file, password) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return pdfToText(await file.arrayBuffer(), password);
  const XLSX = await loadXLSX();
  const wb = XLSX.read(await file.arrayBuffer());
  return wb.SheetNames.map(n => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n');
}

export async function pdfToText(buf, passwords) {
  const pdfjs = await loadPDF();
  const tries = [undefined, ...[].concat(passwords || []).filter(Boolean)];
  let lastErr;
  for (const password of tries) {
    try {
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf.slice ? buf.slice(0) : buf), password }).promise;
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const c = await (await pdf.getPage(i)).getTextContent();
        pages.push(c.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join(''));
      }
      return pages.join('\n');
    } catch (e) { lastErr = e; if (e.name !== 'PasswordException') break; }
  }
  throw new Error(lastErr?.name === 'PasswordException' ? 'PDF 密碼不對，請到設定頁填帳單密碼' : 'PDF 讀取失敗');
}
