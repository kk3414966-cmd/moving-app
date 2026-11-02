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

export async function init() {
  if (!firebaseConfig) { loadLocal(); mode = 'local'; notify(); return { mode }; }
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
      for (const c of COLLECTIONS) {
        fs.onSnapshot(fs.collection(db, 'users', uid, c), snap => {
          snap.docChanges().forEach(ch => {
            if (ch.type === 'removed') cache[c].delete(ch.doc.id);
            else cache[c].set(ch.doc.id, { id: ch.doc.id, ...ch.doc.data() });
          });
          notify();
        });
      }
      resolve({ mode, user });
    });
  });
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

// settings 只有一筆
export const settings = () => get('settings', 'main') || {};
export const saveSettings = patch => update('settings', 'main', { ...settings(), ...patch });
