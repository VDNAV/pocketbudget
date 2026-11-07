// PocketBudget — app controller: navigation, back behaviour, forms, sync status.
import * as db from './db.js';
import * as sync from './sync.js';
import * as V from './views.js';
import { $, $$, icon, esc, toast, showBusy, hideBusy, confirmSheet, Picker, enhanceDate, setDateValue, wireCategories, iso } from './ui.js';

const app = $('#app');
let current = null;           // current view object
let currentKey = '';          // route key, e.g. 'dashboard'
let prevHash = null;          // where we came from (for a clean "back")
let replacing = false;
let dirty = false, submitting = false;
let installEvt = null;

// ---------- routing ----------
function parse(hash) {
  const h = (hash || '#/').replace(/^#/, '') || '/';
  const [path, query = ''] = h.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(query)) };
}
async function resolve({ path, query }) {
  const seg = path.split('/').filter(Boolean);
  switch (seg[0] || '') {
    case '': return ['dashboard', V.dashboard(query)];
    case 'history': return ['transactions', V.transactions(query)];
    case 'quick': return ['quick', V.quick()];
    case 'add': return ['add', V.expenseForm(null)];
    case 'edit': return ['edit', V.expenseForm(decodeURIComponent(seg[1] || ''))];
    case 'income': return ['income', V.income()];
    case 'budgets': return ['budgets', V.budgets(query)];
    case 'scan': return ['scan', await V.scan()];
    case 'review': return ['review', await V.review()];
    case 'settings': return ['settings', await V.settings()];
    default: return ['dashboard', V.notFound()];
  }
}
function lastList() { try { return sessionStorage.getItem('pb_last_list'); } catch (e) { return null; } }

/** Navigate inside the app. replace=true swaps the current page instead of adding a history step. */
function nav(hash, { replace = false, clean = false } = {}) {
  if (clean) { dirty = false; submitting = false; }
  if (location.hash === hash) { render(); return; }
  if (replace) { replacing = true; location.replace(hash); } else location.hash = hash;
}

window.addEventListener('hashchange', e => {
  if (!replacing) { try { prevHash = new URL(e.oldURL).hash || '#/'; } catch (_) { prevHash = null; } }
  replacing = false;
  dirty = false; submitting = false;
  render();
});

async function render({ keepScroll = false } = {}) {
  const route = parse(location.hash);
  let key, view;
  try { [key, view] = await resolve(route); }
  catch (e) { console.error(e); [key, view] = ['dashboard', V.notFound()]; }
  if (view.redirect) { nav(view.redirect, { replace: true }); return; }
  V.revokeURLs();
  current = view; currentKey = key;
  if (key === 'dashboard' || key === 'transactions') { try { sessionStorage.setItem('pb_last_list', location.hash || '#/'); } catch (e) { /* private mode */ } }
  document.body.className = 'page-' + view.page;
  renderTopbar(view);
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav.split(' ').includes(key)));
  const y = window.scrollY;
  app.innerHTML = view.html;
  document.title = key === 'dashboard' ? 'PocketBudget' : `${view.title} · PocketBudget`;
  window.scrollTo(0, keepScroll ? y : 0);
  wire(app, view);
  if (view.mount) await view.mount(app, ctx);
  updateSyncUI(sync.getState());
}

function renderTopbar(view) {
  const inner = $('#topbar-inner');
  if (view.back === null) {
    inner.innerHTML = `<a class="brand top-brand" href="#/"><span class="brand-mark">${icon('wallet', 18)}</span><span>PocketBudget</span></a><h1 class="topbar-title desk-only">${esc(view.title)}</h1><div class="topbar-actions">${view.actions || ''}</div>`;
  } else {
    inner.innerHTML = `<a class="icon-btn back-btn" href="#" data-back aria-label="Go back">${icon('back', 22)}</a><h1 class="topbar-title">${esc(view.title)}</h1><div class="topbar-actions">${view.actions || ''}</div>`;
    $('[data-back]', inner).addEventListener('click', async ev => { ev.preventDefault(); await goBack(); });
  }
}

/** Back = one level up in the app, never "undo my last action". */
async function goBack() {
  if (!(await leaveOk())) return;
  dirty = false;
  let target = current.back === 'list' ? (lastList() || current.backFallback || '#/') : (current.back || '#/');
  if (prevHash && prevHash === target && history.length > 1) history.back();
  else nav(target, { replace: true });
}

async function leaveOk() {
  if (!dirty || submitting) return true;
  return confirmSheet({ title: 'Discard changes?', text: 'You have unsaved changes on this page.', ok: 'Discard' });
}

// links: guard unsaved changes, and swap (not stack) month/filter changes
document.addEventListener('click', async ev => {
  const a = ev.target.closest('a[href^="#"]');
  if (!a || ev.ctrlKey || ev.metaKey || a.hasAttribute('data-back')) return;
  const replace = a.hasAttribute('data-replace');
  if (dirty && !submitting) {
    ev.preventDefault();
    if (await leaveOk()) { dirty = false; nav(a.getAttribute('href'), { replace }); }
    return;
  }
  if (replace) { ev.preventDefault(); nav(a.getAttribute('href'), { replace: true }); }
});

// ---------- per-page behaviour ----------
function wire(root, view) {
  // month picker
  $$('[data-month-pick]', root).forEach(b => b.addEventListener('click', () => Picker.open({ mode: 'month', anchor: b, value: b.dataset.monthPick,
    onPick: m => nav(view.monthHref ? view.monthHref(m) : '#/?month=' + m, { replace: true }) })));
  // dates, categories, quick-date buttons, suggestion pills
  $$('input[type=date]', root).forEach(enhanceDate);
  wireCategories(root);
  $$('[data-date-shift]', root).forEach(b => b.addEventListener('click', () => {
    const inp = document.getElementById(b.dataset.for); if (!inp) return;
    const d = new Date(); d.setDate(d.getDate() + Number(b.dataset.dateShift)); setDateValue(inp, iso(d));
  }));
  $$('[data-fill]', root).forEach(row => $$('.pill', row).forEach(p => p.addEventListener('click', () => {
    const inp = document.getElementById(row.dataset.fill); if (inp) { inp.value = p.textContent.trim(); inp.dispatchEvent(new Event('input', { bubbles: true })); }
  })));
  // photo previews
  $$('input[type=file][data-preview]', root).forEach(inp => inp.addEventListener('change', () => {
    const box = document.getElementById(inp.dataset.preview); if (!box) return;
    box.innerHTML = '';
    [...(inp.files || [])].forEach(f => { if (!f.type.startsWith('image/')) return; const img = document.createElement('img'); img.alt = f.name; img.src = URL.createObjectURL(f); box.appendChild(img); });
    const dz = inp.closest('.dropzone'); if (dz) dz.classList.toggle('has-files', inp.files.length > 0);
    const count = inp.dataset.count && document.getElementById(inp.dataset.count);
    if (count) { const n = inp.files.length; count.textContent = n ? `Read ${n} photo${n > 1 ? 's' : ''}` : 'Read receipts'; }
  }));
  // filter panel
  $$('[data-toggle]', root).forEach(b => b.addEventListener('click', () => { const p = document.getElementById(b.dataset.toggle); if (!p) return; p.hidden = !p.hidden; b.setAttribute('aria-expanded', String(!p.hidden)); }));
  $$('[data-autosubmit]', root).forEach(s => s.addEventListener('change', () => s.form.requestSubmit()));
  // forms
  $$('form', root).forEach(f => {
    if (f.id === 'signin-form') return; // handled by the settings view
    if (f.hasAttribute('data-guard')) { f.addEventListener('input', () => { dirty = true; }); f.addEventListener('change', () => { dirty = true; }); }
    f.addEventListener('submit', async ev => {
      ev.preventDefault();
      if (f.dataset.get === 'history') { // search / filter form: rebuild the link and swap the page
        const p = new URLSearchParams(); for (const [k, v] of new FormData(f)) if (v !== '') p.set(k, v);
        nav('#/history' + (p.toString() ? '?' + p : ''), { replace: true }); return;
      }
      if (submitting || !view.submit) return;
      const missing = $$('input[type=hidden][data-required]', f).find(i => { const c = i.closest('.draft'); return !i.value && !(c && (c.classList.contains('is-skip') || c.classList.contains('is-combine'))); });
      if (missing) { missing._btn.classList.add('invalid'); missing._btn.scrollIntoView({ block: 'center', behavior: 'smooth' }); setTimeout(() => missing._btn.click(), 350); return; }
      submitting = true;
      $$('button:not([type=button])', f).forEach(b => b.classList.add('loading'));
      try { await view.submit(f, nav, ctx); }
      catch (e) { console.error(e); toast(e.message || 'Something went wrong.', 'error'); }
      finally { submitting = false; $$('button.loading', f).forEach(b => b.classList.remove('loading')); hideBusy(); }
    });
  });
}

const ctx = {
  nav, lastList, refresh: () => render({ keepScroll: true }),
  installPrompt: () => !!installEvt,
  install: async () => { if (!installEvt) return; installEvt.prompt(); const r = await installEvt.userChoice; installEvt = null; if (r.outcome === 'accepted') toast('Installed! Open PocketBudget from your home screen.'); render({ keepScroll: true }); },
};

// ---------- sync status in the UI ----------
const LABEL = { idle: 'Synced', syncing: 'Syncing', offline: 'Offline', error: 'Sync issue', 'signed-out': 'Set up sync' };
function updateSyncUI(s) {
  $$('[data-sync-btn]').forEach(b => {
    b.className = 'sync-btn s-' + s.status;
    const ic = s.status === 'offline' ? 'cloud-off' : s.status === 'syncing' ? 'refresh' : s.status === 'idle' ? 'cloud-check' : 'cloud';
    b.innerHTML = `${icon(ic, 18)}<span class="sync-label">${LABEL[s.status] || 'Sync'}</span>${s.pending && s.status !== 'syncing' ? `<em>${s.pending}</em>` : ''}`;
    b.title = s.message || LABEL[s.status] || '';
  });
  $$('[data-sync-dot]').forEach(d => { d.className = 'sync-dot s-' + s.status; });
  $('#offline-bar').hidden = navigator.onLine;
}

// Re-draw read-only screens when another device's changes arrive.
let redrawTimer = null;
db.onChange(() => {
  if (!['dashboard', 'transactions'].includes(currentKey) || dirty) return;
  clearTimeout(redrawTimer); redrawTimer = setTimeout(() => render({ keepScroll: true }), 400);
});

// ---------- start ----------
async function boot() {
  $$('[data-icon]').forEach(el => { const [n, s] = el.dataset.icon.split(':'); el.insertAdjacentHTML('afterbegin', icon(n, Number(s) || 20)); });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (currentKey === 'settings') render({ keepScroll: true }); });
  window.addEventListener('online', () => updateSyncUI(sync.getState()));
  window.addEventListener('offline', () => updateSyncUI(sync.getState()));
  document.addEventListener('focusin', e => { if (e.target.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]),textarea,select')) document.body.classList.add('typing'); });
  document.addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement || !document.activeElement.matches('input,textarea,select')) document.body.classList.remove('typing'); }, 120));
  const tb = $('#topbar'); window.addEventListener('scroll', () => tb.classList.toggle('scrolled', window.scrollY > 4), { passive: true });
  try { await db.init(); }
  catch (e) { app.innerHTML = `<div class="card"><div class="empty"><strong>Storage is blocked</strong><span>This browser is not allowing PocketBudget to save data (private mode?).</span></div></div>`; return; }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  sync.onStatus(updateSyncUI);
  await render();
  sync.start();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
}
boot();
