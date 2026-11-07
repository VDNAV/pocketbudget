// PocketBudget — on-device storage (IndexedDB).
// Every synced record has: id (text), updated_at (ISO), deleted (0/1), dirty (0/1, local only).
// Kinds that sync: expense, income, budget, rule. Receipt photos live in `blobs`.

const DB_NAME = 'pocketbudget';
const DB_VERSION = 1;
export const KINDS = ['expense', 'income', 'budget', 'rule'];
const STORES = [...KINDS, 'blobs', 'meta', 'drafts'];

let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'meta' ? 'key' : 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
    result = fn(Array.isArray(store) ? store.map(s => t.objectStore(s)) : t.objectStore(store));
  }));
}
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const now = () => new Date().toISOString();
export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));

// ---------- in-memory cache of the small tables (fast queries, tiny data) ----------
const cache = { expense: null, income: null, budget: null, rule: null };
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(kind) { for (const fn of listeners) try { fn(kind); } catch (e) { console.error(e); } }

export async function loadAll() {
  for (const k of KINDS) cache[k] = await tx(k, 'readonly', s => reqP(s.getAll())).then(x => x);
}
async function ensure(kind) { if (!cache[kind]) cache[kind] = await tx(kind, 'readonly', s => reqP(s.getAll())); }

// raw getAll that waits for the request (tx() resolves after complete)
async function getAllRaw(store) {
  const db = await open();
  return new Promise((res, rej) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
export async function reload(kind) { cache[kind] = await getAllRaw(kind); }
export async function init() { await open(); for (const k of KINDS) cache[k] = await getAllRaw(k); }

/** Visible (not deleted) records of a kind. */
export function list(kind) { return (cache[kind] || []).filter(r => !r.deleted); }
export function getLocal(kind, id) { return (cache[kind] || []).find(r => r.id === id && !r.deleted) || null; }

/** Save a record locally and mark it for sync. */
export async function save(kind, rec, { fromSync = false } = {}) {
  const r = { ...rec };
  if (!r.id) r.id = newId();
  if (!fromSync) { r.updated_at = now(); r.dirty = 1; }
  r.deleted = r.deleted ? 1 : 0;
  await tx(kind, 'readwrite', s => s.put(r));
  await ensure(kind);
  const i = cache[kind].findIndex(x => x.id === r.id);
  if (i >= 0) cache[kind][i] = r; else cache[kind].push(r);
  emit(kind);
  return r;
}
export async function saveMany(kind, recs, opts = {}) {
  const out = [];
  const stamp = now();
  await tx(kind, 'readwrite', s => {
    for (const rec of recs) {
      const r = { ...rec };
      if (!r.id) r.id = newId();
      if (!opts.fromSync) { r.updated_at = opts.keepStamp && r.updated_at ? r.updated_at : stamp; r.dirty = 1; }
      r.deleted = r.deleted ? 1 : 0;
      s.put(r); out.push(r);
    }
  });
  await reload(kind);
  emit(kind);
  return out;
}
/** Soft delete (so the deletion syncs to other devices). */
export async function remove(kind, id) {
  const cur = (cache[kind] || []).find(r => r.id === id);
  if (!cur) return;
  await save(kind, { ...cur, deleted: 1 });
}
export function dirtyRecords(kind) { return (cache[kind] || []).filter(r => r.dirty); }
export async function markClean(kind, ids, stamps) {
  const set = new Map(ids.map((id, i) => [id, stamps ? stamps[i] : null]));
  const changed = [];
  for (const r of cache[kind] || []) {
    if (!set.has(r.id)) continue;
    // Only clear the flag if the record wasn't edited again while uploading.
    const stamp = set.get(r.id);
    if (stamp && r.updated_at !== stamp) continue;
    r.dirty = 0; changed.push(r);
  }
  if (changed.length) await tx(kind, 'readwrite', s => { for (const r of changed) s.put(r); });
}

// ---------- blobs (receipt photos) ----------
export async function putBlob(id, blob, { uploaded = 0 } = {}) {
  await tx('blobs', 'readwrite', s => s.put({ id, blob, type: blob.type || 'image/jpeg', uploaded: uploaded ? 1 : 0, created_at: now() }));
}
export async function getBlob(id) { const db = await open(); return reqP(db.transaction('blobs').objectStore('blobs').get(id)); }
export async function hasBlob(id) { return !!(await getBlob(id)); }
export async function markBlobUploaded(id) {
  const b = await getBlob(id); if (!b) return;
  b.uploaded = 1; await tx('blobs', 'readwrite', s => s.put(b));
}
export async function pendingBlobs() { return (await getAllRaw('blobs')).filter(b => !b.uploaded); }
export async function deleteBlob(id) { await tx('blobs', 'readwrite', s => s.delete(id)); }
export async function allBlobIds() { const db = await open(); return reqP(db.transaction('blobs').objectStore('blobs').getAllKeys()); }

// ---------- meta (settings, sync cursor) ----------
export async function getMeta(key, dflt = null) {
  const db = await open(); const r = await reqP(db.transaction('meta').objectStore('meta').get(key));
  return r ? r.value : dflt;
}
export async function setMeta(key, value) { await tx('meta', 'readwrite', s => s.put({ key, value })); }

// ---------- scan drafts (kept until saved or discarded, so nothing is lost) ----------
export async function getDrafts() { const d = await getAllRaw('drafts'); return d.sort((a, b) => a.order - b.order); }
export async function setDrafts(drafts) {
  await tx('drafts', 'readwrite', s => { s.clear(); drafts.forEach((d, i) => s.put({ ...d, id: d.id || newId(), order: i })); });
}
export async function clearDrafts() { await tx('drafts', 'readwrite', s => s.clear()); }

/** Wipe everything on this device (used only by "Reset this device"). */
export async function wipe() { for (const s of STORES) await tx(s, 'readwrite', st => st.clear()); for (const k of KINDS) cache[k] = []; emit('*'); }

/** Any record including deleted ones (sync needs to compare against tombstones). */
export function getAny(kind, id) { return (cache[kind] || []).find(r => r.id === id) || null; }
export function counts() { const o = {}; for (const k of KINDS) o[k] = list(k).length; return o; }
