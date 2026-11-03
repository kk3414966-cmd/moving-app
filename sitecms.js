// 官網後台：封面照、搬家實錄（影片、案例）、Google 評論、二手家具
// 內容和照片透過 Cloudflare Worker 存到 GitHub（business-sites 倉庫），不佔 Firebase 額度。
import * as db from './store.js';
import { siteWorkerUrl, siteFilesBase } from './config.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const imgUrl = p => !p ? '' : /^(https?:|data:)/.test(p) ? p : siteFilesBase + p;

// 每一類有哪些欄位
const SECTIONS = {
  videos: { title: '搬家實錄・短影片', hint: '貼 YouTube／IG／FB 的影片網址，再選一張封面照。', img: true,
    fields: [['title', '標題', '例如：兩房搬家 3 小時完成'], ['url', '影片網址', 'https://…']] },
  cases: { title: '搬家實錄・案例', hint: '一張照片配從哪搬到哪。', img: true,
    fields: [['from', '從', '西屯'], ['to', '到', '北屯'], ['type', '房型', '兩房'], ['floors', '樓層', '3 樓 → 電梯'], ['trucks', '車數', '一車'], ['hours', '花多久', '3 小時'], ['text', '一句話', '衣櫃、冰箱全部包好，一車搞定。']] },
  reviews: { title: 'Google 評論', hint: '從 Google 地圖複製評論貼上。只放真實客人寫的。', img: false,
    fields: [['name', '名字', '王小姐'], ['text', '評論內容', '', 'area']] },
  used: { title: '二手家具', hint: '賣掉了就勾「已售出」，官網會標示。', img: true,
    fields: [['title', '名稱', '三人座布沙發'], ['price', '價格', '2500', 'number'], ['text', '說明', '九成新，台中可自取。']], sold: true },
};

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
    <p class="muted">改完按最下面的「儲存到官網」，大約 1～5 分鐘後官網就會更新。</p>
    <section class="cms-sec"><h4>封面照</h4><p class="muted">首頁最上面那張大照片。建議用橫的照片。</p>
      <div class="cms-hero">${C.hero ? `<img src="${esc(imgUrl(C.hero))}" alt="">` : '<span class="muted">目前用預設的照片</span>'}</div>
      <label class="cms-pick">選照片<input type="file" accept="image/*" data-cms-img="hero"></label></section>
    ${Object.keys(SECTIONS).map(sec).join('')}
    <div class="row cms-save"><button class="primary" data-cms-save>儲存到官網</button><button data-close>關閉</button></div>`);
  bind();
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
  const clean = { hero: C.hero || '' };
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
