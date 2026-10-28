'use strict';
(() => {

// ---------- fixed setup (from Sabrina's Expenses Tracking sheet) ----------
const APP_ID = 'korea-expense-tracker';
const APP_VERSION = '1.0.0';
const DEFAULT_RATE = 353.89;            // RM1.00 = ₩353.89
const EXCEL_TOTAL_KRW = 722387.88;      // Excel total budget (RM2,041.28)
const SEED = [
  { name: 'Sabrina Shopping',  budgetKrw: 278895.18, icon: '🛍️' },
  { name: 'T-Money',           budgetKrw: 60000,     icon: '🚇' },
  { name: 'Souvenir Shopping', budgetKrw: 201492.70, icon: '🎁' },
  { name: 'Hanbok Rental',     budgetKrw: 10000,     icon: '👘' },
  { name: 'Photobooth',        budgetKrw: 8000,      icon: '📸' },
  { name: 'Meal',              budgetKrw: 164000,    icon: '🍜' }
];
const PAYMENTS = ['Cash', 'Credit card', 'Debit card', 'Other'];
const APPROACH = 0.8;                   // "approaching limit" from 80% used
const TRIP_START = '2026-11-06', TRIP_END = '2026-11-12';
const MAX_KRW = 99999999;

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const round2 = n => Math.round(n * 100) / 100;
const pad = n => String(n).padStart(2, '0');
const toMyr = krw => krw / S.rate;

function fmtRM(n) {
  const a = Math.round(Math.abs(n) * 100) / 100;
  return (n < 0 && a > 0 ? '−' : '') + 'RM' + a.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtW(n) {
  const a = Math.round(Math.abs(n) * 100) / 100;
  return (n < 0 && a > 0 ? '−' : '') + '₩' + a.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
const fmtPct = f => !isFinite(f) ? '—' : (Math.round(f * 1000) / 10).toLocaleString('en-US') + '%';
const parseNum = s => { const t = String(s).replace(/[,\s₩RMrm]/g, ''); return t === '' || !/^\d*\.?\d*$/.test(t) ? NaN : Number(t); };

function nowLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function parseWhen(w) {
  const [d, t = '00:00'] = w.split('T');
  const [y, m, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  return new Date(y, m - 1, da, h, mi);
}
const fmtDay = day => parseWhen(day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = w => parseWhen(w).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const fmtDateTime = ms => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function ls(key, val) {
  try {
    if (val === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, val);
  } catch (e) { return null; }
}

// ---------- IndexedDB ----------
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      if (!('indexedDB' in window)) return rej(new Error('This browser has no IndexedDB.'));
      let r;
      try { r = indexedDB.open('korea-trip-wallet', 1); } catch (e) { return rej(e); }
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('expenses', { keyPath: 'id' });
        d.createObjectStore('categories', { keyPath: 'id' });
        d.createObjectStore('meta', { keyPath: 'key' });
      };
      r.onsuccess = () => { this.db = r.result; this.db.onversionchange = () => this.db.close(); res(); };
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('Storage is blocked by another open copy of the app. Close it and reopen.'));
    });
  },
  all(store) {
    return new Promise((res, rej) => {
      const q = this.db.transaction(store).objectStore(store).getAll();
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  },
  // ops: {store, put} | {store, del} | {store, clear: true}; all in one transaction (all or nothing)
  write(ops) {
    return new Promise((res, rej) => {
      let t;
      try {
        t = this.db.transaction([...new Set(ops.map(o => o.store))], 'readwrite');
        for (const o of ops) {
          const s = t.objectStore(o.store);
          if (o.clear) s.clear();
          else if (o.del !== undefined) s.delete(o.del);
          else s.put(o.put);
        }
      } catch (e) { if (t) try { t.abort(); } catch (_) {} return rej(e); }
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('The save was cancelled by the browser.'));
    });
  }
};

const S = { cats: [], exps: [], rate: DEFAULT_RATE, refTotalKrw: EXCEL_TOTAL_KRW, lastBackup: null, seeded: false, persisted: null };

async function load() {
  const [cats, exps, meta] = await Promise.all([DB.all('categories'), DB.all('expenses'), DB.all('meta')]);
  const m = Object.fromEntries(meta.map(x => [x.key, x.value]));
  S.cats = cats.sort((a, b) => a.order - b.order);
  S.exps = exps.sort((a, b) => b.when.localeCompare(a.when) || (b.createdAt || 0) - (a.createdAt || 0));
  S.rate = m.rate > 0 ? m.rate : DEFAULT_RATE;
  S.refTotalKrw = typeof m.refTotalKrw === 'number' ? m.refTotalKrw : EXCEL_TOTAL_KRW;
  S.lastBackup = m.lastBackup || null;
  S.seeded = !!m.seeded;
}

function seedOps() {
  return [
    ...SEED.map((c, i) => ({ store: 'categories', put: { id: uid(), name: c.name, icon: c.icon, budgetKrw: c.budgetKrw, order: i } })),
    { store: 'meta', put: { key: 'rate', value: DEFAULT_RATE } },
    { store: 'meta', put: { key: 'refTotalKrw', value: EXCEL_TOTAL_KRW } },
    { store: 'meta', put: { key: 'seeded', value: true } }
  ];
}

function storageErrText(e) {
  if (e && e.name === 'QuotaExceededError') return 'Your phone storage is full. Free up some space, then try again.';
  return 'Storage error: ' + ((e && e.message) || e) + '. If this keeps happening, export a backup from Settings.';
}

async function commit(ops, failMsg) {
  try {
    await DB.write(ops);
    await load();
    return true;
  } catch (e) {
    console.error(e);
    await modal({ title: '⚠️ Not saved', html: `<p><b>${esc(failMsg)}</b></p><p>${esc(storageErrText(e))}</p>` });
    return false;
  }
}

function requestPersist() {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then(p => { S.persisted = p; }).catch(() => {});
  }
}

// ---------- calculations ----------
function stats() {
  const per = new Map(S.cats.map(c => [c.id, 0]));
  let total = 0, orphan = 0;
  for (const e of S.exps) {
    total += e.amountKrw;
    if (per.has(e.categoryId)) per.set(e.categoryId, per.get(e.categoryId) + e.amountKrw);
    else orphan += e.amountKrw;
  }
  const budget = S.cats.reduce((a, c) => a + c.budgetKrw, 0);
  return { per, total, budget, orphan };
}
function level(spent, budget) {
  if (budget <= 0) return spent > 0 ? 'over' : 'ok';
  const f = spent / budget;
  return spent - budget > 0.004 ? 'over' : f >= APPROACH ? 'warn' : 'ok';
}
const frac = (spent, budget) => budget > 0 ? spent / budget : (spent > 0 ? Infinity : 0);
const bar = (f, lv) => `<div class="bar s-${lv}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${isFinite(f) ? Math.round(f * 100) : 100}"><span style="width:${Math.min(100, isFinite(f) ? f * 100 : 100)}%"></span></div>`;
const badge = lv => lv === 'warn' ? '<span class="badge warn">Almost there</span>' : lv === 'over' ? '<span class="badge over">Over budget</span>' : '';
const catById = id => S.cats.find(c => c.id === id);
const sumKrw = list => list.reduce((a, e) => a + e.amountKrw, 0);
const dayOf = e => e.when.slice(0, 10);

// ---------- UI primitives ----------
function modal({ title, html = '', buttons = [{ label: 'OK', value: true, cls: 'primary' }], onAction, onOpen }) {
  return new Promise(resolve => {
    const root = $('#modal-root');
    const w = document.createElement('div');
    w.className = 'modal-wrap';
    w.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="mt"><h2 id="mt">${title}</h2><div class="sheet-body">${html}</div><div class="sheet-actions">${
      buttons.map((b, i) => `<button type="button" class="btn ${b.cls || ''}" data-i="${i}">${b.label}</button>`).join('')}</div></div>`;
    root.appendChild(w);
    document.body.classList.add('modal-open');
    let busy = false;
    const close = v => { w.remove(); if (!root.children.length) document.body.classList.remove('modal-open'); resolve(v); };
    w.addEventListener('click', async e => {
      const b = e.target.closest('[data-i]');
      if (!b || busy) return;
      const btn = buttons[+b.dataset.i];
      if (onAction) {
        busy = true;
        const r = await onAction(btn.value, w);
        busy = false;
        if (r === false) return;
      }
      close(btn.value);
    });
    if (onOpen) onOpen(w);
  });
}
const confirmDlg = (title, msg, okLabel = 'Delete', danger = true) => modal({
  title, html: `<p>${msg}</p>`,
  buttons: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, cls: danger ? 'danger' : 'primary' }]
});

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
}

function tripBadge() {
  const today = nowLocal().slice(0, 10);
  const d = (a, b) => Math.round((parseWhen(b) - parseWhen(a)) / 864e5);
  if (today < TRIP_START) return `D-${d(today, TRIP_START)} to Seoul ✈️`;
  if (today <= TRIP_END) return `Trip day ${d(TRIP_START, today) + 1} of 7 💗`;
  return '6–12 Nov 2026 · trip done 💖';
}

function moneyPair(krw, cls = '') {
  return `<span class="myr ${cls}">${fmtRM(toMyr(krw))}</span> <span class="krw sub">${fmtW(krw)}</span>`;
}

function expCard(e, withActions) {
  const c = catById(e.categoryId);
  const title = e.description || (c ? c.name : 'Expense');
  return `<article class="card exp" data-edit="${e.id}">
    <span class="ico" aria-hidden="true">${esc(c ? c.icon : '❔')}</span>
    <div class="exp-main">
      <div class="exp-title">${esc(title)}</div>
      <div class="exp-meta">${esc(c ? c.name : 'Unknown category')} · ${fmtTime(e.when)}</div>
      <span class="pay-tag">${esc(e.payment)}</span>
      ${withActions ? `<div class="exp-actions"><button type="button" class="btn small" data-edit="${e.id}">Edit</button><button type="button" class="btn small ghost-danger" data-del="${e.id}">Delete</button></div>` : ''}
    </div>
    <div class="exp-amt"><div class="krw">${fmtW(e.amountKrw)}</div><div class="myr">${fmtRM(toMyr(e.amountKrw))}</div></div>
  </article>`;
}

function dayGroups(list, withActions) {
  const groups = new Map();
  for (const e of list) { const k = dayOf(e); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  let h = '';
  for (const [day, items] of groups) {
    const t = sumKrw(items);
    h += `<div class="day-head"><h3>${fmtDay(day)}</h3><div class="tot"><span class="myr">${fmtRM(toMyr(t))}</span> <span class="krw">${fmtW(t)}</span></div></div>`;
    h += items.map(e => expCard(e, withActions)).join('');
  }
  return h;
}

// ---------- views ----------
const view = () => $('#view');

function renderDash() {
  const st = stats();
  const f = frac(st.total, st.budget);
  const lv = level(st.total, st.budget);
  const remaining = st.budget - st.total;
  let h = '';
  if (lv === 'over' && st.budget > 0) {
    h += `<div class="banner over-total">⚠️ <b>Over your total budget</b> by <b>${fmtRM(toMyr(-remaining))}</b> <span class="krw">(${fmtW(-remaining)})</span></div>`;
  }
  h += `<a class="btn-add" href="#/add">＋ Add expense</a>`;
  h += `<section class="card tape summary s-${lv}">
    <div class="sum-head">
      <div><div class="label">Spent so far</div><div class="big myr">${fmtRM(toMyr(st.total))}</div><div class="krw sub">${fmtW(st.total)}</div></div>
      <div style="text-align:right"><div class="label">Used</div><div class="pct-big">${fmtPct(f)}</div></div>
    </div>
    ${bar(f, lv)}
    <div class="stats3">
      <div><div class="label">Budget</div><div class="myr">${fmtRM(toMyr(st.budget))}</div><div class="krw">${fmtW(st.budget)}</div></div>
      <div><div class="label">Spent</div><div class="myr">${fmtRM(toMyr(st.total))}</div><div class="krw">${fmtW(st.total)}</div></div>
      <div><div class="label">${remaining < 0 ? 'Over by' : 'Remaining'}</div><div class="myr ${remaining < 0 ? 'rem-over' : ''}">${fmtRM(toMyr(Math.abs(remaining)))}</div><div class="krw">${fmtW(Math.abs(remaining))}</div></div>
    </div>
    <p class="hint">Fixed rate RM1.00 = ₩${S.rate.toLocaleString('en-US')} (set in Settings, not live)</p>
  </section>`;

  if (Math.abs(st.budget - S.refTotalKrw) > 0.004) {
    h += `<div class="banner info">ℹ️ Category budgets add up to <b>${fmtW(st.budget)}</b> (${fmtRM(toMyr(st.budget))}), but the Excel total is <b>${fmtW(S.refTotalKrw)}</b> (${fmtRM(toMyr(S.refTotalKrw))}). Difference: ${fmtW(st.budget - S.refTotalKrw)}. <a href="#/settings">Review in Settings</a></div>`;
  }
  if (S.exps.length && (!S.lastBackup || Date.now() - S.lastBackup > 864e5)) {
    h += `<div class="banner note">💾 ${S.lastBackup ? 'Last backup ' + fmtDateTime(S.lastBackup) + '.' : 'No backup yet.'} Data lives only on this phone. <a href="#/settings">Back up now</a></div>`;
  }

  h += `<h2 class="section-title">Categories</h2>`;
  h += S.cats.map(c => {
    const sp = st.per.get(c.id) || 0, l = level(sp, c.budgetKrw), rem = c.budgetKrw - sp;
    return `<a class="card cat s-${l}" href="#/cat/${c.id}">
      <div class="cat-head"><span class="ico" aria-hidden="true">${esc(c.icon)}</span><span class="cat-name">${esc(c.name)}</span>${badge(l)}<span class="chev" aria-hidden="true">›</span></div>
      <div class="cat-nums"><span><span class="myr">${fmtRM(toMyr(sp))}</span> <small>of ${fmtRM(toMyr(c.budgetKrw))} · ${fmtPct(frac(sp, c.budgetKrw))}</small></span>
      <span class="${rem < 0 ? 'rem-over' : 'muted'}">${rem < 0 ? fmtRM(toMyr(-rem)) + ' over' : fmtRM(toMyr(rem)) + ' left'}</span></div>
      ${bar(frac(sp, c.budgetKrw), l)}
    </a>`;
  }).join('');
  if (st.orphan > 0) {
    h += `<div class="card"><b>Uncategorised</b> (category was removed): ${moneyPair(st.orphan)}<br><span class="hint">Open these in History and pick a category.</span></div>`;
  }
  if (!S.cats.length) h += `<div class="card empty"><div class="emo">🗂️</div><p>No categories yet. Add one in Settings.</p></div>`;
  view().innerHTML = h;
}

// ----- add / edit form -----
let lastSaveAt = 0;
function renderForm(editId, presetCat) {
  const editing = editId ? S.exps.find(e => e.id === editId) : null;
  if (editId && !editing) { view().innerHTML = `<div class="card empty"><div class="emo">🔍</div><p>That expense no longer exists.</p><a class="btn" href="#/history">Back to History</a></div>`; return; }
  if (!S.cats.length) { view().innerHTML = `<div class="card empty"><div class="emo">🗂️</div><p>Add a category in Settings first.</p><a class="btn primary" href="#/settings">Open Settings</a></div>`; return; }
  const lastCat = ls('lastCat'), lastPay = ls('lastPay');
  const cat = editing ? editing.categoryId : (presetCat && catById(presetCat) ? presetCat : (catById(lastCat) ? lastCat : ''));
  const pay = editing ? editing.payment : (PAYMENTS.includes(lastPay) ? lastPay : 'Cash');
  const amt = editing ? editing.amountKrw.toLocaleString('en-US') : '';

  view().innerHTML = `<form id="expForm" class="card tape" novalidate autocomplete="off">
    <h2 style="margin-bottom:14px">${editing ? 'Edit expense' : 'Add expense'}</h2>
    <label class="field" for="amt"><span>Amount <span class="cur-tag krw">₩ KRW</span></span>
      <div class="amount-box"><span class="cur" aria-hidden="true">₩</span><input id="amt" name="amt" inputmode="numeric" pattern="[0-9,]*" placeholder="0" value="${amt}" enterkeyhint="done" aria-describedby="myrLive amtErr"></div>
    </label>
    <div id="myrLive" class="myr-live" style="margin-top:-8px">≈ <b>RM0.00</b> <span class="cur-tag myr">RM MYR</span></div>
    <p class="hint">at RM1.00 = ₩${S.rate.toLocaleString('en-US')}</p>
    <p class="err" id="amtErr"></p>

    <div class="legend" style="margin-top:14px">Category</div>
    <fieldset class="chips" id="catChips">
      ${S.cats.map(c => `<label class="chip"><input type="radio" name="cat" value="${c.id}" ${c.id === cat ? 'checked' : ''}><span><span aria-hidden="true">${esc(c.icon)}</span>${esc(c.name)}</span></label>`).join('')}
    </fieldset>
    <p class="cat-after" id="catAfter"></p>
    <p class="err" id="catErr"></p>

    <div class="legend">Paid with</div>
    <fieldset class="chips pay">
      ${PAYMENTS.map(p => `<label class="chip"><input type="radio" name="pay" value="${p}" ${p === pay ? 'checked' : ''}><span>${p}</span></label>`).join('')}
    </fieldset>

    <label class="field"><span>Description (optional)</span><input id="desc" maxlength="80" placeholder="e.g. Tteokbokki at Myeongdong" value="${esc(editing ? editing.description : '')}" enterkeyhint="done"></label>
    <label class="field"><span>Date &amp; time</span><input id="when" type="datetime-local" value="${editing ? editing.when : nowLocal()}" required></label>
    <p class="err" id="whenErr"></p>

    <button type="submit" class="btn primary block" id="saveBtn" style="min-height:58px;font-size:19px">${editing ? 'Save changes' : 'Save expense'}</button>
    ${editing ? `<div class="btn-row" style="margin-top:10px"><a class="btn" href="#/history">Cancel</a><button type="button" class="btn ghost-danger" data-del="${editing.id}">Delete</button></div>` : ''}
  </form>`;

  const form = $('#expForm'), amtEl = $('#amt');
  const readAmt = () => parseNum(amtEl.value);
  const update = () => {
    const n = readAmt();
    $('#myrLive').innerHTML = `≈ <b>${fmtRM(isFinite(n) ? toMyr(n) : 0)}</b> <span class="cur-tag myr">RM MYR</span>`;
    const cid = (form.querySelector('input[name=cat]:checked') || {}).value;
    const c = catById(cid);
    if (c) {
      const st = stats();
      let spent = st.per.get(c.id) || 0;
      if (editing && editing.categoryId === c.id) spent -= editing.amountKrw;
      const after = c.budgetKrw - spent - (isFinite(n) ? n : 0);
      $('#catAfter').innerHTML = `${esc(c.name)}: ${after < 0 ? `<b class="rem-over">${fmtRM(toMyr(-after))} over budget</b> after this` : `${fmtRM(toMyr(after))} left after this`}`;
    } else $('#catAfter').textContent = '';
  };
  amtEl.addEventListener('input', () => {
    const digits = amtEl.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 8);
    amtEl.value = digits ? Number(digits).toLocaleString('en-US') : '';
    $('#amtErr').textContent = '';
    update();
  });
  form.addEventListener('change', e => { if (e.target.name === 'cat') $('#catErr').textContent = ''; update(); });
  update();

  let saving = false;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (saving || Date.now() - lastSaveAt < 1200) return;   // duplicate-tap protection
    const n = readAmt();
    const cid = (form.querySelector('input[name=cat]:checked') || {}).value;
    const payment = (form.querySelector('input[name=pay]:checked') || {}).value || 'Other';
    const when = $('#when').value;
    let ok = true;
    if (!isFinite(n) || n <= 0) { $('#amtErr').textContent = 'Enter an amount in won (more than ₩0).'; ok = false; }
    else if (n > MAX_KRW) { $('#amtErr').textContent = 'That amount looks too big. Please check it.'; ok = false; }
    if (!catById(cid)) { $('#catErr').textContent = 'Pick a category.'; ok = false; }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(when)) { $('#whenErr').textContent = 'Pick a date and time.'; ok = false; }
    else $('#whenErr').textContent = '';
    if (!ok) { (isFinite(n) && n > 0 ? form.querySelector('.err:not(:empty)') : amtEl).scrollIntoView({ block: 'center' }); return; }

    saving = true;
    const btn = $('#saveBtn'); btn.disabled = true; btn.textContent = 'Saving…';
    const ts = Date.now();
    const rec = {
      ...(editing || { id: uid(), createdAt: ts }),
      amountKrw: n, categoryId: cid, payment, when: when.slice(0, 16),
      description: $('#desc').value.trim(), updatedAt: ts
    };
    const saved = await commit([{ store: 'expenses', put: rec }], 'Sorry, this expense was NOT saved.');
    saving = false;
    if (!saved) { btn.disabled = false; btn.textContent = editing ? 'Save changes' : 'Save expense'; return; }
    lastSaveAt = Date.now();
    ls('lastCat', cid); ls('lastPay', payment);
    requestPersist();
    if (editing) { toast('Changes saved ✓'); location.hash = '#/history'; return; }
    const c = catById(cid);
    const choice = await modal({
      title: 'Saved ✓',
      html: `<div class="saved-emo">🎉</div><p style="text-align:center"><b class="krw" style="font-size:22px">${fmtW(n)}</b><br><span class="myr">${fmtRM(toMyr(n))}</span><br>${esc(c.icon)} ${esc(c.name)} · ${esc(payment)}</p>`,
      buttons: [{ label: 'Done', value: 'done' }, { label: '＋ Add another', value: 'again', cls: 'primary' }]
    });
    if (choice === 'again') { renderForm(null); $('#amt').focus(); }
    else location.hash = '#/dash';
  });
}

// ----- history -----
const H = { cat: 'all', day: 'all' };
function renderHistory() {
  if (!S.exps.length) {
    view().innerHTML = `<div class="card tape empty"><div class="emo">📒</div><h2>No expenses yet</h2><p>Every expense you add shows up here, newest first.</p><a class="btn primary" href="#/add">＋ Add your first expense</a></div>`;
    return;
  }
  const days = [...new Set(S.exps.map(dayOf))];
  if (H.day !== 'all' && !days.includes(H.day)) H.day = 'all';
  if (H.cat !== 'all' && H.cat !== 'none' && !catById(H.cat)) H.cat = 'all';
  const list = S.exps.filter(e => (H.cat === 'all' || (H.cat === 'none' ? !catById(e.categoryId) : e.categoryId === H.cat)) && (H.day === 'all' || dayOf(e) === H.day));
  const hasOrphans = S.exps.some(e => !catById(e.categoryId));
  let h = `<section class="card tape mint"><div class="filters">
    <label class="field"><span>Day</span><select id="fDay"><option value="all">All days</option>${days.map(d => `<option value="${d}" ${d === H.day ? 'selected' : ''}>${fmtDay(d)}</option>`).join('')}</select></label>
    <label class="field"><span>Category</span><select id="fCat"><option value="all">All categories</option>${S.cats.map(c => `<option value="${c.id}" ${c.id === H.cat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}${hasOrphans ? `<option value="none" ${H.cat === 'none' ? 'selected' : ''}>Uncategorised</option>` : ''}</select></label>
  </div>`;
  const t = sumKrw(list);
  h += `<div style="margin-top:12px"><div class="label">${H.day === 'all' ? 'Total shown' : 'Total for ' + fmtDay(H.day)} · ${list.length} item${list.length === 1 ? '' : 's'}</div>
    <div><span class="myr" style="font-size:24px">${fmtRM(toMyr(t))}</span> <span class="krw">${fmtW(t)}</span></div></div></section>`;
  h += list.length ? dayGroups(list, true) : `<div class="card empty"><div class="emo">🔎</div><p>Nothing matches these filters.</p></div>`;
  view().innerHTML = h;
  $('#fDay').addEventListener('change', e => { H.day = e.target.value; renderHistory(); });
  $('#fCat').addEventListener('change', e => { H.cat = e.target.value; renderHistory(); });
}

async function deleteExpense(id) {
  const e = S.exps.find(x => x.id === id);
  if (!e) return;
  const c = catById(e.categoryId);
  const yes = await confirmDlg('Delete this expense?', `${esc(e.description || (c ? c.name : 'Expense'))}: <b>${fmtW(e.amountKrw)}</b> (${fmtRM(toMyr(e.amountKrw))}) on ${fmtDay(dayOf(e))}. This can't be undone.`);
  if (!yes) return;
  if (await commit([{ store: 'expenses', del: id }], 'Sorry, the expense was NOT deleted.')) {
    toast('Expense deleted');
    if (location.hash.startsWith('#/edit')) location.hash = '#/history'; else route();
  }
}

// ----- category detail -----
function renderCat(id) {
  const c = catById(id);
  if (!c) { view().innerHTML = `<div class="card empty"><div class="emo">🗂️</div><p>This category no longer exists.</p><a class="btn" href="#/dash">Home</a></div>`; return; }
  const list = S.exps.filter(e => e.categoryId === id);
  const sp = sumKrw(list), rem = c.budgetKrw - sp, f = frac(sp, c.budgetKrw), l = level(sp, c.budgetKrw);
  view().innerHTML = `<section class="card tape s-${l}">
      <div class="cat-head"><span class="ico" aria-hidden="true">${esc(c.icon)}</span><h2 class="cat-name">${esc(c.name)}</h2>${badge(l)}</div>
      <div class="sum-head" style="margin-top:14px"><div><div class="label">Used</div><div class="pct-big">${fmtPct(f)}</div></div></div>
      ${bar(f, l)}
      <div class="kv">
        <div><div class="label">Budget</div><div class="myr">${fmtRM(toMyr(c.budgetKrw))}</div><div class="krw sub">${fmtW(c.budgetKrw)}</div></div>
        <div><div class="label">Spent</div><div class="myr">${fmtRM(toMyr(sp))}</div><div class="krw sub">${fmtW(sp)}</div></div>
        <div style="grid-column:1/-1"><div class="label">${rem < 0 ? 'Over budget by' : 'Remaining'}</div><div class="myr ${rem < 0 ? 'rem-over' : ''}">${fmtRM(toMyr(Math.abs(rem)))}</div><div class="krw sub">${fmtW(Math.abs(rem))}</div></div>
      </div>
      ${rem < 0 ? `<div class="over-callout">⚠️ Over this budget by ${fmtRM(toMyr(-rem))} (${fmtW(-rem)}). You can still keep recording expenses.</div>` : ''}
      <div class="btn-row" style="margin-top:14px"><a class="btn primary" href="#/add/${c.id}">＋ Add here</a><button type="button" class="btn" data-editcat="${c.id}">Edit budget</button></div>
    </section>
    <h2 class="section-title">${list.length} expense${list.length === 1 ? '' : 's'}</h2>
    ${list.length ? dayGroups(list, false) : `<div class="card empty"><div class="emo">🌸</div><p>Nothing spent here yet.</p></div>`}`;
}

// ----- category edit -----
async function editCategory(id) {
  const c = id ? catById(id) : null;
  const html = `
    <label class="field"><span>Name</span><input id="cName" maxlength="40" value="${esc(c ? c.name : '')}"></label>
    <label class="field"><span>Emoji</span><input id="cIcon" maxlength="8" value="${esc(c ? c.icon : '🏷️')}"></label>
    <label class="field"><span>Budget <span class="cur-tag krw">₩ KRW</span></span><input id="cKrw" inputmode="decimal" value="${c ? c.budgetKrw : ''}"></label>
    <label class="field"><span>or Budget <span class="cur-tag myr">RM MYR</span></span><input id="cMyr" inputmode="decimal" value="${c ? round2(toMyr(c.budgetKrw)).toFixed(2) : ''}"></label>
    <p class="hint">Typing in one box fills the other at RM1.00 = ₩${S.rate.toLocaleString('en-US')}. The budget is saved in won. Existing expenses are kept.</p>
    <p class="err" id="cErr"></p>`;
  await modal({
    title: c ? 'Edit category' : 'New category', html,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Save', value: true, cls: 'primary' }],
    onOpen: w => {
      const k = $('#cKrw', w), m = $('#cMyr', w);
      k.addEventListener('input', () => { const n = parseNum(k.value); m.value = isFinite(n) ? round2(toMyr(n)).toFixed(2) : ''; });
      m.addEventListener('input', () => { const n = parseNum(m.value); k.value = isFinite(n) ? String(round2(n * S.rate)) : ''; });
    },
    onAction: async (v, w) => {
      if (!v) return true;
      const name = $('#cName', w).value.trim(), icon = $('#cIcon', w).value.trim() || '🏷️', krw = parseNum($('#cKrw', w).value);
      const err = $('#cErr', w);
      if (!name) { err.textContent = 'Give it a name.'; return false; }
      if (S.cats.some(x => x.id !== (c && c.id) && x.name.toLowerCase() === name.toLowerCase())) { err.textContent = 'You already have a category with that name.'; return false; }
      if (!isFinite(krw) || krw < 0) { err.textContent = 'Enter a budget of ₩0 or more.'; return false; }
      const rec = c ? { ...c, name, icon, budgetKrw: round2(krw) } : { id: uid(), name, icon, budgetKrw: round2(krw), order: S.cats.length ? Math.max(...S.cats.map(x => x.order)) + 1 : 0 };
      if (!(await commit([{ store: 'categories', put: rec }], 'Sorry, the category was NOT saved.'))) return false;
      toast('Category saved ✓');
      route();
      return true;
    }
  });
}

async function deleteCategory(id) {
  const c = catById(id);
  if (!c) return;
  const n = S.exps.filter(e => e.categoryId === id).length;
  if (n) {
    await modal({ title: "Can't delete yet", html: `<p><b>${esc(c.name)}</b> has ${n} expense${n === 1 ? '' : 's'}. Move them to another category (edit each one in History) or delete them first, so nothing gets lost.</p>` });
    return;
  }
  if (!(await confirmDlg('Delete category?', `Delete <b>${esc(c.name)}</b> and its budget of ${fmtRM(toMyr(c.budgetKrw))} (${fmtW(c.budgetKrw)})?`))) return;
  if (await commit([{ store: 'categories', del: id }], 'Sorry, the category was NOT deleted.')) { toast('Category deleted'); route(); }
}

// ----- settings -----
async function renderSettings() {
  const st = stats();
  const mismatch = Math.abs(st.budget - S.refTotalKrw) > 0.004;
  let usage = '';
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      if (est.usage != null) usage = `Using about ${(est.usage / 1024).toFixed(0)} KB on this phone.`;
    }
    if (navigator.storage && navigator.storage.persisted) S.persisted = await navigator.storage.persisted();
  } catch (e) { /* not supported */ }
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  view().innerHTML = `
  <section class="card tape">
    <h2>Exchange rate</h2>
    <p class="hint" style="margin-bottom:12px">A fixed rate you set. It is never fetched from the internet. All RM figures are recalculated from won with this rate.</p>
    <label class="field"><span>₩ KRW per RM1.00</span><input id="rate" inputmode="decimal" value="${S.rate}"></label>
    <p class="hint" id="rateEx">Example: ₩35,389 = ${fmtRM(35389 / S.rate)}</p>
    <p class="err" id="rateErr"></p>
    <div class="btn-row" style="margin-top:10px"><button type="button" class="btn primary" id="saveRate">Save rate</button><button type="button" class="btn" id="defRate">Reset to 353.89</button></div>
  </section>

  <section class="card tape mint">
    <h2>Categories &amp; budgets</h2>
    <div style="margin-top:8px">${S.cats.map(c => `<div class="list-row"><span class="ico" aria-hidden="true">${esc(c.icon)}</span>
      <div class="grow"><b>${esc(c.name)}</b><br><span class="myr">${fmtRM(toMyr(c.budgetKrw))}</span> <span class="krw sub">${fmtW(c.budgetKrw)}</span></div>
      <button type="button" class="btn small" data-editcat="${c.id}">Edit</button><button type="button" class="btn small ghost-danger" data-delcat="${c.id}" aria-label="Delete ${esc(c.name)}">✕</button></div>`).join('')}</div>
    <div class="list-row"><div class="grow"><b>Total</b> (sum of categories)<br><span class="myr">${fmtRM(toMyr(st.budget))}</span> <span class="krw sub">${fmtW(st.budget)}</span></div></div>
    <div class="banner ${mismatch ? 'info' : 'note'}" style="margin-top:8px">${mismatch
      ? `ℹ️ Doesn't match the Excel total of <b>${fmtW(S.refTotalKrw)}</b> (${fmtRM(toMyr(S.refTotalKrw))}). Difference: <b>${fmtW(st.budget - S.refTotalKrw)}</b> (${fmtRM(toMyr(st.budget - S.refTotalKrw))}).<br><button type="button" class="btn small" id="acceptTotal">This new total is intended</button>`
      : `✓ Matches the Excel total of ${fmtW(S.refTotalKrw)} (${fmtRM(toMyr(S.refTotalKrw))}).`}</div>
    <button type="button" class="btn block" style="margin-top:12px" data-editcat="">＋ Add category</button>
  </section>

  <section class="card tape">
    <h2>Backup</h2>
    <p class="hint" style="margin-bottom:12px">${S.lastBackup ? 'Last JSON backup: ' + fmtDateTime(S.lastBackup) : 'No JSON backup yet.'} · ${S.exps.length} expense${S.exps.length === 1 ? '' : 's'} saved</p>
    <div class="btn-row"><button type="button" class="btn primary" id="expJson">Export backup (JSON)</button><button type="button" class="btn" id="expCsv">Export for Excel (CSV)</button></div>
    <button type="button" class="btn block" style="margin-top:10px" id="impJson">Import backup (JSON)</button>
    <p class="hint">On iPhone, choose <b>Save to Files</b> (or AirDrop / email it to yourself) in the share sheet.</p>
  </section>

  <section class="card">
    <h2>About your data</h2>
    <div class="prose" style="margin-top:8px">
      <p>Everything is stored only on this phone, inside this app. There is no account and no cloud sync.</p>
      <ul>
        <li>Deleting the app from your Home Screen, clearing Safari website data, or losing the phone <b>deletes your expenses</b>.</li>
        <li>iOS can clear data of web apps that are <b>not</b> added to the Home Screen and haven't been opened for a while. Always use the Home Screen icon.</li>
        <li>Export a JSON backup every evening of the trip and keep it in Files or iCloud Drive.</li>
      </ul>
      <p class="hint">Home Screen app: ${standalone ? 'yes ✓' : 'no, open it from the Home Screen icon'} · Persistent storage: ${S.persisted === true ? 'granted ✓' : S.persisted === false ? 'not granted by iOS (keep backing up)' : 'unknown'}${usage ? ' · ' + usage : ''}</p>
    </div>
  </section>

  <section class="card">
    <h2>Reset</h2>
    <div class="btn-row" style="margin-top:12px"><button type="button" class="btn ghost-danger" id="clearExp">Delete all expenses</button><button type="button" class="btn ghost-danger" id="resetAll">Reset everything</button></div>
    <p class="hint">Version ${APP_VERSION}</p>
  </section>`;

  const rateEl = $('#rate');
  rateEl.addEventListener('input', () => { const r = parseNum(rateEl.value); $('#rateEx').textContent = r > 0 ? `Example: ₩35,389 = ${fmtRM(35389 / r)}` : ''; });
  const saveRate = async r => {
    if (!(r > 0) || r > 100000) { $('#rateErr').textContent = 'Enter a rate above 0, e.g. 353.89.'; return; }
    if (await commit([{ store: 'meta', put: { key: 'rate', value: r } }], 'Sorry, the rate was NOT saved.')) { toast(`Rate saved: RM1.00 = ₩${r}`); renderSettings(); }
  };
  $('#saveRate').addEventListener('click', () => saveRate(parseNum(rateEl.value)));
  $('#defRate').addEventListener('click', () => saveRate(DEFAULT_RATE));
  const acc = $('#acceptTotal');
  if (acc) acc.addEventListener('click', async () => {
    if (!(await confirmDlg('Use the new total?', `Set the reference total to ${fmtW(st.budget)} (${fmtRM(toMyr(st.budget))}) so the mismatch note goes away? Your Excel total was ${fmtW(S.refTotalKrw)}.`, 'Use new total', false))) return;
    if (await commit([{ store: 'meta', put: { key: 'refTotalKrw', value: round2(st.budget) } }], 'Sorry, NOT saved.')) renderSettings();
  });
  $('#expJson').addEventListener('click', exportJson);
  $('#expCsv').addEventListener('click', exportCsv);
  $('#impJson').addEventListener('click', () => { const f = $('#importFile'); f.value = ''; f.click(); });
  $('#clearExp').addEventListener('click', async () => {
    if (!S.exps.length) { toast('There are no expenses to delete'); return; }
    if (!(await confirmDlg('Delete ALL expenses?', `This permanently deletes all ${S.exps.length} expenses. Categories, budgets and the rate stay. Export a backup first if you might need them.`, 'Delete all'))) return;
    if (await commit([{ store: 'expenses', clear: true }], 'Sorry, nothing was deleted.')) { toast('All expenses deleted'); renderSettings(); }
  });
  $('#resetAll').addEventListener('click', async () => {
    const v = await modal({
      title: 'Reset everything?',
      html: `<p>This deletes all ${S.exps.length} expenses and any category changes, and restores the original Excel budgets and the 353.89 rate.</p>`,
      buttons: [{ label: 'Cancel', value: false }, { label: 'Export backup first', value: 'backup' }, { label: 'Reset everything', value: true, cls: 'danger' }]
    });
    if (v === 'backup') { exportJson(); return; }
    if (v !== true) return;
    if (await commit([{ store: 'expenses', clear: true }, { store: 'categories', clear: true }, { store: 'meta', clear: true }, ...seedOps()], 'Sorry, the reset did NOT happen.')) { toast('Reset done'); renderSettings(); }
  });
}

// ---------- backup ----------
const stamp = () => nowLocal().replace(/[-:]/g, '').replace('T', '-');

async function saveFile(name, text, type) {
  const blob = new Blob([text], { type });
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  if (coarse && navigator.canShare && typeof File === 'function') {
    const file = new File([blob], name, { type });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return true; }
      catch (e) { if (e.name === 'AbortError') return false; }
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  return true;
}

async function exportJson() {
  const data = { app: APP_ID, version: 1, exportedAt: new Date().toISOString(), rate: S.rate, refTotalKrw: S.refTotalKrw, categories: S.cats, expenses: S.exps };
  const ok = await saveFile(`korea-trip-wallet-backup-${stamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
  if (!ok) return;
  if (await commit([{ store: 'meta', put: { key: 'lastBackup', value: Date.now() } }], 'The backup file was made, but its date could not be recorded.')) {
    toast('Backup exported ✓');
    if (location.hash.startsWith('#/settings')) renderSettings();
  }
}

async function exportCsv() {
  const safe = s => /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  const cell = v => { const s = String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = [['Date', 'Time', 'Description', 'Category', 'Payment', 'Amount (KRW)', 'Amount (MYR)', 'Rate (KRW per RM1)']];
  [...S.exps].sort((a, b) => a.when.localeCompare(b.when)).forEach(e => {
    const [d, t] = e.when.split('T');
    const c = catById(e.categoryId);
    rows.push([d, t, safe(e.description || ''), safe(c ? c.name : 'Uncategorised'), e.payment, e.amountKrw, round2(toMyr(e.amountKrw)).toFixed(2), S.rate]);
  });
  if (await saveFile(`korea-trip-wallet-${stamp()}.csv`, '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n'), 'text/csv')) toast('CSV exported ✓');
}

function validateBackup(o) {
  const fail = m => { throw new Error(m); };
  if (!o || typeof o !== 'object' || o.app !== APP_ID) fail("This isn't a Korea Trip Wallet backup file.");
  if (!Array.isArray(o.categories) || !Array.isArray(o.expenses)) fail('The backup is missing its categories or expenses.');
  if (!(typeof o.rate === 'number' && o.rate > 0)) fail('The backup has an invalid exchange rate.');
  const cats = o.categories.map((c, i) => {
    if (!c || typeof c.id !== 'string' || typeof c.name !== 'string' || !c.name.trim() || !(typeof c.budgetKrw === 'number' && c.budgetKrw >= 0)) fail(`Category #${i + 1} is invalid.`);
    return { id: c.id, name: c.name.trim().slice(0, 40), icon: typeof c.icon === 'string' && c.icon ? c.icon.slice(0, 8) : '🏷️', budgetKrw: c.budgetKrw, order: typeof c.order === 'number' ? c.order : i };
  });
  const exps = o.expenses.map((e, i) => {
    if (!e || typeof e.id !== 'string' || !(typeof e.amountKrw === 'number' && e.amountKrw > 0 && e.amountKrw <= MAX_KRW) ||
        typeof e.categoryId !== 'string' || typeof e.when !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(e.when)) fail(`Expense #${i + 1} is invalid.`);
    return { id: e.id, amountKrw: e.amountKrw, categoryId: e.categoryId, when: e.when.slice(0, 16),
      payment: PAYMENTS.includes(e.payment) ? e.payment : 'Other', description: typeof e.description === 'string' ? e.description.slice(0, 80) : '',
      createdAt: typeof e.createdAt === 'number' ? e.createdAt : 0, updatedAt: typeof e.updatedAt === 'number' ? e.updatedAt : 0 };
  });
  return { rate: o.rate, refTotalKrw: typeof o.refTotalKrw === 'number' ? o.refTotalKrw : EXCEL_TOTAL_KRW, cats, exps, exportedAt: o.exportedAt };
}

async function importFile(file) {
  let b;
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('That file is too large to be a backup.');
    b = validateBackup(JSON.parse(await file.text()));
  } catch (e) {
    await modal({ title: "Can't import", html: `<p>${esc(e instanceof SyntaxError ? "The file isn't valid JSON." : e.message)}</p><p>Nothing was changed.</p>` });
    return;
  }
  const newExps = b.exps.filter(e => !S.exps.some(x => x.id === e.id));
  const newCats = b.cats.filter(c => !S.cats.some(x => x.id === c.id));
  const v = await modal({
    title: 'Import backup?',
    html: `<p>Backup${b.exportedAt ? ' from ' + esc(fmtDateTime(Date.parse(b.exportedAt))) : ''}: <b>${b.exps.length}</b> expenses, <b>${b.cats.length}</b> categories, rate ₩${b.rate}.</p>
      <p><b>Merge</b> adds ${newExps.length} new expense${newExps.length === 1 ? '' : 's'} and ${newCats.length} new categor${newCats.length === 1 ? 'y' : 'ies'}. Your current data and rate stay as they are.</p>
      <p><b>Replace</b> ⚠️ deletes everything on this phone now (${S.exps.length} expenses, ${S.cats.length} categories) and uses the backup instead.</p>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Replace all', value: 'replace', cls: 'danger' }, { label: 'Merge', value: 'merge', cls: 'primary' }]
  });
  if (!v) return;
  let ops;
  if (v === 'replace') {
    if (!(await confirmDlg('Really replace?', `Your current ${S.exps.length} expenses will be deleted and replaced by the ${b.exps.length} in the backup.`, 'Replace'))) return;
    ops = [{ store: 'expenses', clear: true }, { store: 'categories', clear: true }, { store: 'meta', clear: true },
      ...b.cats.map(c => ({ store: 'categories', put: c })), ...b.exps.map(e => ({ store: 'expenses', put: e })),
      { store: 'meta', put: { key: 'rate', value: b.rate } }, { store: 'meta', put: { key: 'refTotalKrw', value: b.refTotalKrw } },
      { store: 'meta', put: { key: 'seeded', value: true } }];
    if (S.lastBackup) ops.push({ store: 'meta', put: { key: 'lastBackup', value: S.lastBackup } });
  } else {
    const base = S.cats.length ? Math.max(...S.cats.map(x => x.order)) + 1 : 0;
    ops = [...newCats.map((c, i) => ({ store: 'categories', put: { ...c, order: base + i } })), ...newExps.map(e => ({ store: 'expenses', put: e }))];
    if (!ops.length) { toast('Nothing new to merge'); return; }
  }
  if (await commit(ops, 'Sorry, the import did NOT happen. Your data is unchanged.')) { toast(v === 'replace' ? 'Backup restored ✓' : 'Backup merged ✓'); route(); }
}

// ---------- routing & startup ----------
function route() {
  const [name, arg] = (location.hash.replace(/^#\/?/, '') || 'dash').split('/');
  const tab = name === 'edit' ? 'history' : name === 'cat' ? 'dash' : name;
  document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
  if (name === 'add') renderForm(null, arg);
  else if (name === 'edit') renderForm(arg);
  else if (name === 'history') renderHistory();
  else if (name === 'cat') renderCat(arg);
  else if (name === 'settings') renderSettings();
  else renderDash();
  window.scrollTo(0, 0);
}

function bindGlobal() {
  document.addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del) { e.stopPropagation(); deleteExpense(del.dataset.del); return; }
    const ed = e.target.closest('[data-edit]');
    if (ed) { location.hash = '#/edit/' + ed.dataset.edit; return; }
    const ec = e.target.closest('[data-editcat]');
    if (ec) { editCategory(ec.dataset.editcat || null); return; }
    const dc = e.target.closest('[data-delcat]');
    if (dc) deleteCategory(dc.dataset.delcat);
  });
  $('#importFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importFile(f); });
  const online = () => { $('#offlinePill').hidden = navigator.onLine; };
  window.addEventListener('online', online);
  window.addEventListener('offline', online);
  online();
  window.addEventListener('hashchange', route);
}

async function start() {
  $('#tripBadge').textContent = tripBadge();
  bindGlobal();
  try {
    await DB.open();
    await load();
    if (!S.seeded) { await DB.write(seedOps()); await load(); }
  } catch (e) {
    console.error(e);
    view().innerHTML = `<div class="banner error"><b>⚠️ Can't open storage on this phone.</b><br>${esc(storageErrText(e))}<br><br>If Safari is in Private Browsing, switch it off. Nothing you enter can be saved until this is fixed.</div>`;
    return;
  }
  route();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker not registered', err));
  }
}

start();
})();
