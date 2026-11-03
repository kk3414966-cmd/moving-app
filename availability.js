// 官網「哪天排滿」：從行事曆算出未來每天哪些時間有事，寫到 public/availability。
// 只公開時間，不公開內容（沒有標題、客人名字、地址）。
// 規則：有寫時間的行程都擋（沒寫結束時間算 3 小時，工作至少 3 小時）；沒寫時間的不擋；
//       標題最前面是「休」= 整天不接；有時間的工作數算「幾個客人」。
import * as db from './store.js';
import { ymd } from './parser.js';

const DAYS_AHEAD = 120;
const DEFAULT_HOURS = 3;         // 一車 3 小時
const EXTRA_TRUCK_HOURS = 2;     // 每多一車 +2 小時（兩車 5 小時）

// 標題裡的「2x」「2*」= 兩車
const trucksOf = e => { const m = String(e.title || '').match(/(?:^|\s|\$\S*\s)([2-5])\s*[xX×*＊]/); return m ? +m[1] : 1; };
const jobHours = e => DEFAULT_HOURS + (trucksOf(e) - 1) * EXTRA_TRUCK_HOURS;

const toH = t => { const [h, m] = String(t || '').split(':').map(Number); return h + (m || 0) / 60; };
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return ymd(x); };

// 這筆行程在 day 這天有沒有出現（含多天、重複）
function occurs(e, day) {
  if (!e.date || e.date > day) return false;
  const end = e.endDate && e.endDate > e.date ? e.endDate : e.date;
  if (!e.repeat) return day <= end;
  const a = new Date(e.date + 'T00:00:00'), b = new Date(day + 'T00:00:00');
  if (e.repeat === 'daily') return true;
  if (e.repeat === 'weekly') return a.getDay() === b.getDay();
  if (e.repeat === 'monthly') return a.getDate() === b.getDate();
  if (e.repeat === 'yearly') return a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  return false;
}

// 這筆行程在 day 這天佔用的時間 [開始, 結束]
function busyOn(e, day) {
  const multi = !e.repeat && e.endDate && e.endDate > e.date;
  const s = day === e.date || e.repeat ? toH(e.time) : 0;
  let end;
  if (multi && day < e.endDate) end = 24;
  else if (e.endTime && (multi || toH(e.endTime) > s)) end = toH(e.endTime);
  else end = Math.min(24, s + DEFAULT_HOURS);
  // 搬家工作至少算 3 小時、兩車 5 小時（TimeTree 匯入的結束時間常常只寫 1 小時）
  if (e.type === 'job' && !(multi && day < e.endDate)) end = Math.max(end, Math.min(24, s + jobHours(e)));
  return [Math.round(s * 4) / 4, Math.round(end * 4) / 4];
}

export function compute(events, from = ymd(new Date())) {
  const days = {};
  const list = events.filter(e => e.date);
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const day = addDays(from, i);
    const todays = list.filter(e => occurs(e, day));
    if (todays.some(e => String(e.title || '').trim().startsWith('休'))) { days[day] = { off: 1 }; continue; }
    const timed = todays.filter(e => e.time && !e.allDay);
    if (!timed.length) continue;
    days[day] = {
      jobs: timed.filter(e => e.type === 'job').length,
      busy: timed.map(e => busyOn(e, day)).sort((a, b) => a[0] - b[0]),
    };
  }
  return days;
}

// 行程一有變動就重新算，跟上次不一樣才寫（避免一直寫）
let timer = null, last = '';
export function start() {
  const run = async () => {
    const json = JSON.stringify(compute(db.all('events')));
    if (json === last) return;
    try { if (await db.setPublic('availability', { json, updatedAt: new Date().toISOString() })) last = json; }
    catch (e) { console.warn('官網已滿日期更新失敗', e); }
  };
  db.onChange(() => { clearTimeout(timer); timer = setTimeout(run, 3000); });
  timer = setTimeout(run, 3000);
}
