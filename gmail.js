// 讀 Gmail 裡四家銀行的刷卡通知信與電子帳單（唯讀授權，不使用 Gmail 密碼）。
import { googleClientId } from './config.js';
import * as db from './store.js';
import { askClaude } from './ai.js';
import { pdfToText } from './files.js';
import { BANKS } from './parser.js';

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
let token = null, tokenExp = 0;

// 沒在帳戶設定填寄件者時，用銀行名稱＋關鍵字搜尋
const DEFAULT_QUERY = {
  台新: '(台新 OR taishinbank) (刷卡 OR 消費 OR 帳單)',
  匯豐: '(匯豐 OR hsbc) (刷卡 OR 消費 OR 帳單)',
  聯邦: '(聯邦 OR ubot) (刷卡 OR 消費 OR 帳單)',
  玉山: '(玉山 OR esunbank) (刷卡 OR 消費 OR 帳單)',
};

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((ok, fail) => {
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client';
    s.onload = ok; s.onerror = () => fail(new Error('Google 登入元件載入失敗')); document.head.appendChild(s);
  });
}

export async function connect() {
  if (!googleClientId) throw new Error('還沒設定 Google OAuth 用戶端 ID（見設定教學）');
  if (token && Date.now() < tokenExp) return token;
  await loadGis();
  return new Promise((ok, fail) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: googleClientId, scope: SCOPE,
      callback: r => {
        if (r.error) return fail(new Error('Gmail 授權失敗：' + r.error));
        token = r.access_token; tokenExp = Date.now() + (r.expires_in - 60) * 1000;
        db.saveSettings({ gmailLinked: true, gmailLinkedAt: new Date().toISOString() });
        ok(token);
      },
    });
    client.requestAccessToken({ prompt: db.settings().gmailLinked ? '' : 'consent' });
  });
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

/** 讀最近 days 天的銀行信，回傳待確認的消費清單 */
export async function fetchCardTransactions(days = 40, onProgress = () => {}) {
  await connect();
  const accounts = db.all('accounts');
  const done = new Set(db.all('transactions').map(t => t.externalId).filter(Boolean).map(x => x.split('#')[0]));
  const pw = db.settings().pdfPasswords || {};
  const items = [];
  for (const bank of BANKS) {
    const sender = accounts.find(a => a.name === bank)?.sender;
    const q = `${sender ? `from:(${sender})` : DEFAULT_QUERY[bank]} newer_than:${days}d`;
    const list = await gget(`messages?maxResults=50&q=${encodeURIComponent(q)}`);
    for (const { id } of list.messages || []) {
      if (done.has(id)) continue;
      onProgress(`${bank}：讀取信件…`);
      const msg = await gget(`messages/${id}?format=full`);
      const parts = walk(msg.payload);
      const subject = (msg.payload.headers || []).find(h => h.name === 'Subject')?.value || '';
      let task = 'notify', text = `${subject}\n${parts.text || htmlText(parts.html)}`;
      if (parts.pdfs.length) {
        const att = parts.pdfs[0];
        const data = att.body.attachmentId ? (await gget(`messages/${id}/attachments/${att.body.attachmentId}`)).data : att.body.data;
        const buf = Uint8Array.from(b64(data), c => c.charCodeAt(0)).buffer;
        try { text = await pdfToText(buf, [pw[bank], pw.all]); task = 'statement'; }
        catch (e) { items.push({ error: `${bank}帳單：${e.message}`, externalId: id }); continue; }
      }
      onProgress(`${bank}：整理消費明細…`);
      const found = await askClaude(task, `卡別：${bank}\n${text.slice(0, 55000)}`);
      found.forEach((it, i) => items.push({
        type: it.kind === 'income' ? 'income' : 'expense', amount: it.amount, date: it.date, time: it.time,
        category: it.category, account: bank, note: it.merchant || it.title, source: 'Gmail', externalId: `${id}#${task}#${i}`, kindOfMail: task,
      }));
    }
  }
  return items.filter(x => x.error || x.amount > 0);
}
