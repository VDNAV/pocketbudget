// PocketBudget — screens. Each view returns { page, title, back, actions, html, mount }.
import * as db from './db.js';
import * as L from './logic.js';
import * as sync from './sync.js';
import * as ocr from './ocr.js';
import { $, $$, esc, icon, money, catSlug, catAvatar, monthNav, categoryChips, paymentChips, toggle, txRow, friendlyDate,
  groupByDay, itemRow, toast, showBusy, hideBusy, setBusySub, confirmSheet, compressImage, shiftMonth, MONTHS } from './ui.js';

const qs = o => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== '' && v != null) p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };
export const hrefs = {
  home: m => '#/' + qs({ month: m }),
  history: o => '#/history' + qs(o || {}),
  budgets: m => '#/budgets' + qs({ month: m }),
};
const sum = (rows, f = 'amount') => rows.reduce((a, r) => a + Number(r[f] || 0), 0);
const fmt2 = v => (v === null || v === undefined || v === '' ? '' : Number(v).toFixed(2));
const objectURLs = new Set();
export function revokeURLs() { for (const u of objectURLs) URL.revokeObjectURL(u); objectURLs.clear(); }
async function blobURL(id) {
  let b = await db.getBlob(id);
  if (!b && navigator.onLine && (await sync.currentUser())) { try { await sync.downloadReceipt(id); b = await db.getBlob(id); } catch (e) { /* not uploaded yet */ } }
  if (!b) return null;
  const u = URL.createObjectURL(b.blob); objectURLs.add(u); return u;
}
async function fillPhotos(root) {
  for (const ph of $$('[data-photo]', root)) {
    const u = await blobURL(ph.dataset.photo);
    if (u) {
      const big = ph.classList.contains('draft-image');
      ph.outerHTML = `<a class="${big ? 'draft-image' : ''}" href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="Receipt photo" loading="lazy">${big ? `<span>${icon('external', 14)} Full size</span>` : ''}</a>`;
    }
    else ph.textContent = navigator.onLine ? 'Photo is still uploading from your other device' : 'Photo will appear when you are online';
  }
}
function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const syncButton = () => `<a class="sync-btn" href="#/settings" data-sync-btn aria-label="Sync status">${icon('cloud', 18)}<span class="sync-label">Sync</span></a>`;

// =====================================================================
// HOME
// =====================================================================
export function dashboard(q) {
  const month = q.month || L.thisMonth();
  const d = L.dashboard(month);
  const budgetTotal = sum(d.cards, 'budget');
  const categorised = sum(d.cards, 'actual');
  const unc = d.expensesTotal - categorised;
  let hero = '';
  if (budgetTotal) {
    const pct = d.expensesTotal / budgetTotal * 100;
    hero = `<div class="hero-progress ${pct > 100 ? 'over' : pct > 85 ? 'near' : ''}"><i style="width:${Math.min(100, pct)}%"></i></div>
      <span class="hero-sub">${pct > 100 ? esc(money(d.expensesTotal - budgetTotal)) + ' over' : esc(money(budgetTotal - d.expensesTotal)) + ' left'} of ${esc(money(budgetTotal))} budget</span>`;
  } else hero = `<a class="hero-sub link" href="${hrefs.budgets(month)}">Set a monthly budget →</a>`;
  const share = d.expensesTotal > 0 ? `<div class="share-bar" role="img" aria-label="Spending share by category">${d.cards.filter(c => c.actual > 0).map(c => `<i class="cat-${catSlug(c.name)}" style="width:${c.actual / d.expensesTotal * 100}%"></i>`).join('')}${unc > 0.005 ? `<i class="cat-unc" style="width:${unc / d.expensesTotal * 100}%"></i>` : ''}</div>` : '';
  const cats = d.cards.map(c => {
    let detail;
    if (c.budget) {
      const p = c.actual / c.budget * 100;
      detail = `<span class="progress cat-${catSlug(c.name)} ${p > 100 ? 'over' : ''}"><i style="width:${Math.min(100, p)}%"></i></span>
        <small class="${c.remaining < 0 ? 'neg' : ''}">${c.remaining < 0 ? esc(money(-c.remaining)) + ' over budget' : esc(money(c.remaining)) + ' left of ' + esc(money(c.budget))}</small>`;
    } else detail = `<small>${d.expensesTotal > 0 ? Math.round(c.actual / d.expensesTotal * 100) + '% of spending' : 'Nothing yet'} · no budget</small>`;
    return `<a class="cat-row" href="${hrefs.history({ month, category: c.name })}">${catAvatar(c.name, 36)}
      <span class="cat-main"><span class="cat-line"><strong>${esc(c.name)}</strong><b>${esc(money(c.actual))}</b></span>${detail}</span></a>`;
  }).join('') + (unc > 0.005 ? `<a class="cat-row" href="${hrefs.history({ month, category: 'Uncategorised' })}">${catAvatar('Uncategorised', 36)}
      <span class="cat-main"><span class="cat-line"><strong>Not categorised yet</strong><b>${esc(money(unc))}</b></span><small>Give these a category</small></span></a>` : '');
  const recent = d.recent.length ? groupByDay(d.recent).map(g => `<div class="day-head"><span>${esc(friendlyDate(g.day))}</span></div>${g.items.map(x => txRow(x)).join('')}`).join('')
    : `<div class="empty">${icon('receipt', 32)}<strong>No expenses this month</strong><span>Scan a receipt or add one quickly.</span><a class="btn primary small" href="#/quick">${icon('plus', 16)} Add expense</a></div>`;
  const incomes = d.incomes.length ? `<section class="block"><div class="block-head"><h2>Income</h2><a href="#/income">Add</a></div><div class="card tx-list income-list">${d.incomes.map(i => `<div class="tx"><span class="avatar" style="--s:36px;--cat:var(--mint)">${icon('income', 18)}</span><span class="tx-main"><strong>${esc(i.description)}</strong><small>${esc(friendlyDate(i.received_on))}${i.account ? ' · ' + esc(i.account) : ''}</small></span><span class="tx-side"><b>+ ${esc(money(i.amount))}</b></span></div>`).join('')}</div></section>` : '';
  return {
    page: 'dashboard', title: 'Overview', back: null,
    actions: syncButton() + `<a class="icon-btn" href="${hrefs.history({ month })}" aria-label="Search transactions">${icon('search')}</a>`,
    monthHref: hrefs.home,
    html: `<div class="dash"><div class="dash-main">
      ${monthNav(month, hrefs.home)}
      ${!db.list('expense').length && !db.list('income').length ? `<a class="pending-banner" href="#/settings" style="margin-bottom:14px">${icon('sparkle', 22)}<span>Welcome! Sign in to sync, or import the file from your old app.</span>${icon('chev-right', 20)}</a>` : ''}
      <section class="hero-card"><div class="hero-top"><span class="hero-label">Spent this month</span><strong class="hero-amount">${esc(money(d.expensesTotal))}</strong>${hero}</div>
        <div class="hero-stats"><a href="#/income"><span>${icon('income', 16)} Income</span><b>${esc(money(d.incomeTotal))}</b></a>
        <div><span>${icon('wallet', 16)} Balance</span><b class="${d.balance < 0 ? 'neg' : ''}">${esc(money(d.balance))}</b></div></div></section>
      ${d.reviewCount ? `<a class="review-banner" href="${hrefs.history({ month, review: 1 })}"><span class="rb-ico">${icon('alert', 20)}</span><span class="rb-text"><strong>${d.reviewCount} to review</strong><small>${esc(money(d.reviewTotal))} needs a category or check</small></span><span class="rb-go">${icon('chev-right', 20)}</span></a>` : ''}
      <section class="actions-grid">
        <a class="action" href="#/scan"><span class="action-ico a-brand">${icon('camera', 22)}</span><span>Scan</span></a>
        <a class="action" href="#/quick"><span class="action-ico a-amber">${icon('zap', 22)}</span><span>Quick</span></a>
        <a class="action" href="#/add"><span class="action-ico a-blue">${icon('pencil', 22)}</span><span>Full entry</span></a>
        <a class="action" href="#/income"><span class="action-ico a-green">${icon('income', 22)}</span><span>Income</span></a>
      </section></div>
      <section class="block dash-cats"><div class="block-head"><h2>Where it went</h2><a href="${hrefs.budgets(month)}">Budgets</a></div><div class="card">${share}<div class="cat-list">${cats}</div></div></section>
      <section class="block dash-recent"><div class="block-head"><h2>Recent</h2><a href="${hrefs.history({ month })}">See all</a></div><div class="card tx-list">${recent}</div></section>
      ${incomes ? `<div class="dash-incomes">${incomes}</div>` : ''}
    </div>`,
  };
}

// =====================================================================
// HISTORY
// =====================================================================
export function transactions(q) {
  const month = q.month || L.thisMonth();
  const f = { month, category: q.category || '', payment: q.payment || '', review: q.review || '', q: q.q || '' };
  const rows = L.transactions(f);
  const active = (f.category ? 1 : 0) + (f.payment ? 1 : 0) + (f.review === '1' ? 1 : 0);
  const without = k => hrefs.history({ ...f, [k]: '' });
  const groups = groupByDay(rows);
  return {
    page: 'transactions', title: 'History', back: '#/',
    actions: `<button type="button" class="icon-btn" data-export="${esc(month)}" aria-label="Export this month as CSV" title="Export CSV">${icon('download')}</button>`,
    monthHref: m => hrefs.history({ ...f, month: m }),
    html: `${monthNav(month, m => hrefs.history({ ...f, month: m }))}
    <form class="search-form" id="filter-form" data-get="history">
      <input type="hidden" name="month" value="${esc(month)}">
      <div class="search-row">
        <label class="search-box">${icon('search', 18)}<input type="search" name="q" value="${esc(f.q)}" placeholder="Search merchant, item or note" enterkeyhint="search">
          ${f.q ? `<a class="search-clear" href="${without('q')}" data-replace aria-label="Clear search">${icon('x', 16)}</a>` : ''}</label>
        <button type="button" class="icon-btn filter-btn ${active ? 'on' : ''}" data-toggle="filter-panel" aria-expanded="${active ? 'true' : 'false'}" aria-label="Filters">${icon('filter', 18)}${active ? `<em>${active}</em>` : ''}</button>
      </div>
      <div class="filter-panel card" id="filter-panel" ${active ? '' : 'hidden'}>
        <div class="two-col">
          <label class="field"><span>Category</span><select name="category" data-autosubmit><option value="">All categories</option>${L.CATEGORY_NAMES.map(c => `<option value="${esc(c)}" ${c === f.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
          <label class="field"><span>Paid with</span><select name="payment" data-autosubmit><option value="">Any method</option>${L.PAYMENT_METHODS.map(p => `<option value="${esc(p)}" ${p === f.payment ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
        </div>
        ${toggle('review', 'Needs review only', f.review === '1', { value: '1' })}
        <div class="filter-actions">${active || f.q ? `<a class="btn ghost small" href="${hrefs.history({ month })}" data-replace>Clear all</a>` : ''}<button class="btn primary small">Apply</button></div>
      </div>
    </form>
    ${active ? `<div class="active-chips">${f.category ? `<a class="pill" href="${without('category')}" data-replace>${esc(f.category)} ${icon('x', 14)}</a>` : ''}${f.payment ? `<a class="pill" href="${without('payment')}" data-replace>${esc(f.payment)} ${icon('x', 14)}</a>` : ''}${f.review === '1' ? `<a class="pill warn" href="${without('review')}" data-replace>Needs review ${icon('x', 14)}</a>` : ''}</div>` : ''}
    <div class="summary-line"><span>${rows.length} expense${rows.length !== 1 ? 's' : ''}</span><b>${esc(money(sum(rows)))}</b></div>
    <div class="card tx-list">${groups.length ? groups.map(g => `<div class="day-head"><span>${esc(friendlyDate(g.day))}</span><b>${esc(money(sum(g.items)))}</b></div>${g.items.map(x => txRow(x, true)).join('')}`).join('')
      : `<div class="empty">${icon('search', 32)}<strong>Nothing found</strong><span>Try another month or clear the filters.</span>${active || f.q ? `<a class="btn small" href="${hrefs.history({ month })}" data-replace>Clear filters</a>` : ''}</div>`}</div>`,
    mount(root) {
      $('[data-export]')?.addEventListener('click', () => { download(`budget_expenses_${month}.csv`, L.exportCSV(month), 'text/csv'); toast('CSV downloaded.'); });
    },
  };
}

// =====================================================================
// QUICK EXPENSE
// =====================================================================
export function quick() {
  return {
    page: 'quick-expense', title: 'Quick expense', back: '#/',
    actions: `<a class="text-btn" href="#/add">Full form</a>`,
    html: `<form class="form" data-guard id="quick-form">
      <div class="amount-card"><label for="qa-amount">How much?</label>
        <div class="amount-input"><span>Rs</span><input id="qa-amount" autofocus required type="number" min="0" step="0.01" inputmode="decimal" name="amount" placeholder="0.00"></div>
        <small>Only the amount is required. Anything left blank goes to <b>Needs review</b>.</small></div>
      <div class="card form-card">
        <label class="field"><span>Paid to <em>optional</em></span><input name="merchant" placeholder="Winners, Metro Express, a friend…" autocomplete="off"></label>
        <div class="field"><span>Category</span>${categoryChips('category', 'Uncategorised', 'quick-subcategory')}</div>
        <label class="field"><span>Subcategory</span><select name="subcategory" id="quick-subcategory" data-current="Needs review"></select></label>
        <div class="field"><span>Paid with</span>${paymentChips('payment_method', L.PAYMENT_METHODS[0])}</div>
        <label class="field"><span>Date</span><div class="date-row"><input type="date" name="spent_on" value="${L.todayISO()}" id="qa-date"><button type="button" class="pill" data-date-shift="0" data-for="qa-date">Today</button><button type="button" class="pill" data-date-shift="-1" data-for="qa-date">Yesterday</button></div></label>
        <label class="field"><span>Note <em>optional</em></span><input name="notes" placeholder="Anything to help you remember"></label>
      </div>
      <div class="sticky-actions"><button class="btn primary wide lg">${icon('check', 20)} Save expense</button></div>
    </form>`,
    async submit(form, nav) {
      const fd = Object.fromEntries(new FormData(form));
      const { rec, message } = await L.saveQuick(fd);
      toast(message); nav(hrefs.home(rec.spent_on.slice(0, 7)), { replace: true, clean: true });
    },
  };
}

// =====================================================================
// ADD / EDIT EXPENSE
// =====================================================================
export function expenseForm(id) {
  const e = id ? db.getLocal('expense', id) : null;
  if (id && !e) return notFound();
  const items = e ? e.items || [] : [];
  const receipts = e ? e.receipts || [] : [];
  return {
    page: e ? 'edit-expense' : 'add-expense', title: e ? 'Edit expense' : 'Add expense', back: e ? 'list' : '#/',
    backFallback: e ? hrefs.history({ month: e.spent_on.slice(0, 7) }) : '#/',
    actions: e ? `<button type="button" class="icon-btn danger-ghost" data-delete aria-label="Delete expense">${icon('trash')}</button>` : '',
    html: `<form class="form" data-guard id="expense-form">
      ${e && e.review_status === 'needs_review' ? `<div class="notice warn">${icon('alert', 18)}<span><b>Needs review.</b> Check the details and pick a category — saving will mark it as reviewed.</span></div>` : ''}
      <div class="amount-card"><label for="ef-amount">Amount</label>
        <div class="amount-input"><span>Rs</span><input id="ef-amount" required step="0.01" min="0" type="number" name="amount" inputmode="decimal" placeholder="0.00" value="${e ? fmt2(e.amount) : ''}"></div></div>
      <div class="card form-card"><h3 class="card-title">Details</h3>
        <label class="field"><span>Merchant / shop</span><input name="merchant" placeholder="e.g. Winners Manhattan" value="${esc(e ? e.merchant || '' : '')}" autocomplete="off"></label>
        <label class="field"><span>Description</span><input required name="description" placeholder="e.g. Groceries for family" value="${esc(e ? e.description : '')}"></label>
        <label class="field"><span>Date</span><div class="date-row"><input required type="date" name="spent_on" id="ef-date" value="${esc(e ? e.spent_on : L.todayISO())}"><button type="button" class="pill" data-date-shift="0" data-for="ef-date">Today</button><button type="button" class="pill" data-date-shift="-1" data-for="ef-date">Yesterday</button></div></label>
      </div>
      <div class="card form-card"><h3 class="card-title">Category</h3>
        ${categoryChips('category', e ? e.category : 'Uncategorised', 'manual-subcategory')}
        <label class="field"><span>Subcategory</span><select name="subcategory" id="manual-subcategory" data-current="${esc(e ? e.subcategory || '' : 'Needs review')}"></select></label>
        <div class="field"><span>Paid with</span>${paymentChips('payment_method', e ? e.payment_method : null)}</div>
        <label class="field"><span>Journey / route <em>optional</em></span><input name="journey" value="${esc(e ? e.journey || '' : '')}" placeholder="Curepipe Central → Trianon"></label>
      </div>
      <div class="card form-card"><h3 class="card-title">Receipt</h3>
        ${receipts.length ? `<div class="receipt-gallery">${receipts.map(r => `<span class="photo-ph" data-photo="${esc(r.id)}">Loading photo…</span>`).join('')}</div>` : ''}
        <label class="upload-tile"><input type="file" name="receipt" accept="image/*" capture="environment" data-preview="ef-preview">${icon('camera', 22)}<span><b>${receipts.length ? 'Add another photo' : 'Attach a receipt photo'}</b><small>Optional · camera or gallery</small></span></label>
        <div class="thumbs" id="ef-preview"></div>
        <details class="items-details" ${items.length ? 'open' : ''}><summary>${icon('receipt', 18)} Line items <span class="count">${items.length || ''}</span>${icon('chev-down', 18, 'chev')}</summary>
          <div id="items" class="item-rows"></div><button type="button" class="btn ghost small" data-add-item>${icon('plus', 16)} Add item</button></details>
      </div>
      <div class="card form-card"><h3 class="card-title">More</h3>
        <label class="field"><span>Notes</span><textarea name="notes" rows="3" placeholder="Anything worth remembering">${esc(e ? e.notes || '' : '')}</textarea></label>
        ${toggle('grouped_receipt', 'Keep as one grouped expense', !e || !!e.grouped_receipt, { hint: 'Line items stay inside a single purchase' })}
        ${toggle('needs_review', 'Keep in Needs review', !!(e && e.review_status === 'needs_review' && e.category === 'Uncategorised'), { id: 'manual-needs-review', hint: 'Turn on if you want to come back to it' })}
      </div>
      <div class="sticky-actions"><button class="btn primary wide lg">${icon('check', 20)} Save expense</button></div>
    </form>`,
    mount(root, ctx) {
      const holder = $('#items', root);
      for (const it of items) holder.appendChild(itemRow('item_name[]', 'item_total[]', it.name, it.total));
      $('[data-add-item]', root).addEventListener('click', () => { const r = itemRow('item_name[]', 'item_total[]'); holder.appendChild(r); r.querySelector('input').focus(); });
      fillPhotos(root);
      $('[data-delete]')?.addEventListener('click', async () => {
        const ok = await confirmSheet({ title: 'Delete this expense?', text: `This expense${receipts.length ? ` and its ${receipts.length} receipt photo${receipts.length !== 1 ? 's' : ''}` : ''} will be deleted on all your devices.`, ok: 'Delete' });
        if (!ok) return;
        const r = await L.deleteExpense(id); toast(r.message); ctx.nav(ctx.lastList() || hrefs.home(r.month), { replace: true, clean: true });
      });
    },
    async submit(form, nav, ctx) {
      const fd = new FormData(form);
      const data = Object.fromEntries([...fd.entries()].filter(([k]) => !k.endsWith('[]') && k !== 'receipt'));
      data.items = fd.getAll('item_name[]').map((n, i) => ({ name: n, total: fd.getAll('item_total[]')[i] }));
      data.grouped_receipt = fd.has('grouped_receipt'); data.needs_review = fd.has('needs_review');
      const file = fd.get('receipt');
      const photo = file && file.size ? await compressImage(file) : null;
      const { rec, message } = await L.saveExpenseForm(id, data, photo);
      toast(message); nav(e ? (ctx.lastList() || hrefs.home(rec.spent_on.slice(0, 7))) : hrefs.home(rec.spent_on.slice(0, 7)), { replace: true, clean: true });
    },
  };
}

// =====================================================================
// INCOME
// =====================================================================
export function income() {
  return {
    page: 'add-income', title: 'Add income', back: '#/',
    html: `<form class="form" data-guard id="income-form">
      <div class="amount-card income"><label for="in-amount">Money received</label>
        <div class="amount-input"><span>Rs</span><input id="in-amount" autofocus required type="number" name="amount" step="0.01" min="0" inputmode="decimal" placeholder="0.00"></div></div>
      <div class="card form-card">
        <label class="field"><span>What is it?</span><input required name="description" id="in-desc" placeholder="Salary, refund, cash added…"></label>
        <div class="chip-row suggest" data-fill="in-desc">${['Salary', 'From family', 'Refund', 'Cash added', 'Gift'].map(s => `<button type="button" class="pill">${s}</button>`).join('')}</div>
        <label class="field"><span>Date</span><div class="date-row"><input required type="date" name="received_on" id="in-date" value="${L.todayISO()}"><button type="button" class="pill" data-date-shift="0" data-for="in-date">Today</button><button type="button" class="pill" data-date-shift="-1" data-for="in-date">Yesterday</button></div></label>
        <label class="field"><span>Account / where it went <em>optional</em></span><input name="account" placeholder="Bank account, purse…"></label>
        <label class="field"><span>Notes <em>optional</em></span><textarea name="notes" rows="2"></textarea></label>
      </div>
      <div class="sticky-actions"><button class="btn primary wide lg">${icon('check', 20)} Save income</button></div>
    </form>`,
    async submit(form, nav) {
      const r = await L.saveIncome(Object.fromEntries(new FormData(form)));
      toast(r.message); nav(hrefs.home(r.month), { replace: true, clean: true });
    },
  };
}

// =====================================================================
// BUDGETS
// =====================================================================
export function budgets(q) {
  const month = q.month || L.thisMonth();
  const existing = L.budgetsFor(month);
  return {
    page: 'budgets', title: 'Budgets', back: '#/',
    monthHref: hrefs.budgets,
    html: `${monthNav(month, hrefs.budgets)}
    <form class="form" data-guard id="budget-form">
      <div class="budget-total card"><span>Total monthly budget</span><strong id="budget-sum">Rs 0.00</strong>
        <button type="button" class="btn ghost small" id="copy-prev">${icon('copy', 16)} Copy last month</button></div>
      <div class="card budget-list">${L.BUDGET_CATEGORIES.map(cat => `<label class="budget-row">${catAvatar(cat, 40)}<span class="budget-name"><strong>${esc(cat)}</strong><small>Monthly limit</small></span>
        <span class="budget-input"><em>Rs</em><input type="number" min="0" step="0.01" inputmode="decimal" name="budget_${esc(cat)}" value="${existing[cat] != null ? fmt2(existing[cat]) : ''}" placeholder="0"></span></label>`).join('')}</div>
      <p class="hint">Leave a field empty to keep it unchanged. Budgets are saved per month.</p>
      <div class="sticky-actions"><button class="btn primary wide lg">${icon('check', 20)} Save budgets</button></div>
    </form>`,
    mount(root) {
      const inputs = $$('input[name^="budget_"]', root);
      const update = () => { $('#budget-sum').textContent = money(inputs.reduce((a, i) => a + (parseFloat(i.value) || 0), 0)); };
      inputs.forEach(i => i.addEventListener('input', update)); update();
      $('#copy-prev', root).addEventListener('click', () => {
        const prev = shiftMonth(month, -1), pb = L.budgetsFor(prev); let n = 0;
        for (const i of inputs) { const cat = i.name.slice(7); if (pb[cat] != null) { i.value = fmt2(pb[cat]); n++; } }
        update(); if (n) root.querySelector('form').dispatchEvent(new Event('input', { bubbles: true }));
        $('#copy-prev', root).textContent = n ? `Copied from ${MONTHS[Number(prev.slice(5)) - 1].slice(0, 3)} ✓` : 'Last month had no budgets';
      });
    },
    async submit(form, nav) {
      const vals = {}; for (const cat of L.BUDGET_CATEGORIES) vals[cat] = form.elements[`budget_${cat}`].value;
      toast(await L.saveBudgets(month, vals)); nav(hrefs.budgets(month), { replace: true, clean: true });
    },
  };
}

// =====================================================================
// SCAN
// =====================================================================
export async function scan() {
  const waiting = (await db.getDrafts()).length;
  return {
    page: 'receipt-scan', title: 'Scan receipts', back: '#/',
    html: `${waiting ? `<div class="pending-banner">${icon('receipt', 22)}<span>${waiting} receipt${waiting > 1 ? 's are' : ' is'} waiting for review</span><a class="btn small" href="#/review">Continue</a></div>` : ''}
    <form class="form" id="scan-form">
      <label class="dropzone" id="dropzone"><input required type="file" name="receipts" accept="image/*" capture="environment" multiple data-preview="scan-preview" data-count="scan-count">
        <span class="dz-ico">${icon('camera', 34)}</span><strong>Take a photo or choose receipts</strong><small>One receipt per photo · you can pick several photos</small></label>
      <div class="thumbs big" id="scan-preview"></div>
      <details class="card tips"><summary>${icon('sparkle', 18)} Tips for a good scan ${icon('chev-down', 18, 'chev')}</summary><ul>
        <li>Keep the <b>whole receipt</b> in view, upright, with a little table showing on all four sides.</li>
        <li>Hold the phone flat above the paper, avoid shadows and glare, and flatten folds.</li>
        <li>Have an itemised receipt <b>and</b> a card slip? Take them as separate photos — the review screen merges them so nothing is counted twice.</li>
        <li>Reading happens on this device, so it works offline. It takes a few seconds per photo.</li></ul></details>
      <div class="sticky-actions"><button class="btn primary wide lg" id="scan-submit">${icon('sparkle', 20)} <span id="scan-count">Read receipts</span></button></div>
    </form>`,
    async submit(form, nav) {
      const files = [...form.elements.receipts.files].filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
      if (!files.length) { toast('Take or choose at least one receipt photo first.', 'error'); return; }
      showBusy('Reading your receipts…', 'Starting the reader');
      const drafts = [];
      try {
        for (let i = 0; i < files.length; i++) {
          const label = files.length > 1 ? `Receipt ${i + 1} of ${files.length}` : 'Reading receipt';
          setBusySub(label + '…');
          const small = await compressImage(files[i]);
          const blobId = db.newId();
          await db.putBlob(blobId, small);
          const parsed = await ocr.readReceipt(files[i], m => setBusySub(`${label} · ${m.status === 'recognizing text' ? Math.round(m.progress * 100) + '%' : 'preparing'}`));
          drafts.push({ ...parsed, blob_id: blobId, file_name: files[i].name, receipt_filename: blobId, source_filename: blobId });
        }
      } finally { hideBusy(); }
      L.prepareDrafts(drafts);
      const existing = await db.getDrafts();
      // New photos join any receipts still waiting for review; shift their "attach to" links.
      for (const d of drafts) if (d.combine_into !== '') d.combine_into = String(Number(d.combine_into) + existing.length);
      await db.setDrafts([...existing, ...drafts].map(({ order, ...d }) => d));
      nav('#/review', { clean: true });
    },
  };
}

// =====================================================================
// REVIEW SCANNED RECEIPTS
// =====================================================================
export async function review() {
  const drafts = await db.getDrafts();
  if (!drafts.length) return { redirect: '#/scan' };
  const card = (d, i) => `<article class="card draft ${d.action === 'combine' ? 'is-combine' : d.action === 'skip' ? 'is-skip' : ''}" data-draft="${i}">
    <header class="draft-head"><span class="draft-num">${i + 1}</span>
      <span class="draft-title"><strong>${esc(d.merchant || 'Unknown merchant')}</strong><small>${d.total != null ? esc(money(d.total)) : 'Amount not read'}${d.spent_on ? ' · ' + esc(friendlyDate(d.spent_on)) : ''}</small></span>
      <span class="confidence ${d.confidence >= 0.8 ? 'good' : d.confidence >= 0.55 ? 'medium' : 'low'}">${Math.round((d.confidence || 0) * 100)}%</span></header>
    <span class="draft-image photo-ph" data-photo="${esc(d.blob_id)}">Loading photo…</span>
    ${d.amount_needs_confirmation ? `<div class="notice warn">${icon('pencil', 18)}<span><b>Type the amount yourself.</b> ${d.handwritten_amount_suspected ? 'A total label was found but the number wasn’t readable — often handwriting.' : 'No reliable total could be read.'} PocketBudget won’t guess it.</span></div>` : ''}
    ${d.ocr_error ? `<div class="notice danger">${icon('alert', 18)}<span><b>Couldn’t read this photo.</b> ${esc(d.ocr_error)} You can still type the details below.</span></div>` : ''}
    ${d.existing_duplicate ? `<div class="notice dup">${icon('layers', 18)}<span><b>Looks already saved:</b> ${esc(d.existing_duplicate.spent_on)} · ${esc(d.existing_duplicate.merchant || d.existing_duplicate.description)} · ${esc(money(d.existing_duplicate.amount))}. Set to <b>Skip</b> — change it only if this is a different purchase.</span></div>`
      : d.duplicate_reason ? `<div class="notice dup">${icon('layers', 18)}<span><b>Possible duplicate slip.</b> ${esc(d.duplicate_reason)} It will be attached to another receipt instead of counted twice.</span></div>` : ''}
    <div class="segmented three action-seg">
      ${[['save', 'check', 'Save'], ['combine', 'layers', 'Attach'], ['skip', 'x', 'Skip']].map(([v, ic, l]) => `<label><input type="radio" class="action-radio" name="action_${i}" value="${v}" ${(d.action || 'save') === v ? 'checked' : ''}><span>${icon(ic, 16)}${l}</span></label>`).join('')}
    </div>
    <label class="field combine-target"><span>Attach this photo to</span><select name="combine_into_${i}"><option value="">Choose receipt</option>
      ${drafts.map((o, j) => j === i ? '' : `<option value="${j}" ${String(d.combine_into) === String(j) ? 'selected' : ''}>Receipt ${j + 1} — ${esc(o.merchant || 'Unknown')}${o.total != null ? ` (${esc(money(o.total))})` : ''}</option>`).join('')}</select></label>
    <div class="draft-fields">
      <div class="two-col">
        <label class="field"><span>Amount (Rs)</span><input required type="number" min="0" step="0.01" inputmode="decimal" name="amount_${i}" value="${fmt2(d.amount ?? d.total)}" ${d.amount_needs_confirmation ? 'class="needs-confirmation" placeholder="Type amount"' : ''}></label>
        <label class="field"><span>Date</span><input required type="date" name="spent_on_${i}" value="${esc(d.spent_on || '')}" ${!d.spent_on ? 'class="needs-confirmation"' : ''}>${!d.spent_on ? '<small class="warn-text">Date not read — please check</small>' : ''}</label>
      </div>
      <label class="field"><span>Merchant</span><input name="merchant_${i}" value="${esc(d.merchant || '')}" placeholder="Merchant / provider"></label>
      <label class="field"><span>Description</span><input name="description_${i}" value="${esc(d.description ?? (d.journey ? `${d.merchant} — ${d.journey}` : (d.merchant || 'Receipt purchase')))}"></label>
      ${d.journey ? `<label class="field"><span>Journey / route</span><input name="journey_${i}" value="${esc(d.journey)}"></label>` : `<input type="hidden" name="journey_${i}" value="">`}
      <div class="two-col">
        <label class="field"><span>Category</span><select name="category_${i}" class="category-select" data-target="sub_${i}">${L.CATEGORY_NAMES.map(c => `<option ${c === d.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label class="field"><span>Subcategory</span><select name="subcategory_${i}" id="sub_${i}" data-current="${esc(d.subcategory || '')}"></select></label>
      </div>
      <label class="field"><span>Paid with</span><select name="payment_method_${i}">${L.PAYMENT_METHODS.map(p => `<option ${p === d.payment_method ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
      <details class="items-details" ${(d.items || []).length ? '' : 'hidden'}><summary>${icon('receipt', 18)} Line items <span class="count">${(d.items || []).length}</span>${icon('chev-down', 18, 'chev')}</summary>
        <div class="item-rows" id="items-${i}"></div><button type="button" class="btn ghost small" data-add-batch-item="${i}">+ Add item</button></details>
      <div class="toggles">
        ${toggle('grouped_' + i, 'Keep as one grouped expense', d.grouped ?? true, { value: '1' })}
        ${toggle('remember_' + i, 'Remember this merchant’s category', d.remember ?? d.category !== 'Uncategorised', { value: '1' })}
        ${toggle('needs_review_' + i, 'Keep in Needs review', d.needs_review, { value: '1' })}
      </div>
    </div>
    <details class="ocr-text"><summary>Show text read from the photo</summary><pre>${esc(d.raw_text || '')}</pre></details>
  </article>`;
  return {
    page: 'receipt-scan', title: `Review ${drafts.length} receipt${drafts.length !== 1 ? 's' : ''}`, back: '#/scan',
    html: `<div class="notice info">${icon('alert', 18)}<span>Nothing is saved until you tap <b>Save</b> at the bottom. Check the amount and date on each receipt. Your progress here is kept if you leave.</span></div>
    <form id="batch-form" class="form"><div class="draft-stack">${drafts.map(card).join('')}</div>
      <div class="sticky-actions split"><button type="button" class="btn" data-start-over>Start over</button><button class="btn primary lg" id="batch-save">${icon('check', 20)} <span>Save</span></button></div></form>`,
    mount(root, ctx) {
      drafts.forEach((d, i) => { const h = $(`#items-${i}`, root); for (const it of d.items || []) h.appendChild(itemRow(`item_name_${i}[]`, `item_total_${i}[]`, it.name, it.total)); });
      $$('[data-add-batch-item]', root).forEach(b => b.addEventListener('click', () => { const i = b.dataset.addBatchItem; const r = itemRow(`item_name_${i}[]`, `item_total_${i}[]`); $(`#items-${i}`, root).appendChild(r); r.querySelector('input').focus(); }));
      const refresh = card => {
        const v = (card.querySelector('.action-radio:checked') || {}).value || 'save';
        card.classList.toggle('is-combine', v === 'combine'); card.classList.toggle('is-skip', v === 'skip');
        card.querySelector('.combine-target').style.display = v === 'combine' ? '' : 'none';
        $$('.draft-fields [required], .draft-fields [data-was-required]', card).forEach(inp => {
          if (v === 'save') { if (inp.dataset.wasRequired) { inp.required = true; delete inp.dataset.wasRequired; } }
          else if (inp.required) { inp.dataset.wasRequired = '1'; inp.required = false; }
        });
        card.querySelector('.combine-target select').required = v === 'combine';
      };
      const refreshBtn = () => {
        let s = 0, c = 0, k = 0;
        $$('.draft', root).forEach(cd => { const v = (cd.querySelector('.action-radio:checked') || {}).value || 'save'; if (v === 'save') s++; else if (v === 'combine') c++; else k++; });
        const parts = []; if (s) parts.push(`Save ${s}`); if (c) parts.push(`attach ${c}`); if (k && !s && !c) parts.push('Skip all');
        $('#batch-save span', root).textContent = parts.join(' · ') || 'Save';
      };
      $$('.draft', root).forEach(cd => { refresh(cd); $$('.action-radio', cd).forEach(r => r.addEventListener('change', () => { refresh(cd); refreshBtn(); })); });
      refreshBtn();
      fillPhotos(root);
      // keep edits in the drafts so leaving the page loses nothing
      let t = null;
      const formEl = root.querySelector('form');
      formEl.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => { if (!formEl.isConnected) return; db.setDrafts(collect(formEl, drafts).map((r, i) => ({ ...drafts[i], ...r, total: drafts[i].total }))); }, 600);
      });
      root.querySelector('form').addEventListener('change', () => root.querySelector('form').dispatchEvent(new Event('input')));
      $('[data-start-over]', root).addEventListener('click', async () => {
        if (!(await confirmSheet({ title: 'Discard these receipts?', text: 'The photos and anything you typed on this screen will be removed.', ok: 'Discard' }))) return;
        for (const d of drafts) if (d.blob_id) await db.deleteBlob(d.blob_id);
        await db.clearDrafts(); ctx.nav('#/scan', { replace: true, clean: true });
      });
    },
    async submit(form, nav) {
      const rows = collect(form, drafts);
      const r = await L.saveBatch(rows);
      await db.clearDrafts();
      toast(r.message, r.ok ? 'success' : 'error');
      nav(r.ok ? hrefs.home(r.month) : hrefs.history({}), { replace: true, clean: true });
    },
  };
}
function collect(root, drafts) {
  const form = root.tagName === 'FORM' ? root : root.querySelector('form');
  const fd = new FormData(form);
  return drafts.map((d, i) => {
    const names = fd.getAll(`item_name_${i}[]`), totals = fd.getAll(`item_total_${i}[]`);
    const items = names.map((n, j) => ({ name: n.trim(), total: totals[j] })).filter(it => it.name && String(it.total).trim() !== '' && isFinite(parseFloat(it.total))).map(it => ({ name: it.name, total: parseFloat(it.total) }));
    const amt = parseFloat(fd.get(`amount_${i}`));
    return {
      index: i, action: fd.get(`action_${i}`) || 'save', combine_into: fd.get(`combine_into_${i}`) || '',
      spent_on: fd.get(`spent_on_${i}`) || L.todayISO(), merchant: (fd.get(`merchant_${i}`) || '').trim(), description: (fd.get(`description_${i}`) || '').trim(),
      amount: isFinite(amt) ? amt : 0, category: fd.get(`category_${i}`) || 'Uncategorised', subcategory: fd.get(`subcategory_${i}`) || 'Needs review',
      payment_method: fd.get(`payment_method_${i}`) || 'Other', journey: (fd.get(`journey_${i}`) || '').trim(), receipt_type: d.receipt_type || 'receipt',
      blob_id: d.blob_id, file_name: d.file_name, items, grouped: fd.get(`grouped_${i}`) === '1', remember: fd.get(`remember_${i}`) === '1',
      needs_review: fd.get(`needs_review_${i}`) === '1', confidence: Number(d.confidence || 0),
      ocr_amount_missing: d.total == null, ocr_merchant_missing: !d.merchant, ocr_date_missing: !d.spent_on,
    };
  });
}

// =====================================================================
// SETTINGS (sync, backup, offline reader)
// =====================================================================
export async function settings() {
  const cfg = await sync.getConfig();
  const user = await sync.currentUser();
  const st = sync.getState();
  const c = db.counts();
  const blobCount = (await db.allBlobIds()).length;
  const ocrReady = await db.getMeta('ocrReady', false);
  const lastSync = st.lastSync ? new Date(st.lastSync).toLocaleString() : 'never';
  const statusText = { idle: 'Up to date', syncing: 'Syncing…', offline: 'Offline — will sync when connected', error: 'Last sync failed', 'signed-out': 'Not signed in' }[st.status] || st.status;
  return {
    page: 'settings', title: 'Sync & settings', back: '#/',
    html: `<div class="settings-stack">
    <section class="card form-card">
      <div class="set-head"><span class="avatar" style="--s:44px;--cat:var(--sky)">${icon('cloud', 22)}</span><div><h2>Sync</h2><p>Keeps your phone and laptop in step whenever they’re online.</p></div></div>
      ${user ? `<div class="status-row"><span>${esc(statusText)}<small>Signed in as ${esc(user.email)} · last synced ${esc(lastSync)}${st.pending ? ` · ${st.pending} change${st.pending > 1 ? 's' : ''} waiting` : ''}</small>${st.status === 'error' && st.message ? `<small>${esc(st.message)}</small>` : ''}</span></div>
        <div class="btn-row"><button type="button" class="btn primary" data-sync-now>${icon('refresh', 18)} Sync now</button><button type="button" class="btn" data-sign-out>${icon('logout', 18)} Sign out</button></div>`
      : `<form class="form-card" id="signin-form" style="display:flex;flex-direction:column;gap:12px">
        <details ${cfg && cfg.url ? '' : 'open'}><summary class="hint" style="margin:0;cursor:pointer">Server details (already filled in)</summary><div style="display:flex;flex-direction:column;gap:12px;margin-top:10px">
        <label class="field"><span>Supabase Project URL</span><input name="url" required placeholder="https://xxxx.supabase.co" value="${esc(cfg ? cfg.url : '')}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
        <label class="field"><span>Anon / publishable key</span><input name="key" required placeholder="eyJ… or sb_publishable_…" value="${esc(cfg ? cfg.key : '')}" autocomplete="off" autocapitalize="off" spellcheck="false"></label></div></details>
        <label class="field"><span>Email</span><input name="email" type="email" required autocomplete="username"></label>
        <label class="field"><span>Password</span><input name="password" type="password" required autocomplete="current-password"></label>
        <button class="btn primary">${icon('lock', 18)} Sign in &amp; sync</button>
        <p class="hint" style="margin:0">Use the same email and password on your phone and laptop. Your data stays on this device too, so the app keeps working offline.</p>
      </form>`}
    </section>
    <section class="card form-card">
      <div class="set-head"><span class="avatar" style="--s:44px;--cat:var(--yellow)">${icon('phone', 22)}</span><div><h2>On this device</h2><p>Everything below is stored on this ${matchMedia('(min-width:960px)').matches ? 'computer' : 'phone'} and works offline.</p></div></div>
      <div class="kv"><div><b>${c.expense}</b><span>Expenses</span></div><div><b>${c.income}</b><span>Income</span></div><div><b>${c.budget}</b><span>Budgets</span></div><div><b>${blobCount}</b><span>Photos</span></div></div>
      <div class="btn-row">
        <button type="button" class="btn" data-backup>${icon('download', 18)} Download backup</button>
        <label class="btn file-btn">${icon('upload', 18)} Restore / import backup<input type="file" accept=".json,application/json" data-restore></label>
      </div>
      <p class="hint" style="margin:0">A backup is one file with all your expenses, budgets, income and receipt photos. “Import” also brings in the file made from your old laptop app.</p>
    </section>
    <section class="card form-card">
      <div class="set-head"><span class="avatar" style="--s:44px;--cat:var(--lilac)">${icon('sparkle', 22)}</span><div><h2>Offline receipt reading</h2><p>${ocrReady ? 'Ready — receipts can be read with no internet.' : 'Downloads the reader once (about 10&nbsp;MB) so scanning works offline.'}</p></div></div>
      <div class="btn-row"><button type="button" class="btn ${ocrReady ? '' : 'primary'}" data-ocr-prepare>${icon('sparkle', 18)} ${ocrReady ? 'Check again' : 'Prepare for offline'}</button><span class="progress-line" hidden><i></i></span></div>
    </section>
    <section class="card form-card" id="install-card" hidden>
      <div class="set-head"><span class="avatar" style="--s:44px;--cat:var(--pink)">${icon('download', 22)}</span><div><h2>Install the app</h2><p>Adds PocketBudget to your home screen / Start menu. It opens full screen with no browser bar.</p></div></div>
      <div class="btn-row"><button type="button" class="btn primary" data-install>${icon('phone', 18)} Install PocketBudget</button></div>
    </section>
    </div>`,
    async mount(root, ctx) {
      const f = $('#signin-form', root);
      if (f) f.addEventListener('submit', async ev => {
        ev.preventDefault(); const v = Object.fromEntries(new FormData(f));
        showBusy('Signing in…');
        try { await sync.setConfig(v.url, v.key); await sync.signIn(v.email, v.password); setBusySub('Syncing your data…'); await sync.syncNow(); hideBusy(); toast('Signed in. Sync is on.'); ctx.refresh(); }
        catch (e) { hideBusy(); toast(e.message, 'error'); }
      });
      $('[data-sync-now]', root)?.addEventListener('click', async () => { showBusy('Syncing…'); await sync.syncNow(); hideBusy(); const s = sync.getState(); toast(s.status === 'idle' ? 'All synced.' : (s.message || 'Could not sync right now.'), s.status === 'idle' ? 'success' : 'error'); ctx.refresh(); });
      $('[data-sign-out]', root)?.addEventListener('click', async () => {
        if (!(await confirmSheet({ title: 'Sign out?', text: 'Your data stays on this device. Changes made while signed out will sync after you sign in again.', ok: 'Sign out', danger: false }))) return;
        await sync.signOut(); ctx.refresh();
      });
      $('[data-backup]', root).addEventListener('click', async () => { showBusy('Preparing backup…'); try { const b = await makeBackup(); download(`pocketbudget-backup-${L.todayISO()}.json`, b, 'application/json'); toast('Backup downloaded.'); } finally { hideBusy(); } });
      $('[data-restore]', root).addEventListener('change', async ev => {
        const file = ev.target.files[0]; if (!file) return;
        showBusy('Importing…', file.name);
        try { const r = await restoreBackup(await file.text(), setBusySub); hideBusy(); toast(r); ctx.refresh(); sync.scheduleSoon(500); }
        catch (e) { hideBusy(); toast(e.message, 'error'); }
      });
      $('[data-ocr-prepare]', root).addEventListener('click', async () => {
        const bar = $('.progress-line', root); bar.hidden = false;
        try { await ocr.prepare(m => { bar.querySelector('i').style.width = Math.round((m.progress || 0) * 100) + '%'; }); await db.setMeta('ocrReady', true); toast('Receipt reader is ready for offline use.'); ctx.refresh(); }
        catch (e) { toast(e.message || 'Could not download the reader.', 'error'); bar.hidden = true; }
      });
      if (ctx.installPrompt()) { $('#install-card', root).hidden = false; $('[data-install]', root).addEventListener('click', () => ctx.install()); }
    },
  };
}

// ---------- backup format ----------
async function blobToB64(blob) { const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s); }
function b64ToBlob(b64, type) { const bin = atob(b64); const buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i); return new Blob([buf], { type: type || 'image/jpeg' }); }
async function makeBackup() {
  const records = {}; for (const k of db.KINDS) records[k] = db.list(k).map(({ dirty, ...r }) => r);
  const blobs = [];
  for (const id of await db.allBlobIds()) { const b = await db.getBlob(id); if (b) blobs.push({ id, type: b.type, data: await blobToB64(b.blob) }); }
  return new Blob([JSON.stringify({ format: 'pocketbudget-backup', version: 1, exported_at: new Date().toISOString(), records, blobs })], { type: 'application/json' });
}
export async function restoreBackup(text, progress = () => {}) {
  let data; try { data = JSON.parse(text); } catch (e) { throw new Error('That file is not a PocketBudget backup.'); }
  if (!data || data.format !== 'pocketbudget-backup' || !data.records) throw new Error('That file is not a PocketBudget backup.');
  let added = 0, kept = 0;
  for (const kind of db.KINDS) {
    const incoming = data.records[kind] || [];
    const take = [];
    for (const r of incoming) {
      const local = db.getAny(kind, r.id);
      if (local && local.updated_at && r.updated_at && local.updated_at >= r.updated_at) { kept++; continue; }
      take.push({ ...r, dirty: 1 });
    }
    if (take.length) { await db.saveMany(kind, take, { keepStamp: true }); added += take.length; }
    progress(`${kind}: ${take.length} added`);
  }
  let photos = 0;
  for (const b of data.blobs || []) { if (!(await db.hasBlob(b.id))) { await db.putBlob(b.id, b64ToBlob(b.data, b.type)); photos++; } }
  return `Imported ${added} record${added !== 1 ? 's' : ''} and ${photos} photo${photos !== 1 ? 's' : ''}.` + (kept ? ` ${kept} already up to date.` : '');
}

export function notFound() {
  return { page: 'transactions', title: 'Not found', back: '#/', html: `<div class="card"><div class="empty">${icon('search', 32)}<strong>That item isn’t here</strong><span>It may have been deleted on another device.</span><a class="btn small" href="#/history">Go to History</a></div></div>` };
}
