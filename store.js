// 資料層：有 Firebase 設定就用 Firestore（雲端同步＋離線暫存），沒有就用本機試用模式。
import { firebaseConfig } from './config.js';

export const COLLECTIONS = ['events', 'transactions', 'accounts', 'categories', 'shortcuts', 'settings'];
const FB = 'https://www.gstatic.com/firebasejs/10.12.2';

const cache = Object.fromEntries(COLLECTIONS.map(c => [c, new Map()]));
const listeners = new Set();
let mode = 'local', fs = null, db = null, uid = null, auth = null, authMod = null;

const notify = () => listeners.forEach(fn => fn());
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const getMode = () => mode;
export const all = col => [...cache[col].values()];
export const get = (col, id) => cache[col].get(id);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---- 本機試用模式 ----
const LS = 'moving-app-v1';
function loadLocal() {
  try {
    const data = JSON.parse(localStorage.getItem(LS) || '{}');
    for (const c of COLLECTIONS) for (const r of data[c] || []) cache[c].set(r.id, r);
  } catch { /* 第一次使用 */ }
}
function saveLocal() {
  try { localStorage.setItem(LS, JSON.stringify(Object.fromEntries(COLLECTIONS.map(c => [c, all(c)])))); } catch { /* 空間不足 */ }
}

// ---- 省讀取：行程、收支只隨時同步「最近 3 個月＋以後」，更早的要看才讀一次 ----
// Firestore 免費版一天 5 萬次讀取；以前每次打開都把 2,000 多筆全部讀一遍。
const BIG = ['events', 'transactions'];
const MONTHS_BACK = 3;
const REPEATS = ['daily', 'weekly', 'monthly', 'yearly'];
const ymOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const ymStep = (ym, n) => { const [y, m] = ym.split('-').map(Number); return ymOf(new Date(y, m - 1 + n, 1)); };
const liveFrom = ymStep(ymOf(new Date()), -MONTHS_BACK) + '-01'; // 例：11 月打開 → 8/1 以後
const loaded = new Set(), loading = new Map(), allLoaded = new Set();
let syncedResolve; const syncedP = new Promise(r => { syncedResolve = r; });
// 這筆是不是在「隨時同步」的範圍裡（範圍外的被移出監聽時，不要從畫面上刪掉）
const inLive = (c, r) => !r || !BIG.includes(c) || (r.date || '') >= liveFrom ||
  (c === 'events' && (REPEATS.includes(r.repeat) || (r.endDate || '') >= liveFrom));

export async function init() {
  // 網址加 ?local 可用本機試用模式（測試用）
  if (!firebaseConfig || new URLSearchParams(location.search).has('local')) { loadLocal(); mode = 'local'; syncedResolve(true); notify(); return { mode }; }
  const app = await import(`${FB}/firebase-app.js`);
  authMod = await import(`${FB}/firebase-auth.js`);
  fs = await import(`${FB}/firebase-firestore.js`);
  const fbApp = app.initializeApp(firebaseConfig);
  auth = authMod.getAuth(fbApp);
  db = fs.initializeFirestore(fbApp, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  mode = 'cloud';
  return new Promise(resolve => {
    authMod.onAuthStateChanged(auth, user => {
      if (!user) { uid = null; resolve({ mode, needLogin: true }); return; }
      uid = user.uid;
      const col = c => fs.collection(db, 'users', uid, c);
      const queries = [
        ...COLLECTIONS.filter(c => !BIG.includes(c)).map(c => [c, col(c)]),
        ['events', fs.query(col('events'), fs.where('date', '>=', liveFrom))],
        ['events', fs.query(col('events'), fs.where('repeat', 'in', REPEATS))],      // 很久以前開始的重複行程
        ['events', fs.query(col('events'), fs.where('endDate', '>=', liveFrom))],    // 很久以前開始、還沒結束的多天行程
        ['transactions', fs.query(col('transactions'), fs.where('date', '>=', liveFrom))],
      ];
      let first = queries.length, server = queries.length;
      const done = () => syncedResolve(true);
      setTimeout(() => syncedResolve(false), 15000); // 沒網路：先用手機裡暫存的
      for (const [c, q] of queries) {
        let gotFirst = false, gotServer = false;
        fs.onSnapshot(q, { includeMetadataChanges: true }, snap => {
          const changes = snap.docChanges();
          changes.forEach(ch => {
            if (ch.type !== 'removed') cache[c].set(ch.doc.id, { id: ch.doc.id, ...ch.doc.data() });
            else if (inLive(c, cache[c].get(ch.doc.id))) cache[c].delete(ch.doc.id);
          });
          if (!gotFirst) { gotFirst = true; if (--first === 0) resolve({ mode, user }); }
          if (!gotServer && !snap.metadata.fromCache) { gotServer = true; if (--server === 0) done(); }
          if (changes.length) notify();
        }, err => console.warn('同步失敗', c, err));
      }
    });
  });
}
// 雲端資料第一次對完（或 15 秒沒網路）才 resolve；true = 有對到雲端
export const synced = () => syncedP;

// 讀 from～to（YYYY-MM-DD）這段日期的行程和收支；讀過的月份不會再讀
export function ensureRange(from, to) {
  if (mode !== 'cloud' || !uid || !from) return Promise.resolve();
  const months = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7) && m < liveFrom.slice(0, 7); m = ymStep(m, 1)) if (!loaded.has(m)) months.push(m);
  if (!months.length) return Promise.resolve();
  const key = months[0] + '~' + months[months.length - 1];
  if (loading.has(key)) return loading.get(key);
  const p = (async () => {
    const a = months[0] + '-01', b = months[months.length - 1] + '-31';
    for (const c of BIG) {
      if (allLoaded.has(c)) continue;
      const snap = await fs.getDocs(fs.query(fs.collection(db, 'users', uid, c), fs.where('date', '>=', a), fs.where('date', '<=', b)));
      snap.forEach(d => { if (!cache[c].has(d.id)) cache[c].set(d.id, { id: d.id, ...d.data() }); });
    }
    months.forEach(m => loaded.add(m));
    notify();
  })().catch(e => console.warn('讀舊資料失敗', e)).finally(() => loading.delete(key));
  loading.set(key, p);
  return p;
}
export const ensureMonths = (ym, back = 0, fwd = 0) => ensureRange(ymStep(ym, -back) + '-01', ymStep(ym, fwd) + '-31');

// 整個 collection 全部讀一次（搜尋全部、Gmail 以前的帳單這種少用的功能才用）
export async function ensureAll(c) {
  if (mode !== 'cloud' || !uid || allLoaded.has(c)) return;
  const snap = await fs.getDocs(fs.collection(db, 'users', uid, c));
  snap.forEach(d => { if (!cache[c].has(d.id)) cache[c].set(d.id, { id: d.id, ...d.data() }); });
  allLoaded.add(c); notify();
}
export const isAllLoaded = c => mode !== 'cloud' || allLoaded.has(c);

// 只讀某個欄位等於某值的（例如某個分類、Gmail 匯入的），比全部讀省很多
export async function ensureWhere(c, field, value) {
  if (mode !== 'cloud' || !uid || allLoaded.has(c)) return;
  const snap = await fs.getDocs(fs.query(fs.collection(db, 'users', uid, c), fs.where(field, '==', value)));
  snap.forEach(d => { if (!cache[c].has(d.id)) cache[c].set(d.id, { id: d.id, ...d.data() }); });
  notify();
}

export async function login() {
  const provider = new authMod.GoogleAuthProvider();
  await authMod.signInWithPopup(auth, provider);
  location.reload();
}
export async function logout() { await authMod.signOut(auth); location.reload(); }
export async function idToken() { return auth?.currentUser ? auth.currentUser.getIdToken() : ''; }
export const userName = () => auth?.currentUser?.displayName || '';

export async function add(col, obj) {
  const id = obj.id || newId();
  const rec = { ...obj, id, createdAt: obj.createdAt || new Date().toISOString() };
  cache[col].set(id, rec);
  if (mode === 'local') { saveLocal(); notify(); }
  else { notify(); await fs.setDoc(fs.doc(db, 'users', uid, col, id), stripId(rec)); }
  return rec;
}
export async function update(col, id, patch) {
  const rec = { ...cache[col].get(id), ...patch, id };
  cache[col].set(id, rec);
  if (mode === 'local') { saveLocal(); notify(); }
  else { notify(); await fs.setDoc(fs.doc(db, 'users', uid, col, id), stripId(rec)); }
  return rec;
}
export async function remove(col, id) {
  cache[col].delete(id);
  if (mode === 'local') { saveLocal(); notify(); }
  else { notify(); await fs.deleteDoc(fs.doc(db, 'users', uid, col, id)); }
}
// 大量寫入（匯入用）
export async function addMany(col, list) {
  if (mode === 'local') { for (const o of list) { const id = o.id || newId(); cache[col].set(id, { ...o, id }); } saveLocal(); notify(); return; }
  for (let i = 0; i < list.length; i += 400) {
    const batch = fs.writeBatch(db);
    for (const o of list.slice(i, i + 400)) {
      const id = o.id || newId(); const rec = { ...o, id };
      cache[col].set(id, rec); batch.set(fs.doc(db, 'users', uid, col, id), stripId(rec));
    }
    await batch.commit();
  }
  notify();
}
function stripId(r) { const { id, ...rest } = r; return JSON.parse(JSON.stringify(rest)); }

// 公開資料（給官網看的，例如哪天排滿）：只有雲端模式才寫
export async function setPublic(id, data) {
  if (mode !== 'cloud' || !uid) return false;
  await fs.setDoc(fs.doc(db, 'public', id), data);
  return true;
}

// settings 只有一筆
export const settings = () => get('settings', 'main') || {};
export const saveSettings = patch => update('settings', 'main', { ...settings(), ...patch });
