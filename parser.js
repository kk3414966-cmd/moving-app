// 對話框輸入的本機解析規則（離線也能用）。
// 解析不了的自然語句交給 Claude（見 ai.js）。

export const BANKS = ['台新', '匯豐', '聯邦', '玉山'];

export const DEFAULT_CODES = {
  '0': '出 3.5 噸車',
  '1': '車旁上下貨',
  '2': '跟客戶一起搬',
  '3': '全部我搬',
  '4': '（舊）搬家具',
  '5': '移動家具',
  '6': '長途搬家',
  '7': '家具回收、清運',
  '8': '代客打包',
  '9': '代客復位',
};

export const CONTACTS = { '賴': 'LINE', '粉': '粉絲專頁', 'L': 'LINE 公司帳號' };

// 分類關鍵字：第一個符合的分類勝出
export const DEFAULT_CATEGORIES = [
  // 工作收入
  { name: '搬家', kind: 'income', work: true, keywords: [] },
  { name: '清運', kind: 'income', work: true, keywords: ['清運'] },
  { name: '二手家具賣出', kind: 'income', work: true, keywords: ['賣', '二手', '轉賣', '家具', '沙發', '櫃', '床', '桌', '椅', '衣架', '跑步機', '監視器', '桑拿', '回收'] },
  { name: '家具組裝', kind: 'income', work: true, keywords: ['組裝', '拆裝'] },
  { name: '其他收入', kind: 'income', work: false, keywords: [] },
  // 工作成本
  { name: '幫手', kind: 'expense', work: true, keywords: ['幫手', '助手', '工錢', '漢', '阿弟'] },
  { name: '加油', kind: 'expense', work: true, keywords: ['加油', '油錢', '油資', '中油', '台塑'] },
  { name: '停車', kind: 'expense', work: true, keywords: ['停車'] },
  { name: '過路費', kind: 'expense', work: true, keywords: ['過路', 'etag', 'ETC'] },
  { name: '租車', kind: 'expense', work: true, keywords: ['租車'] },
  { name: '清運處理費', kind: 'expense', work: true, keywords: ['處理費', '丟垃圾', '清潔隊'] },
  { name: '包材耗材', kind: 'expense', work: true, keywords: ['紙箱', '膠帶', '包材', '氣泡紙', '耗材'] },
  { name: '車輛保養', kind: 'expense', work: true, keywords: ['保養', '維修', '輪胎', '修車', '猛哥', '大寶'] },
  { name: '二手家具收購', kind: 'expense', work: true, keywords: ['收購', '收床', '收沙發', '收家具'] },
  { name: '介紹費', kind: 'expense', work: true, keywords: ['介紹費'] },
  // 個人支出
  { name: '餐飲', kind: 'expense', work: false, keywords: ['早餐', '午餐', '晚餐', '宵夜', '便當', '飲料', '咖啡', '吃', '飯', '麵', '餐'] },
  { name: '交通', kind: 'expense', work: false, keywords: ['捷運', '公車', '高鐵', '火車', '計程車', 'uber'] },
  { name: '日用', kind: 'expense', work: false, keywords: ['全聯', '家樂福', '日用', '衛生紙', '洗衣'] },
  { name: '居住', kind: 'expense', work: false, keywords: ['房租', '水費', '電費', '瓦斯', '管理費'] },
  { name: '電信', kind: 'expense', work: false, keywords: ['電話費', '手機費', '網路費', '電信'] },
  { name: '保險', kind: 'expense', work: false, keywords: ['保險', '保費', '勞保', '健保'] },
  { name: '娛樂', kind: 'expense', work: false, keywords: ['電影', '唱歌', '遊戲', '旅遊'] },
  { name: '醫療', kind: 'expense', work: false, keywords: ['醫', '藥', '掛號', '牙'] },
  { name: '孝親', kind: 'expense', work: false, keywords: ['孝親', '爸', '媽', '紅包'] },
  { name: '其他支出', kind: 'expense', work: false, keywords: [] },
];

const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function guessCategory(text, kind, categories = DEFAULT_CATEGORIES) {
  const list = categories.filter(c => c.kind === kind);
  for (const c of list) if (c.keywords.some(k => k && text.toLowerCase().includes(k.toLowerCase()))) return c;
  return list.find(c => c.name === (kind === 'income' ? '其他收入' : '其他支出')) || list[list.length - 1];
}

// 解析代號串：0 = 3.5 噸車，其他數字 = 服務項目
export function parseCode(code) {
  const digits = [...new Set(code.replace(/\D/g, '').split(''))];
  return {
    code,
    truck: digits.includes('0') ? '3.5' : '2.7',
    services: digits.filter(d => d !== '0'),
  };
}

// 拆「西屯太平0.0」→ 起點、終點、樓層
export function parseRoute(token) {
  const m = token.match(/^(.*?)(\d+|\d+~\d+)\.(\d+|\d+~\d+)(?:\.(\d+))*$/);
  let place = token, fromFloor = '', toFloor = '';
  if (m) { place = m[1]; fromFloor = m[2]; toFloor = m[3]; }
  let from = place, to = '';
  if (place.length === 4) { from = place.slice(0, 2); to = place.slice(2); }
  else if (place.length === 6) { from = place.slice(0, 3); to = place.slice(3); }
  else if (place.length === 2 || place.length === 3) { from = place; to = place; }
  return { route: place, from, to, fromFloor, toFloor };
}

// 日期：11/5、2026/11/5、明天、後天
function takeDate(s, now) {
  let m = s.match(/^\s*(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})\s*/);
  if (m) {
    const y = m[1] ? +m[1] : now.getFullYear();
    return { date: ymd(new Date(y, +m[2] - 1, +m[3])), rest: s.slice(m[0].length), explicit: true };
  }
  m = s.match(/^\s*(今天|明天|後天)\s*/);
  if (m) {
    const d = new Date(now); d.setDate(d.getDate() + { 今天: 0, 明天: 1, 後天: 2 }[m[1]]);
    return { date: ymd(d), rest: s.slice(m[0].length), explicit: true };
  }
  return { date: ymd(now), rest: s, explicit: false };
}

// 時間：9:30、下午3點、早上9點半
function takeTime(s) {
  let m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) return { time: `${pad(+m[1])}:${m[2]}`, rest: s.replace(m[0], ' ') };
  m = s.match(/(早上|上午|中午|下午|晚上)?\s*(\d{1,2})\s*點\s*(半|(\d{1,2})\s*分)?/);
  if (m) {
    let h = +m[2];
    if ((m[1] === '下午' || m[1] === '晚上') && h < 12) h += 12;
    const min = m[3] === '半' ? 30 : (m[4] ? +m[4] : 0);
    return { time: `${pad(h)}:${pad(min)}`, rest: s.replace(m[0], ' ') };
  }
  return { time: '', rest: s };
}

function takeBank(s) {
  for (const b of BANKS) {
    const re = new RegExp(`\\s*${b}(?:卡)?\\s*$`);
    if (re.test(s)) return { account: b, rest: s.replace(re, '') };
  }
  return { account: '', rest: s };
}

const amountOf = s => +s.replace(/[,，]/g, '');

// 舊 TimeTree 暗碼「9-5」= 9,500、「14-175」= 14,175
export function legacyAmount(a, b) { return +a * 1000 + +b.padEnd(3, '0'); }

/**
 * 解析一行輸入。回傳：
 *  { kind: 'job'|'event'|'tx'|'transfer'|'unknown', date, time, event?, txs: [], note }
 */
export function parseLine(input, opts = {}) {
  const now = opts.now || new Date();
  const categories = opts.categories || DEFAULT_CATEGORIES;
  const raw = input.trim();
  if (!raw) return null;

  let { date, rest, explicit } = takeDate(raw, now);
  const t = takeTime(rest); rest = t.rest.trim();
  const time = t.time || (explicit ? '' : hm(now));
  const out = { raw, date, time, txs: [], event: null, kind: 'unknown' };

  // 繳卡費：「繳台新 12000」「台新卡費 12000」
  let m = rest.match(/^(?:繳)?\s*(台新|匯豐|聯邦|玉山)\s*(?:卡費)?\s*\$?\s*([\d,]+)$/) || rest.match(/^繳\s*(台新|匯豐|聯邦|玉山)\s*卡費\s*\$?\s*([\d,]+)$/);
  if (m && /繳|卡費/.test(rest)) {
    out.kind = 'transfer';
    out.txs.push({ type: 'transfer', amount: amountOf(m[2]), from: '銀行戶頭', to: m[1], category: '繳卡費', note: rest });
    return out;
  }

  // 一行裡夾帶的支出：「看倉庫 -$200停車」；也接受「幫手-$2500-$1500」「猛哥-$14700」
  const inlineExp = [];
  m = rest.match(/^([^\d\s$+-][^\s$]*?)\s*((?:-\s*\$\s*[\d,]+\s*)+)$/);
  if (m) {
    for (const a of m[2].matchAll(/-\s*\$\s*([\d,]+)/g)) inlineExp.push({ amount: amountOf(a[1]), what: m[1] });
    rest = '';
  }
  rest = rest.replace(/\s+-\s*\$?\s*([\d,]+)\s*([^\s\d$]*)/g, (all, amt, what) => { inlineExp.push({ amount: amountOf(amt), what }); return ' '; }).trim();

  // 舊 TimeTree：前面寫人名代表別人跑的，例如「漢 4-0 03.南屯…」
  let by = '';
  m = rest.match(/^([^\d\s$+-]{1,2})\s*(\d+-\d+(?!\d)\s.*)$/);
  if (m) { by = m[1]; rest = m[2]; }

  // 開頭是金額
  let lead = null;
  m = rest.match(/^([-+$])\s*\$?\s*([\d,]+)\s*(.*)$/);
  if (m) { lead = { sign: m[1] === '-' ? -1 : 1, amount: amountOf(m[2]) }; rest = m[3].trim(); }
  else if ((m = rest.match(/^(\d+)-(\d+)(?!\d)\s+(.*)$/))) { // 舊暗碼，都是工作收入
    lead = { sign: 1, amount: legacyAmount(m[1], m[2]), legacy: true }; rest = m[3].trim();
  }
  // 金額寫在中間或後面：「家具$500+$600」「還款$20000」
  if (!lead && (m = rest.match(/^([^$]*?)\s*((?:\+?\s*\$\s*[\d,]+\s*)+)(.*)$/)) && !/-\s*$/.test(m[1])) {
    lead = { sign: 1, amount: [...m[2].matchAll(/\$\s*([\d,]+)/g)].reduce((s, a) => s + amountOf(a[1]), 0) };
    rest = `${m[1]} ${m[3]}`.trim();
  }

  // 工作：代號.起點終點樓層 客戶 聯絡
  m = rest.match(/^(?:\d+\s*[×x]\s*)?(\d{1,4})\.(\S*)\s*(.*)$/);
  if (m && (!lead || lead.sign > 0)) {
    const code = parseCode(m[1]);
    const route = parseRoute(m[2]);
    const parts = m[3].trim().split(/\s+/).filter(Boolean);
    let contact = '';
    if (parts.length && (CONTACTS[parts[parts.length - 1]] || /^\d{8,10}$/.test(parts[parts.length - 1]))) contact = parts.pop();
    out.kind = 'job';
    out.event = {
      type: 'job', date, time: t.time, title: rest, codeRaw: code.code, truck: code.truck, services: code.services,
      route: route.route, from: route.from, to: route.to, fromFloor: route.fromFloor, toFloor: route.toFloor,
      client: parts.join(' '), contact: CONTACTS[contact] || contact, done: !!lead, amount: lead ? lead.amount : 0,
    };
    if (by) out.event.by = by;
    if (lead) out.txs.push({ type: 'income', amount: lead.amount, category: '搬家', work: true, matchJob: true, note: rest });
  } else if (lead) {
    // 純收支
    const kind = lead.sign < 0 ? 'expense' : 'income';
    const b = takeBank(rest); rest = b.rest.trim();
    let cat = guessCategory(rest, kind, categories);
    if (lead.legacy && cat.name === '其他收入') cat = categories.find(c => c.name === '搬家') || cat;
    out.kind = 'tx';
    out.txs.push({ type: kind, amount: lead.amount, category: cat.name, work: cat.work, account: b.account || '現金', note: rest });
  } else if (rest) {
    // 行程或記事
    const looksNatural = /搬|報價|報\d|元|塊/.test(rest) && rest.length > 8;
    out.kind = looksNatural && !inlineExp.length ? 'unknown' : 'event';
    out.event = { type: 'event', date, time: t.time, title: rest };
  }

  for (const e of inlineExp) {
    const cat = guessCategory(e.what, 'expense', categories);
    out.txs.push({ type: 'expense', amount: e.amount, category: cat.name, work: cat.work, account: '現金', note: e.what });
    if (out.kind === 'unknown') out.kind = out.event ? 'event' : 'tx';
  }
  out.txs.forEach(x => { x.date = date; x.time = time; });
  return out;
}

// 確認卡片上的一行摘要
export function summarize(p) {
  if (!p) return '';
  const money = n => '$' + Number(n).toLocaleString('zh-TW');
  const bits = [];
  if (p.event?.type === 'job') {
    const e = p.event;
    bits.push(`工作｜${e.truck} 噸｜${e.route}${e.fromFloor !== '' ? ` ${e.fromFloor}→${e.toFloor} 樓` : ''}｜${e.client || '未填客戶'}`);
    bits.push(e.done ? `完成，實收 ${money(e.amount)}` : '未完成');
  } else if (p.event) bits.push(`行程｜${p.event.title}${p.event.time ? '｜' + p.event.time : ''}`);
  for (const x of p.txs) {
    if (x.matchJob) continue;
    if (x.type === 'transfer') bits.push(`繳卡費 ${money(x.amount)}｜${x.to}`);
    else bits.push(`${x.type === 'income' ? '收入' : '支出'} ${money(x.amount)}｜${x.category}｜${x.account || '現金'}`);
  }
  bits.push(p.date + (p.time ? ' ' + p.time : ''));
  return bits.join('｜');
}
