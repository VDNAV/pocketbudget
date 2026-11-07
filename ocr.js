// PocketBudget — on-device receipt reading (Tesseract, the same engine the old app used).
// The library files are copied into ./vendor when the app is published (see .github/workflows),
// so they are served from the app itself and cached for offline use.
import { parseReceiptText, scoreOcrText } from './parser.js';

const BASE = new URL('./vendor/', import.meta.url).href;
const PATHS = {
  script: BASE + 'tesseract/tesseract.min.js',
  worker: BASE + 'tesseract/worker.min.js',
  core: BASE + 'tesseract-core',
  lang: BASE + 'lang',
};

let libPromise = null, workerPromise = null;
function loadLib() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!libPromise) libPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = PATHS.script; s.async = true;
    s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new Error('Receipt reader failed to load.')));
    s.onerror = () => { libPromise = null; reject(new Error('Receipt reader is not available yet. Connect to the internet once so it can download.')); };
    document.head.appendChild(s);
  });
  return libPromise;
}

let progressCb = null;
async function getWorker() {
  if (!workerPromise) workerPromise = (async () => {
    const T = await loadLib();
    return T.createWorker('eng', 1, {
      workerPath: PATHS.worker, corePath: PATHS.core, langPath: PATHS.lang, gzip: true, workerBlobURL: false,
      logger: m => { if (progressCb && m && typeof m.progress === 'number') progressCb(m); },
    });
  })().catch(e => { workerPromise = null; throw e; });
  return workerPromise;
}
export async function terminate() { if (workerPromise) { try { (await workerPromise).terminate(); } catch (e) { /* ignore */ } workerPromise = null; } }

/** Download the reader once while online so it works offline later. */
export async function prepare(onProgress) {
  progressCb = onProgress || null;
  const w = await getWorker();
  const c = document.createElement('canvas'); c.width = 200; c.height = 60;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 200, 60); g.fillStyle = '#000'; g.font = '28px sans-serif'; g.fillText('TOTAL 10.00', 8, 40);
  await w.setParameters({ tessedit_pageseg_mode: '6' });
  const r = await w.recognize(c);
  progressCb = null;
  return (r.data.text || '').trim();
}

// ---------- image preparation (mirrors _prepare_image / _ocr in the old parser) ----------
async function toCanvas(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  let w = bmp.width, h = bmp.height;
  let scale = Math.max(w, h) > 2600 ? 2600 / Math.max(w, h) : 1;
  if (Math.max(w, h) * scale < 1800) { const up = Math.min(3, 1800 / (Math.max(w, h) * scale)); if (up > 1.12) scale *= up; }
  const c = document.createElement('canvas'); c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, c.width, c.height);
  // grayscale + autocontrast + contrast boost (like ImageOps.autocontrast + ImageEnhance.Contrast(1.65))
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) { const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; d[i] = y; hist[y]++; }
  const total = c.width * c.height; let lo = 0, hi = 255, acc = 0;
  while (lo < 255 && (acc += hist[lo]) < total * 0.005) lo++;
  acc = 0; while (hi > 0 && (acc += hist[hi]) < total * 0.005) hi--;
  const span = Math.max(1, hi - lo);
  let mean = 0;
  for (let i = 0; i < d.length; i += 4) { const v = Math.min(255, Math.max(0, (d[i] - lo) * 255 / span)); d[i] = v; mean += v; }
  mean /= total;
  for (let i = 0; i < d.length; i += 4) { const v = Math.min(255, Math.max(0, mean + (d[i] - mean) * 1.65)); d[i] = d[i + 1] = d[i + 2] = v; }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Read one receipt photo. Returns a draft like the old parse_receipt_image (single-receipt mode).
 * Two layout passes are tried and the more receipt-like text wins.
 */
export async function readReceipt(file, onProgress) {
  progressCb = onProgress || null;
  try {
    const w = await getWorker();
    const canvas = await toCanvas(file);
    let best = { score: -1, text: '' };
    for (const psm of ['4', '6']) {
      await w.setParameters({ tessedit_pageseg_mode: psm });
      const r = await w.recognize(canvas);
      const text = r.data.text || '';
      const score = scoreOcrText(text);
      if (score > best.score) best = { score, text };
    }
    return { ...parseReceiptText(best.text), ocr_error: '' };
  } catch (e) {
    return { ...parseReceiptText(''), ocr_error: e.message || String(e) };
  } finally { progressCb = null; }
}
