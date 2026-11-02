// 讀 Gmail 裡四家銀行的刷卡通知信與電子帳單（唯讀授權，不使用 Gmail 密碼）。
import { googleClientId } from './config.js';
import * as db from './store.js';
import { askClaude } from './ai.js';
import { pdfToText } from './files.js';
import { BANKS } from './parser.js';

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
let token = null, tokenExp = 0;

// 照使用者信箱裡實際的寄件者設定，只抓「消費通知」和「信用卡帳單」，廣告信、登入通知都不抓
const DEFAULT_QUERY = {
  台新: 'from:webmaster@bhurecv.taishinbank.com.tw subject:信用卡電子帳單',
  匯豐: '(from:noreply@messaging.hsbc.com.tw subject:消費通知) OR (from:cards@estatements.hsbc.com.tw subject:信用卡帳單)',
  聯邦: '(from:ub_notice@cards.ubot.com.tw subject:消費通知) OR (from:estatement@ebillv2.card.ubot.com.tw subject:信用卡電子帳單 -subject:入帳通知)',
  玉山: 'from:estatement@esunbank.com subject:信用卡電子帳單',
};

let gis;
export function preload() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return gis ||= new Promise((ok, fail) => {
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client';
    s.onload = ok; s.onerror = () => { gis = null; fail(new Error('Google 登入元件載入失敗，請確認網路')); }; document.head.appendChild(s);
  });
}

// 要在按鈕被按下的當下呼叫，手機才不會擋掉授權視窗
export function connect() {
  if (!googleClientId) return Promise.reject(new Error('還沒設定 Google OAuth 用戶端 ID'));
  if (token && Date.now() < tokenExp) return Promise.resolve(token);
  const go = () => new Promise((ok, fail) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: googleClientId, scope: SCOPE,
      callback: r => {
        if (r.error) return fail(new Error('Gmail 授權失敗：' + r.error));
        token = r.access_token; tokenExp = Date.now() + (r.expires_in - 60) * 1000;
        db.saveSettings({ gmailLinked: true, gmailLinkedAt: new Date().toISOString() });
        ok(token);
      },
      error_callback: e => fail(new Error(e?.type === 'popup_closed' ? '授權視窗被關掉了' : e?.type === 'popup_failed_to_open' ? '授權視窗被擋住了，請允許彈出視窗後再按一次' : 'Gmail 授權失敗')),
    });
    client.requestAccessToken({ prompt: db.settings().gmailLinked ? '' : 'consent' });
  });
  return window.google?.accounts?.oauth2 ? go() : preload().then(go);
}

async function gget(path) {
  const r = await fetch(`${API}/${path}`, { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 401) { token = null; throw new Error('Gmail 授權過期，請再按一次「讀取 Gmail」'); }
  if (!r.ok) throw new Error('Gmail 讀取失敗');
  return r.json();
}
const b64 = s => atob(s.replace(/-/g, '+').replace(/_/g, '/'));
const utf8 = s => new TextDecoder().decode(Uint8Array.from(b64(s), c => c.charCodeAt(0)));
const htmlText = h => new DOMParser().parseFromString(h, 'text/html').body.innerText;

function walk(part, out = { text: '', html: '', pdfs: [] }) {
  if (part.mimeType === 'text/plain' && part.body?.data) out.text += utf8(part.body.data);
  else if (part.mimeType === 'text/html' && part.body?.data) out.html += utf8(part.body.data);
  else if (/pdf/i.test(part.mimeType) || /\.pdf$/i.test(part.filename || '')) out.pdfs.push(part);
  (part.parts || []).forEach(p => walk(p, out));
  return out;
}

// 同時處理幾封，比一封一封快很多
async function pool(list, n, fn) {
  const out = []; let i = 0;
  await Promise.all([...Array(Math.min(n, list.length))].map(async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); } }));
  return out;
}

/** 讀最近 days 天的銀行信，回傳待確認的消費清單 */
export async function fetchCardTransactions(days = 40, onProgress = () => {}) {
  await connect();
  const accounts = db.all('accounts');
  const done = new Set(db.all('transactions').map(t => t.externalId).filter(Boolean).map(x => x.split('#')[0]));
  const pw = db.settings().pdfPasswords || {};
  const jobs = [];
  for (const bank of BANKS) {
    // 使用者填的寄件者：去掉 < > 空白，已經在預設清單裡的就不重複加
    const extra = (accounts.find(a => a.name === bank)?.sender || '').replace(/[<>\s]/g, '').split(/[,，;；]/)
      .filter(s => s.includes('@') && !DEFAULT_QUERY[bank].includes(s));
    const q = `(${DEFAULT_QUERY[bank]})${extra.map(s => ` OR from:${s}`).join('')} newer_than:${days}d`;
    const list = await gget(`messages?maxResults=60&q=${encodeURIComponent(q)}`);
    for (const { id } of list.messages || []) if (!done.has(id)) jobs.push({ bank, id });
  }
  if (!jobs.length) return [];
  let finished = 0;
  onProgress(`找到 ${jobs.length} 封銀行信，整理中…`);
  const results = await pool(jobs, 4, async ({ bank, id }) => {
    try {
      const msg = await gget(`messages/${id}?format=full`);
      const parts = walk(msg.payload);
      const subject = (msg.payload.headers || []).find(h => h.name === 'Subject')?.value || '';
      let task = 'notify', text = `${subject}\n${parts.text || htmlText(parts.html)}`;
      if (parts.pdfs.length) {
        const att = parts.pdfs[0];
        const data = att.body.attachmentId ? (await gget(`messages/${id}/attachments/${att.body.attachmentId}`)).data : att.body.data;
        const buf = Uint8Array.from(b64(data), c => c.charCodeAt(0)).buffer;
        try { text = await pdfToText(buf, [pw[bank], pw.all]); task = 'statement'; }
        catch (e) { return [{ error: `${bank}帳單（${subject}）：${e.message}`, externalId: id }]; }
      } else if (/帳單/.test(subject)) task = 'statement';
      const found = await askClaude(task, `卡別：${bank}\n${text.slice(0, 55000)}`);
      return found.map((it, i) => ({
        type: it.kind === 'income' ? 'income' : 'expense', amount: it.amount, date: it.date, time: it.time,
        category: it.category, account: bank, note: it.merchant || it.title, source: 'Gmail', externalId: `${id}#${task}#${i}`, kindOfMail: task,
      }));
    } catch (e) { return [{ error: `${bank}：${e.message}`, externalId: id }]; }
    finally { onProgress(`整理中… ${++finished}／${jobs.length} 封`); }
  });
  return results.flat().filter(x => x.error || x.amount > 0);
}
