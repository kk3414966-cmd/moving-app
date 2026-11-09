// 官網後台：封面照、搬家實錄（影片、案例）、Google 評論、二手家具
// 內容和照片透過 Cloudflare Worker 存到 GitHub（business-sites 倉庫），不佔 Firebase 額度。
import * as db from './store.js';
import { siteWorkerUrl, siteFilesBase } from './config.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const imgUrl = p => !p ? '' : /^(https?:|data:)/.test(p) ? p : siteFilesBase + p;

// 每一類有哪些欄位
const SECTIONS = {
  reviews: { title: 'Google 評論', hint: '從 Google 地圖複製評論貼上。只放真實客人寫的。', img: false,
    fields: [['name', '名字', '王小姐'], ['text', '評論內容', '', 'area']] },
  used: { title: '二手家具', hint: '賣掉了就勾「已售出」，官網會標示。', img: true,
    fields: [['title', '名稱', '三人座布沙發'], ['price', '價格', '2500', 'number'], ['text', '說明', '九成新，台中可自取。']], sold: true },
};

const feedUrl = 'https://moving-fbfeed.kk3414966.workers.dev';
let C = null;      // 目前編輯中的內容
let api = null;    // { openModal, closeModal, toast, modalHead }

export async function openSiteCms(helpers) {
  api = helpers;
  api.openModal(`${api.modalHead('官網內容')}<p class="muted center">讀取中…</p>`);
  try {
    const r = await fetch(siteWorkerUrl + '/content', { cache: 'no-store' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || r.status);
    C = j.content || { hero: '', videos: [], cases: [], reviews: [], used: [] };
    for (const k of Object.keys(SECTIONS)) C[k] = C[k] || [];
    render();
  } catch (e) {
    api.openModal(`${api.modalHead('官網內容')}<p>讀不到官網內容（${esc(e.message)}）。確認有網路，或請 Claude 檢查 Cloudflare 設定。</p><div class="row"><button data-close>關閉</button></div>`);
  }
}

function render() {
  const sec = (key) => {
    const S = SECTIONS[key];
    return `<section class="cms-sec"><h4>${S.title}</h4><p class="muted">${S.hint}</p>
      ${C[key].map((it, i) => item(key, it, i)).join('') || '<p class="muted">還沒有內容。</p>'}
      <button data-cms-add="${key}">＋ 新增</button></section>`;
  };
  api.openModal(`${api.modalHead('官網內容')}
    <p class="muted">改完按最下面的「儲存到官網」，大約 1～5 分鐘後官網就會更新。<br>搬家實錄的短影片和案例會自動從粉專來，不用在這裡填。</p>
    <section class="cms-sec"><h4>封面照</h4><p class="muted">首頁最上面那張大照片。建議用橫的照片。</p>
      <div class="cms-hero">${C.hero ? `<img src="${esc(imgUrl(C.hero))}" alt="">` : '<span class="muted">目前用預設的照片</span>'}</div>
      <label class="cms-pick">選照片<input type="file" accept="image/*" data-cms-img="hero"></label></section>
    <section class="cms-sec"><h4>搬家實錄・貼文分類</h4><p class="muted">官網會自動猜每則粉專貼文的分類。猜錯的在這裡改，選「自動」就回到官網自己判斷。</p>
      <div id="cms-cats" class="muted">讀取粉專貼文中…</div></section>
    ${Object.keys(SECTIONS).map(sec).join('')}
    <div class="row cms-save"><button class="primary" data-cms-save>儲存到官網</button><button data-close>關閉</button></div>`);
  bind();
  loadCats();
}

function item(key, it, i) {
  const S = SECTIONS[key];
  return `<div class="cms-item" data-key="${key}" data-i="${i}">
    ${S.img ? `<div class="cms-thumb">${it.img ? `<img src="${esc(imgUrl(it.img))}" alt="">` : '<span>沒有照片</span>'}<label class="cms-pick">${it.img ? '換照片' : '選照片'}<input type="file" accept="image/*" data-cms-img="${key}:${i}"></label></div>` : ''}
    <div class="cms-fields">
      ${S.fields.map(([f, label, ph, type]) => `<label>${label}${type === 'area'
        ? `<textarea rows="3" data-f="${f}" placeholder="${esc(ph)}">${esc(it[f])}</textarea>`
        : `<input ${type === 'number' ? 'type="number" inputmode="numeric"' : ''} data-f="${f}" value="${esc(it[f])}" placeholder="${esc(ph)}">`}</label>`).join('')}
      ${S.sold ? `<label class="cms-check"><input type="checkbox" data-f="sold" ${it.sold ? 'checked' : ''}> 已售出</label>` : ''}
    </div>
    <div class="cms-ops"><button data-cms-up ${i === 0 ? 'disabled' : ''} aria-label="往上">↑</button><button class="danger" data-cms-del>刪除</button></div>
  </div>`;
}

function bind() {
  const body = document.querySelector('#modal-body');
  // 打字就存到 C（還沒送到官網）
  body.oninput = body.onchange = e => {
    const el = e.target, box = el.closest('.cms-item');
    if (el.dataset.cmsImg) { if (e.type === 'change') pickImage(el); return; }
    if (!box || !el.dataset.f) return;
    const it = C[box.dataset.key][+box.dataset.i];
    it[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (+el.value || 0) : el.value;
  };
  body.onclick = async e => {
    const t = e.target;
    if (t.dataset.cmsAdd) { C[t.dataset.cmsAdd].unshift({}); render(); return; }
    const box = t.closest('.cms-item');
    if (box && t.hasAttribute('data-cms-del')) {
      if (!t.dataset.sure) { t.dataset.sure = '1'; t.textContent = '確定刪除？'; return; }
      C[box.dataset.key].splice(+box.dataset.i, 1); render(); return;
    }
    if (box && t.hasAttribute('data-cms-up')) {
      const list = C[box.dataset.key], i = +box.dataset.i;
      [list[i - 1], list[i]] = [list[i], list[i - 1]]; render(); return;
    }
    if (t.hasAttribute('data-cms-save')) save(t);
  };
}

// 貼文分類：列出粉專最近的影片與貼文，每則可指定分類。存在 Firestore 公開文件 public/feedcats（選了就立刻生效，官網約 15 分鐘內更新）
const BASE_CATS = ['一條龍', '搬家', '清運', '清潔', '倉儲', '企業'];
const catsDocUrl = 'https://firestore.googleapis.com/v1/projects/moving-app-ac208/databases/(default)/documents/public/feedcats';
async function loadCats() {
  const box = document.querySelector('#cms-cats'); if (!box) return;
  try {
    const [r, d] = await Promise.all([fetch(feedUrl + '/feed'), fetch(catsDocUrl, { cache: 'no-store' }).then(x => x.ok ? x.json() : {}).catch(() => ({}))]);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'feed');
    let map = {};
    try { map = JSON.parse((d.fields && d.fields.json && d.fields.json.stringValue) || '{}'); } catch (e) { map = {}; }
    if (!Array.isArray(map._cats)) map._cats = [];          // 自己新增的分類名稱
    const names = () => BASE_CATS.concat(map._cats.filter(n => !BASE_CATS.includes(n)));
    const RULES = [['一條龍', /一條龍/], ['清運', /清運|垃圾|回收|廢棄|二手/], ['清潔', /清潔/], ['倉儲', /倉庫|倉儲|存放|儲存/], ['企業', /企業|公司行號|合作廠商|辦公室/]];
    const tagRe = () => new RegExp('#(' + names().join('|') + ')\\s*', 'g');
    const guess = t => { const m = String(t).match(new RegExp('#(' + names().join('|') + ')')); if (m) return m[1]; for (const [n, re] of RULES) if (re.test(t)) return n; return '搬家'; };
    const persist = async () => {
      try {
        const ok = await db.setPublic('feedcats', { json: JSON.stringify(map), updatedAt: new Date().toISOString() });
        api.toast(ok ? '分類已存好' : '要先登入雲端才能存分類');
      } catch (err) { api.toast('分類存失敗：' + err.message); }
    };
    const row = x => {
      const lines = String(x.text).replace(tagRe(), '').trim().split('\n').filter(Boolean);
      const cur = map[x.id] || '';
      return `<div class="cms-catrow"><a href="${esc(x.url)}" target="_blank" rel="noopener"><img src="${esc(feedUrl + '/img/' + x.id)}" alt="" loading="lazy"></a>
        <div class="cms-cattxt"><b>${esc((lines[0] || '').slice(0, 30))}</b><small>${esc((lines[1] || '').slice(0, 40))}</small><small>${esc(String(x.t).slice(0, 10))}</small></div>
        <select data-cat-id="${esc(x.id)}"><option value="">自動（${esc(guess(x.text))}）</option>${names().map(n => `<option ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>`;
    };
    const draw = () => {
      box.innerHTML = `<div class="cms-catadd"><input id="cms-newcat" maxlength="8" placeholder="新增分類，例如：套房"><button type="button" data-cat-add>新增</button></div>
        ${map._cats.length ? `<div class="cms-catmine">我新增的：${map._cats.map(n => `<span>${esc(n)} <button type="button" data-cat-del="${esc(n)}" aria-label="刪除${esc(n)}">✕</button></span>`).join('')}</div>` : ''}
        <div class="cms-catlist"><h5>短影片</h5>${j.videos.map(row).join('')}<h5>貼文（案例）</h5>${j.cases.map(row).join('')}</div>`;
    };
    draw();
    box.onchange = async e => {
      const el = e.target; if (!el.dataset.catId) return;
      if (el.value) map[el.dataset.catId] = el.value; else delete map[el.dataset.catId];
      await persist();
    };
    box.onclick = async e => {
      if (e.target.hasAttribute('data-cat-add')) {
        const inp = box.querySelector('#cms-newcat'), n = inp.value.trim().replace(/[#\s|]/g, '');
        if (!n) return;
        if (!names().includes(n)) map._cats.push(n);
        await persist(); draw(); api.toast('已新增「' + n + '」，到下面的貼文下拉選單就能選');
      }
      const del = e.target.getAttribute && e.target.getAttribute('data-cat-del');
      if (del) {
        map._cats = map._cats.filter(n => n !== del);
        for (const k of Object.keys(map)) if (k !== '_cats' && map[k] === del) delete map[k];
        await persist(); draw();
      }
    };
  } catch (e) { box.textContent = '讀不到粉專貼文（' + e.message + '），稍後再試。'; }
}

// 選照片 → 在手機上先壓小 → 上傳
async function pickImage(input) {
  const file = input.files && input.files[0]; if (!file) return;
  const target = input.dataset.cmsImg;
  const label = input.closest('.cms-pick'); if (label) label.firstChild.textContent = '上傳中…';
  try {
    const data = await shrink(file, target === 'hero' ? 1600 : 1200);
    const r = await post('/content/upload', { data });
    if (target === 'hero') C.hero = r.path;
    else { const [key, i] = target.split(':'); C[key][+i].img = r.path; }
    render();
    api.toast('照片上傳好了，記得按「儲存到官網」');
  } catch (e) {
    api.toast('照片上傳失敗：' + e.message);
    if (label) label.firstChild.textContent = '選照片';
  }
}

function shrink(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => reject(new Error('讀不到這張照片'));
    img.src = URL.createObjectURL(file);
  });
}

async function post(path, payload) {
  const token = await db.idToken();
  if (!token) throw new Error('要先用 Google 登入');
  const r = await fetch(siteWorkerUrl + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error === 'login' ? '登入的帳號不對' : (j.error || r.status));
  return j;
}

async function save(btn) {
  // 沒填東西的空白項目不存
  const clean = { hero: C.hero || '', videos: C.videos || [], cases: C.cases || [] };
  for (const k of Object.keys(SECTIONS)) clean[k] = C[k].filter(it => Object.entries(it).some(([f, v]) => f !== 'sold' && v));
  btn.disabled = true; btn.textContent = '儲存中…';
  try {
    await post('/content/save', { content: clean });
    C = clean;
    api.toast('已儲存！大約 1～5 分鐘後官網會更新');
    render();
  } catch (e) {
    api.toast('儲存失敗：' + e.message);
    btn.disabled = false; btn.textContent = '儲存到官網';
  }
}
