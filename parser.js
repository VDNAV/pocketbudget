// PocketBudget — receipt text understanding. A faithful port of receipt_parser.parse_receipt_text.

const KNOWN_MERCHANTS = [
  ['LE WAREHOUSE', 'Le Warehouse Ltd.'], ['WAREHOUSE LTD', 'Le Warehouse Ltd.'], ['WINNERS', 'Winners'],
  ['LA MAISON DU GOURMET', 'La Maison du Gourmet'], ['INNOPHARMA', 'Innopharma'], ['INNOPHA', 'Innopharma'],
  ['NNOPHAR', 'Innopharma'], ['METRO EXPRESS', 'Metro Express'], ['ROYAL SWAZI TOURS', 'Royal Swazi Tours'],
  ['ROYAL SWAZI', 'Royal Swazi Tours'], ['LA FIAMMA', 'La Fiamma'], ['NATIONAL TRANSPORT', 'NTC'], [' NTC ', 'NTC'], [' UBS ', 'UBS'],
];
const DATE_PATTERNS = [/\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/, /\b(\d{4}[./-]\d{1,2}[./-]\d{1,2})\b/];
const CURRENCY_SRC = String.raw`(?:\bRS\.?|\bMUR)\s*:?[ ]*(\d{1,7}(?:[.,]\d{1,2})?)`;
const DECIMAL_SRC = String.raw`(?<!\d)(\d{1,7}[.,]\d{2})(?!\d)`;
const CURRENCY_RE = () => new RegExp(CURRENCY_SRC, 'gi');
const DECIMAL_RE = () => new RegExp(DECIMAL_SRC, 'g');
const SKIP_ITEM_WORDS = ['total', 'tva', 'subtotal', 'sub total', 'vat', 'tax', 'cash', 'change', 'tender', 'balance',
  'discount', 'amount due', 'credit card', 'debit card', 'approved', 'invoice', 'fare', 'terminal', 'auth code',
  'response', 'transaction', 'ticket', 'brn', 'cardholder', 'mcb pos'];

const isAlpha = ch => /\p{L}/u.test(ch);
const countAlpha = s => [...s].filter(isAlpha).length;
function stripChars(s, chars) {
  let a = 0, b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

function normalizeAmount(raw) {
  if (raw == null) return null;
  raw = String(raw).replace(/ /g, '').replace(/,/g, '.');
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(raw)) return null;
  const v = parseFloat(raw);
  if (!isFinite(v) || v < 0 || v > 10_000_000) return null;
  return v;
}

function validDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(y, m, 0).getDate();
}
const iso = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function normalizeDate(raw) {
  raw = raw.replace(/\./g, '/').replace(/-/g, '/');
  const cur = new Date().getFullYear();
  const tries = [
    [/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, m => [+m[3], +m[2], +m[1]]],
    [/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, m => { const yy = +m[3]; return [yy < 69 ? 2000 + yy : 1900 + yy, +m[2], +m[1]]; }],
    [/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, m => [+m[1], +m[2], +m[3]]],
  ];
  for (const [re, fn] of tries) {
    const m = raw.match(re); if (!m) continue;
    let [y, mo, d] = fn(m);
    if (!validDate(y, mo, d)) continue;
    if (y > cur + 2 && String(y).startsWith('20')) { if (!validDate(cur, mo, d)) continue; y = cur; }
    return iso(y, mo, d);
  }
  return '';
}

function merchantFromText(text, lines) {
  const upper = ` ${text.toUpperCase()} `;
  for (const [needle, display] of KNOWN_MERCHANTS) {
    if (upper.includes(needle)) {
      if (display === 'Winners' && upper.includes('MANHATTAN')) return 'Winners Manhattan';
      return display;
    }
  }
  const blocked = ['invoice', 'receipt', 'duplicate', 'cashier', 'terminal', 'date', 'time', 'fare'];
  for (const line of lines.slice(0, 10)) {
    const low = line.toLowerCase();
    if ([...line].length < 3 || blocked.some(x => low.includes(x))) continue;
    if (DATE_PATTERNS[0].test(line) || CURRENCY_RE().test(line) || DECIMAL_RE().test(line)) continue;
    if (countAlpha(line) >= 3) return [...line].slice(0, 80).join('');
  }
  return '';
}

function extractDate(lines) {
  for (const line of lines) for (const pat of DATE_PATTERNS) {
    const m = line.match(pat);
    if (m) { const v = normalizeDate(m[1]); if (v) return v; }
  }
  return '';
}

function lineAmounts(line) {
  const vals = [];
  for (const m of line.matchAll(CURRENCY_RE())) { const a = normalizeAmount(m[1]); if (a !== null) vals.push(a); }
  for (const m of line.matchAll(DECIMAL_RE())) {
    const a = normalizeAmount(m[1]);
    if (a !== null && vals.every(old => Math.abs(a - old) > 0.0001)) vals.push(a);
  }
  return vals;
}

const round2 = v => Math.round(v * 100) / 100;
function extractTotal(lines) {
  const preferred = [], secondary = [];
  lines.forEach((line, idx) => {
    const low = line.toLowerCase();
    const amounts = lineAmounts(line);
    const next = idx + 1 < lines.length ? lineAmounts(lines[idx + 1]) : [];
    const pick = () => (amounts.length ? amounts : next);
    if (['grand total', 'gross total', 'total amount', 'amount due', 'total fare'].some(k => low.includes(k))) {
      const v = pick(); if (v.length) preferred.push(v[v.length - 1]);
    } else if (/^[^a-z0-9]*(total|sub total|subtotal)[^a-z0-9]*$/.test(low)) {
      const v = pick(); if (v.length) preferred.push(v[v.length - 1]);
    } else if (/\btotal\b/.test(low) && !low.includes('vat')) {
      const v = pick(); if (v.length) preferred.push(v[v.length - 1]);
    } else if (['amount:', 'amount ', 'fare:', 'fare '].some(k => low.includes(k))) {
      const v = pick(); if (v.length) secondary.push(v[v.length - 1]);
    }
  });
  if (preferred.length) {
    const counts = new Map();
    for (const v of preferred) { const k = round2(v); counts.set(k, (counts.get(k) || 0) + 1); }
    let best = null, bestKey = null;
    for (const [k, c] of counts) {
      const idx = preferred.indexOf(k);
      const key = [c, idx === -1 ? -Infinity : -idx];
      if (!bestKey || key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) { best = k; bestKey = key; }
    }
    return best;
  }
  if (secondary.length) return secondary[secondary.length - 1];
  const all = lines.flatMap(lineAmounts).filter(x => x < 200000);
  return all.length ? Math.max(...all) : null;
}

function extractItems(lines, total) {
  const items = [], seen = new Set();
  lines.forEach((line, idx) => {
    const low = line.toLowerCase();
    if (SKIP_ITEM_WORDS.some(w => low.includes(w))) return;
    let amounts = lineAmounts(line);
    let fromNext = false;
    if (!amounts.length && idx + 1 < lines.length) {
      const na = lineAmounts(lines[idx + 1]);
      if (na.length && countAlpha(line) >= 3 && [...line].length <= 90) { amounts = na; fromNext = true; }
    }
    if (!amounts.length) return;
    const amount = amounts[amounts.length - 1];
    if (total !== null && Math.abs(amount - total) < 0.005 && lines.length > 4) return;
    let name;
    if (fromNext) name = stripChars(line, ' .:-|>');
    else {
      const m = [...line.matchAll(DECIMAL_RE())];
      if (m.length) name = stripChars(line.slice(0, m[m.length - 1].index), ' .:-|>');
      else {
        const c = [...line.matchAll(CURRENCY_RE())];
        name = c.length ? stripChars(line.slice(0, c[c.length - 1].index), ' .:-|>') : '';
      }
    }
    name = name.replace(/^\d+\s*[>)xX*]?\s*/, '').trim();
    name = name.replace(/^[Iil|]+>\s*/, '').trim();
    if ([...name].length < 2 || countAlpha(name) < 2) return;
    if (['rs', 'mur', 'tva incluse', 'vat included'].includes(name.toLowerCase().trim())) return;
    const key = name.toLowerCase() + '|' + round2(amount);
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ name: [...name].slice(0, 120).join(''), total: amount });
  });
  return items.slice(0, 60);
}

function receiptType(text, items) {
  const low = text.toLowerCase();
  if (low.includes('metro express') || low.includes('total fare') || (low.includes('fare') && low.includes('adult'))) return 'transit_ticket';
  if (low.includes('cardholder copy') || (low.includes('approved') && ['visa', 'mastercard', 'card'].some(x => low.includes(x)))) return 'payment_slip';
  if (items.length >= 2 || low.includes('item count') || low.includes('gross total') || low.includes('sub total')) return 'itemised_receipt';
  return 'receipt';
}

function paymentMethod(text) {
  const low = text.toLowerCase();
  if (low.includes('sbm tag') || low.includes('sbm-tag')) return 'SBM TAG';
  if (['visa', 'mastercard', 'credit card', 'debit card', 'cardholder', 'mcb pos', 'approved'].some(x => low.includes(x))) return 'Card';
  if (/\bcash\b/.test(low)) return 'Cash';
  return 'Other';
}

function journey(lines) {
  let origin = '', destination = '';
  for (const line of lines) {
    let m = line.match(/origin\s*[:\-]?\s*(.+)$/i); if (m) origin = m[1].trim();
    m = line.match(/destination\s*[:\-]?\s*(.+)$/i); if (m) destination = m[1].trim();
  }
  origin = stripChars(origin, ' :-|_'); destination = stripChars(destination, ' :-|_');
  if (origin && destination && [...(origin + destination)].some(isAlpha)) return `${origin} → ${destination}`;
  return '';
}

export function parseReceiptText(text) {
  const lines = text.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/).filter(x => x.trim()).map(x => x.replace(/\s+/g, ' ').trim());
  const merchant = merchantFromText(text, lines);
  const spent_on = extractDate(lines);
  const total = extractTotal(lines);
  const items = extractItems(lines, total);
  const low = text.toLowerCase();
  const labelSeen = ['total', 'amount due', 'amount:', 'gross total', 'sub total', 'subtotal'].some(k => low.includes(k));
  return {
    merchant, spent_on, total, items, receipt_type: receiptType(text, items), payment_method: paymentMethod(text),
    journey: journey(lines), raw_text: text, amount_needs_confirmation: total === null, handwritten_amount_suspected: total === null && labelSeen,
  };
}

/** Same scoring the old app used to pick the best OCR pass. */
export function scoreOcrText(text) {
  let score = (text.match(/\b(?:total|amount|fare|invoice|receipt|rs|mur|date|metro|winners|vat)\b/gi) || []).length * 20;
  score += (text.match(/\d+[.,]\d{2}/g) || []).length * 4;
  score += (text.match(/^[^\n]*[A-Za-z][^\n]*\d+[.,]\d{2}\s*(?:Rs)?\s*$/gim) || []).length * 12;
  score += (text.split('>').length - 1) * 2;
  score += Math.min(text.length, 1500) / 100;
  return score;
}
