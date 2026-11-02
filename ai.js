// 呼叫 Cloudflare Worker 讓 Claude 解析（需要網路＋已登入）。
import { workerUrl } from './config.js';
import { idToken, all } from './store.js';
import { ymd, parseRoute, parseCode, CONTACTS } from './parser.js';

export const aiReady = () => !!workerUrl && navigator.onLine;

export async function askClaude(task, text) {
  if (!workerUrl) throw new Error('還沒設定 Claude（Worker 網址）');
  if (!navigator.onLine) throw new Error('目前沒有網路');
  const res = await fetch(workerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await idToken() },
    body: JSON.stringify({ task, text, today: ymd(new Date()), categories: all('categories').map(c => c.name) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '連線失敗');
  return data.items || [];
}

// 把 Claude 回傳的 items 轉成跟本機解析一樣的格式
export function itemsToParsed(raw, items) {
  const out = { raw, txs: [], event: null, kind: 'unknown', date: items[0]?.date || ymd(new Date()), time: items[0]?.time || '' };
  for (const it of items) {
    if (it.kind === 'job') {
      const code = parseCode(it.codeRaw || '');
      const r = parseRoute(`${it.from}${it.to}`);
      out.kind = 'job';
      out.event = {
        type: 'job', date: it.date, time: it.time, title: it.title || raw, codeRaw: it.codeRaw, truck: code.truck, services: code.services,
        route: r.route, from: it.from, to: it.to, fromFloor: it.fromFloor, toFloor: it.toFloor,
        client: it.client, contact: CONTACTS[it.contact] || it.contact, done: false, amount: 0, quote: it.amount || 0,
      };
    } else if (it.kind === 'event') {
      out.kind = out.kind === 'unknown' ? 'event' : out.kind;
      out.event = { type: 'event', date: it.date, time: it.time, title: it.title };
    } else {
      out.kind = out.kind === 'unknown' ? 'tx' : out.kind;
      const cat = all('categories').find(c => c.name === it.category);
      out.txs.push({
        type: it.kind, amount: it.amount, category: it.category || (it.kind === 'income' ? '其他收入' : '其他支出'),
        work: cat ? !!cat.work : false, account: it.account || '現金', note: it.merchant || it.title, date: it.date, time: it.time,
      });
    }
  }
  return out;
}
