// PocketBudget — business rules (ported 1:1 from the old app.py).
import * as db from './db.js';

export const CATEGORIES = {
  Mandatory: ['Family contribution', 'Loan / Device', 'Subscription', 'Insurance', 'Data / Mobile', 'Medical', 'Other'],
  Food: ['Groceries', 'Eating out', 'Snacks / Bakery', 'Personal', 'Family', 'Friends', 'Other'],
  Transport: ['Bus', 'Metro', 'Fuel', 'Taxi / Ride', 'Rented car', 'Parking', 'Other'],
  Health: ['Pharmacy', 'Doctor / Clinic', 'Tests', 'Personal care', 'Other'],
  Miscellaneous: ['Shopping', 'Entertainment', 'Gifts', 'Personal', 'Family', 'Friends', 'Other'],
  Uncategorised: ['Needs review'],
};
export const CATEGORY_NAMES = Object.keys(CATEGORIES);
export const BUDGET_CATEGORIES = CATEGORY_NAMES.filter(c => c !== 'Uncategorised');
export const PAYMENT_METHODS = ['Cash', 'Card', 'SBM TAG', 'MCB Juice', 'Bank transfer', 'E-banking / Top-up', 'Other'];

const STATIC_MERCHANT_RULES = [
  [['le warehouse', 'warehouse ltd'], 'Miscellaneous', 'Shopping'],
  [['winners', 'shoprite', 'intermart', 'super u', 'jumbo'], 'Food', 'Groceries'],
  [['la maison du gourmet', 'bakery', 'patisserie', 'pâtisserie'], 'Food', 'Snacks / Bakery'],
  [['la fiamma', 'restaurant', 'pizza', 'cafe', 'café'], 'Food', 'Eating out'],
  [['innopharma', 'pharmacy', 'pharmacie'], 'Health', 'Pharmacy'],
  [['metro express'], 'Transport', 'Metro'],
  [['royal swazi', 'ntc', 'ubs', 'bus'], 'Transport', 'Bus'],
  [['shell', 'engen', 'totalenergies', 'total energies', 'esso'], 'Transport', 'Fuel'],
];

export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const thisMonth = () => todayISO().slice(0, 7);
export const money = v => 'Rs ' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

export function normalizeMerchant(value) {
  value = (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const noise = new Set(['ltd', 'limited', 'co', 'company', 'pick', 'buy', 'plc', 'store']);
  return value.split(/\s+/).filter(x => x && !noise.has(x)).join(' ').trim();
}
export function merchantSimilarity(a, b) {
  a = normalizeMerchant(a); b = normalizeMerchant(b);
  if (!a || !b) return 0;
  if (a === b || a.includes(b) || b.includes(a)) return 1;
  const sa = new Set(a.split(' ')), sb = new Set(b.split(' '));
  const inter = [...sa].filter(x => sb.has(x)).length;
  const uni = new Set([...sa, ...sb]).size;
  return inter / Math.max(uni, 1);
}

export function categorySuggestion(merchant, rawText = '') {
  const key = normalizeMerchant(merchant);
  if (key) {
    const rule = db.getLocal('rule', key);
    if (rule) return [rule.category, rule.subcategory || 'Other', rule.preferred_payment || ''];
  }
  const hay = `${merchant} ${rawText}`.toLowerCase();
  for (const [needles, cat, sub] of STATIC_MERCHANT_RULES) if (needles.some(n => hay.includes(n))) return [cat, sub, ''];
  return ['Uncategorised', 'Needs review', ''];
}

export function receiptConfidence(d) {
  let s = 0;
  if (d.merchant) s += 0.28;
  if (d.spent_on) s += 0.24;
  if (d.total !== null && d.total !== undefined) s += 0.32;
  if (d.payment_method && d.payment_method !== 'Other') s += 0.08;
  if (d.items && d.items.length) s += 0.08;
  return round2(Math.min(s, 1));
}

// ---------- ordering: same as "ORDER BY spent_on DESC, id DESC" ----------
export const byNewest = (a, b) => (a.spent_on < b.spent_on ? 1 : a.spent_on > b.spent_on ? -1 : (b.ord || 0) - (a.ord || 0));
const nextOrd = () => Date.now();

// ---------- queries ----------
const inMonth = (dateStr, month) => (dateStr || '').slice(0, 7) === month;

export function dashboard(month) {
  const exps = db.list('expense').filter(e => inMonth(e.spent_on, month));
  const incomes = db.list('income').filter(i => inMonth(i.received_on, month));
  const totals = {};
  let expensesTotal = 0;
  for (const e of exps) { totals[e.category] = (totals[e.category] || 0) + Number(e.amount || 0); expensesTotal += Number(e.amount || 0); }
  const budgets = {};
  for (const b of db.list('budget')) if (b.month === month) budgets[b.category] = Number(b.amount || 0);
  const review = exps.filter(e => e.review_status === 'needs_review');
  const incomeTotal = incomes.reduce((a, i) => a + Number(i.amount || 0), 0);
  const cards = BUDGET_CATEGORIES.map(name => {
    const actual = totals[name] || 0, budget = budgets[name] || 0;
    return { name, actual, budget, remaining: budget ? budget - actual : null };
  });
  return {
    month, expensesTotal, incomeTotal, balance: incomeTotal - expensesTotal,
    reviewCount: review.length, reviewTotal: review.reduce((a, e) => a + Number(e.amount || 0), 0),
    cards, recent: exps.sort(byNewest).slice(0, 10), incomes: incomes.sort((a, b) => (a.received_on < b.received_on ? 1 : -1)),
  };
}

export function transactions({ month, category = '', payment = '', review = '', q = '' }) {
  const needle = (q || '').trim().toLowerCase();
  return db.list('expense').filter(e => {
    if (!inMonth(e.spent_on, month)) return false;
    if (category && e.category !== category) return false;
    if (payment && e.payment_method !== payment) return false;
    if (review === '1' && e.review_status !== 'needs_review') return false;
    if (needle && ![e.merchant, e.description, e.notes].some(v => (v || '').toLowerCase().includes(needle))) return false;
    return true;
  }).sort(byNewest);
}

export function budgetsFor(month) {
  const out = {};
  for (const b of db.list('budget')) if (b.month === month) out[b.category] = Number(b.amount);
  return out;
}

// ---------- saves (same rules as the old server) ----------
export async function saveQuick(form) {
  const spent_on = form.spent_on || todayISO();
  const amount = parseFloat(form.amount);
  if (!isFinite(amount)) throw new Error('Enter a valid amount.');
  const category = form.category || 'Uncategorised';
  const subcategory = form.subcategory || (category === 'Uncategorised' ? 'Needs review' : 'Other');
  const merchant = (form.merchant || '').trim();
  const review_status = category === 'Uncategorised' || !merchant ? 'needs_review' : 'ok';
  const rec = await db.save('expense', {
    spent_on, merchant, merchant_key: normalizeMerchant(merchant), description: merchant || 'Quick expense', amount,
    category, subcategory, payment_method: form.payment_method || 'Other', notes: (form.notes || '').trim(),
    grouped_receipt: 1, source: 'quick', review_status, confidence: review_status === 'ok' ? 0.55 : 0.25,
    journey: '', receipt_type: null, items: [], receipts: [], created_at: db.now(), ord: nextOrd(),
  });
  return { rec, message: 'Quick expense saved.' + (review_status === 'needs_review' ? ' You can review it later.' : '') };
}

/** Full add/edit form. `photo` is an optional compressed Blob. */
export async function saveExpenseForm(id, form, photo) {
  const spent_on = form.spent_on || todayISO();
  const merchant = (form.merchant || '').trim();
  const description = (form.description || '').trim() || merchant || 'Expense';
  const amount = parseFloat(form.amount || '0');
  if (!isFinite(amount)) throw new Error('Amount must be a number.');
  const category = form.category || 'Uncategorised';
  const subcategory = (form.subcategory || '').trim() || 'Other';
  const review_status = category === 'Uncategorised' || form.needs_review ? 'needs_review' : 'ok';
  const items = (form.items || []).filter(it => (it.name || '').trim() && String(it.total ?? '').trim() !== '' && isFinite(parseFloat(it.total)))
    .map(it => ({ name: it.name.trim(), total: parseFloat(it.total) }));
  const existing = id ? db.getLocal('expense', id) : null;
  if (id && !existing) throw new Error('That expense no longer exists.');
  const receipts = existing ? [...(existing.receipts || [])] : [];
  if (photo) {
    const rid = db.newId();
    await db.putBlob(rid, photo);
    receipts.push({ id: rid, kind: 'receipt', name: 'photo.jpg' });
  }
  const base = existing || { source: form.source || 'manual', confidence: (form.source || 'manual') === 'manual' ? 1.0 : null, created_at: db.now(), ord: nextOrd() };
  const rec = await db.save('expense', {
    ...base, spent_on, merchant, merchant_key: normalizeMerchant(merchant), description, amount, category, subcategory,
    payment_method: form.payment_method || 'Other', notes: (form.notes || '').trim(), grouped_receipt: form.grouped_receipt ? 1 : 0,
    review_status, journey: (form.journey || '').trim(), receipt_type: (form.receipt_type || '').trim() || (existing ? existing.receipt_type : null) || null,
    items, receipts,
  });
  return { rec, message: 'Expense saved.' };
}

export async function deleteExpense(id) {
  const e = db.getLocal('expense', id);
  if (!e) return { month: thisMonth(), message: 'That expense has already been deleted.' };
  await db.remove('expense', id);
  return { month: (e.spent_on || todayISO()).slice(0, 7), message: 'Expense deleted.' };
}

export async function saveIncome(form) {
  const received_on = form.received_on || todayISO();
  const amount = parseFloat(form.amount || '0');
  if (!isFinite(amount)) throw new Error('Amount must be a number.');
  await db.save('income', {
    received_on, description: (form.description || 'Income').trim() || 'Income', amount,
    account: form.account || '', notes: form.notes || '', created_at: db.now(),
  });
  return { month: received_on.slice(0, 7), message: 'Income saved.' };
}

export async function saveBudgets(month, values) {
  const recs = [];
  for (const cat of BUDGET_CATEGORIES) {
    const raw = String(values[cat] ?? '').trim();
    if (raw === '') continue;
    const amount = parseFloat(raw);
    if (!isFinite(amount)) continue;
    const id = `${month}|${cat}`; // one record per month+category on every device
    const cur = db.getLocal('budget', id);
    recs.push({ ...(cur || {}), id, month, category: cat, amount });
  }
  if (recs.length) await db.saveMany('budget', recs);
  return 'Budgets saved.';
}

// ---------- receipt scan helpers ----------
export function findExistingDuplicate(d) {
  if (!d.spent_on || d.total === null || d.total === undefined) return null;
  const rows = db.list('expense').filter(e => e.spent_on === d.spent_on && Math.abs(Number(e.amount) - Number(d.total)) < 0.011)
    .sort((a, b) => (b.ord || 0) - (a.ord || 0)).slice(0, 12);
  let best = null, bestScore = 0;
  for (const r of rows) {
    const s = merchantSimilarity(d.merchant, r.merchant || r.description);
    if (s > bestScore) { best = r; bestScore = s; }
  }
  return best && bestScore >= 0.55 ? { id: best.id, spent_on: best.spent_on, merchant: best.merchant, description: best.description, amount: best.amount } : null;
}

function isSamePurchase(a, b) {
  if (a.total == null || b.total == null) return false;
  if (Math.abs(Number(a.total) - Number(b.total)) > 0.011) return false;
  if (a.spent_on && b.spent_on && a.spent_on !== b.spent_on) return false;
  const sim = merchantSimilarity(a.merchant, b.merchant);
  const paymentPair = [a.receipt_type, b.receipt_type].includes('payment_slip');
  return sim >= 0.55 || (paymentPair && !!(a.spent_on && b.spent_on));
}

export function markBatchDuplicates(drafts) {
  drafts.forEach((d, i) => {
    d.index = i; d.action = 'save'; d.combine_into = ''; d.duplicate_reason = '';
    const ex = findExistingDuplicate(d);
    d.existing_duplicate = ex || null;
    if (ex) d.action = 'skip';
  });
  const rank = { itemised_receipt: 3, receipt: 2, transit_ticket: 2, payment_slip: 1 };
  for (let i = 0; i < drafts.length; i++) {
    if (drafts[i].action === 'skip') continue;
    for (let j = 0; j < i; j++) {
      if (drafts[j].action === 'skip') continue;
      if (!isSamePurchase(drafts[i], drafts[j])) continue;
      let primary, secondary;
      if ((rank[drafts[i].receipt_type] || 0) > (rank[drafts[j].receipt_type] || 0)) { primary = drafts[i]; secondary = drafts[j]; secondary.combine_into = String(i); }
      else { primary = drafts[j]; secondary = drafts[i]; secondary.combine_into = String(j); }
      secondary.action = 'combine';
      secondary.duplicate_reason = 'Same date and amount; likely the payment/duplicate copy of this purchase.';
      if (!primary.spent_on && secondary.spent_on) primary.spent_on = secondary.spent_on;
      if ((!primary.payment_method || primary.payment_method === 'Other') && !['', 'Other', null, undefined].includes(secondary.payment_method)) primary.payment_method = secondary.payment_method;
      if (!primary.merchant && secondary.merchant) primary.merchant = secondary.merchant;
      break;
    }
  }
  return drafts;
}

/** Turn parsed OCR results into review drafts (category guess, confidence, duplicates). */
export function prepareDrafts(parsed) {
  for (const d of parsed) {
    const [cat, sub, pref] = categorySuggestion(d.merchant || '', d.raw_text || '');
    d.category = cat; d.subcategory = sub;
    if (d.payment_method === 'Other' && pref) d.payment_method = pref;
    d.confidence = receiptConfidence(d);
    d.needs_review = d.confidence < 0.75 || cat === 'Uncategorised';
  }
  return markBatchDuplicates(parsed);
}

/** Save the reviewed batch (mirror of /receipt/save-batch). `rows` come from the review form. */
export async function saveBatch(rows) {
  const created = {};
  let saved = 0, combined = 0, skipped = 0;
  const toSave = [];
  const ruleRecs = [];
  for (const d of rows) {
    if (d.action !== 'save') continue;
    const description = d.description || d.merchant || 'Receipt purchase';
    const userResolved = (d.ocr_amount_missing || d.ocr_merchant_missing || d.ocr_date_missing) && d.amount > 0 && d.category !== 'Uncategorised' && !!d.merchant && !!d.spent_on;
    const keepReview = d.needs_review && !userResolved;
    const review_status = keepReview || d.category === 'Uncategorised' ? 'needs_review' : 'ok';
    const receipts = [];
    if (d.blob_id) receipts.push({ id: d.blob_id, kind: 'receipt', name: d.file_name || 'receipt.jpg' });
    const rec = {
      id: db.newId(), spent_on: d.spent_on, merchant: d.merchant, merchant_key: normalizeMerchant(d.merchant), description, amount: d.amount,
      category: d.category, subcategory: d.subcategory, payment_method: d.payment_method, notes: '', grouped_receipt: d.grouped ? 1 : 0,
      source: 'receipt-ocr', review_status, confidence: d.confidence, journey: d.journey, receipt_type: d.receipt_type,
      items: d.items.filter(it => it.name), receipts, created_at: db.now(), ord: nextOrd() + saved,
    };
    created[d.index] = rec; toSave.push(rec); saved++;
    if (d.remember && d.merchant && d.category !== 'Uncategorised') {
      const key = normalizeMerchant(d.merchant);
      const cur = db.getLocal('rule', key);
      ruleRecs.push({ ...(cur || {}), id: key, merchant_key: key, display_name: d.merchant, category: d.category, subcategory: d.subcategory,
        preferred_payment: d.payment_method === 'Other' ? (cur ? cur.preferred_payment : 'Other') : d.payment_method });
    }
  }
  for (const d of rows) {
    if (d.action === 'skip') { skipped++; continue; }
    if (d.action !== 'combine') continue;
    let target = created[parseInt(d.combine_into, 10)];
    if (!target) {
      const t = rows.find(x => x.index === parseInt(d.combine_into, 10));
      if (t && t.action === 'combine') target = created[parseInt(t.combine_into, 10)];
    }
    if (!target) continue;
    if (d.blob_id) target.receipts.push({ id: d.blob_id, kind: 'supporting', name: d.file_name || 'receipt.jpg' });
    if (!target.items.length) target.items = d.items.filter(it => it.name);
    combined++;
  }
  if (toSave.length) await db.saveMany('expense', toSave);
  if (ruleRecs.length) await db.saveMany('rule', ruleRecs);
  // Photos of skipped receipts are not needed.
  for (const d of rows) if (d.action === 'skip' && d.blob_id) await db.deleteBlob(d.blob_id);
  if (!saved) return { ok: false, message: 'No new transactions were saved.' };
  let msg = `Saved ${saved} transaction${saved !== 1 ? 's' : ''}.`;
  if (combined) msg += ` Combined ${combined} supporting/duplicate receipt${combined !== 1 ? 's' : ''}.`;
  if (skipped) msg += ` Skipped ${skipped}.`;
  return { ok: true, message: msg, month: toSave[0].spent_on.slice(0, 7) };
}

// ---------- CSV export (same columns as before) ----------
export function exportCSV(month) {
  const rows = db.list('expense').filter(e => !month || inMonth(e.spent_on, month)).sort((a, b) => (a.spent_on < b.spent_on ? -1 : a.spent_on > b.spent_on ? 1 : (a.ord || 0) - (b.ord || 0)));
  const head = ['Date', 'Merchant', 'Description', 'Amount', 'Category', 'Subcategory', 'Payment Method', 'Journey', 'Review Status', 'Notes', 'Source'];
  const esc = v => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const lines = [head.join(',')];
  for (const e of rows) lines.push([e.spent_on, e.merchant, e.description, e.amount, e.category, e.subcategory, e.payment_method, e.journey, e.review_status, e.notes, e.source].map(esc).join(','));
  return lines.join('\r\n') + '\r\n';
}
