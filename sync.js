// PocketBudget — sync with Supabase (plain HTTPS calls, no extra library).
// Each device keeps its own copy. When online: push local changes, pull everyone else's,
// upload new receipt photos. The newest edit of a record wins.
import * as db from './db.js';

const PAGE = 500;
const OVERLAP = 50; // re-read a few recent changes each time so nothing can slip through
let state = { status: 'signed-out', message: '', lastSync: null, pending: 0 };
const subs = new Set();
export function onStatus(fn) { subs.add(fn); fn(state); return () => subs.delete(fn); }
function setState(patch) { state = { ...state, ...patch }; for (const fn of subs) try { fn(state); } catch (e) { console.error(e); } }
export const getState = () => state;

// ---------- settings & session ----------
// Your project (the publishable key is meant to be public; data is protected by your login + security rules).
export const DEFAULT_CONFIG = { url: 'https://uwihvayqoigamwvnfhlm.supabase.co', key: 'sb_publishable_k4bGSYH8vT2kHs98MjRVbA_kGpMKrIJ' };
export async function getConfig() { return (await db.getMeta('supabase', null)) || DEFAULT_CONFIG; }
export async function setConfig(url, key) {
  url = (url || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+$/.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) throw new Error('The Project URL should look like https://xxxx.supabase.co');
  if (!key || key.trim().length < 20) throw new Error('That key looks too short. Copy the anon / publishable key.');
  await db.setMeta('supabase', { url, key: key.trim() });
}
async function getSession() { return db.getMeta('session', null); }
async function setSession(s) { await db.setMeta('session', s); }

async function call(path, { method = 'GET', body, headers = {}, auth = true, raw = false } = {}) {
  const cfg = await getConfig(); if (!cfg) throw new Error('Sync is not set up.');
  const h = { apikey: cfg.key, ...headers };
  if (auth) { const s = await validSession(); h.Authorization = `Bearer ${s.access_token}`; }
  if (body !== undefined && !(body instanceof Blob)) { h['Content-Type'] = h['Content-Type'] || 'application/json'; body = JSON.stringify(body); }
  const res = await fetch(cfg.url + path, { method, headers: h, body });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg = j.error_description || j.msg || j.message || j.error || msg; } catch (e) { /* not json */ }
    const err = new Error(msg); err.status = res.status; throw err;
  }
  if (raw) return res;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function signIn(email, password) {
  const r = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: email.trim(), password }, auth: false })
    .catch(e => { throw new Error(e.status === 400 ? 'Wrong email or password.' : `Could not sign in (${e.message}).`); });
  await setSession({ access_token: r.access_token, refresh_token: r.refresh_token, expires_at: Date.now() + (r.expires_in || 3600) * 1000, user: { id: r.user.id, email: r.user.email } });
  setState({ status: 'idle', message: '' });
  return r.user;
}
export async function signOut() { await db.setMeta('session', null); setState({ status: 'signed-out', message: '' }); }
export async function currentUser() { const s = await getSession(); return s ? s.user : null; }

async function validSession() {
  const s = await getSession(); if (!s) throw Object.assign(new Error('Not signed in.'), { code: 'signed-out' });
  if (Date.now() < s.expires_at - 60_000) return s;
  const r = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token }, auth: false })
    .catch(e => { if (e.status === 400 || e.status === 401) { setSession(null); throw Object.assign(new Error('Please sign in again.'), { code: 'signed-out' }); } throw e; });
  const ns = { ...s, access_token: r.access_token, refresh_token: r.refresh_token, expires_at: Date.now() + (r.expires_in || 3600) * 1000 };
  await setSession(ns); return ns;
}

// ---------- the sync itself ----------
const strip = r => { const { dirty, ...rest } = r; return rest; };
let running = null;

export async function pendingCount() {
  let n = 0; for (const k of db.KINDS) n += db.dirtyRecords(k).length;
  const referenced = referencedReceiptIds();
  n += (await db.pendingBlobs()).filter(b => referenced.has(b.id)).length;
  return n;
}
function referencedReceiptIds() {
  const s = new Set();
  for (const e of db.list('expense')) for (const r of e.receipts || []) s.add(r.id);
  return s;
}

export function syncNow() {
  if (running) return running;
  running = (async () => {
    if (!(await getConfig()) || !(await getSession())) { setState({ status: 'signed-out', pending: await pendingCount() }); return; }
    if (!navigator.onLine) { setState({ status: 'offline', pending: await pendingCount() }); return; }
    setState({ status: 'syncing', message: '' });
    try {
      const s = await validSession();
      // 1. push local changes
      for (const kind of db.KINDS) {
        const dirty = db.dirtyRecords(kind);
        for (let i = 0; i < dirty.length; i += 200) {
          const chunk = dirty.slice(i, i + 200);
          await call('/rest/v1/rpc/push_records', { method: 'POST', body: { records: chunk.map(r => ({ kind, id: r.id, data: strip(r), updated_at: r.updated_at, deleted: !!r.deleted })) } });
          await db.markClean(kind, chunk.map(r => r.id), chunk.map(r => r.updated_at));
        }
      }
      // 2. pull everyone else's changes
      let cursor = Number(await db.getMeta('cursor', 0)) || 0;
      let from = Math.max(0, cursor - OVERLAP), applied = 0;
      for (;;) {
        const rows = await call(`/rest/v1/records?select=kind,id,data,updated_at,deleted,server_seq&server_seq=gt.${from}&order=server_seq.asc&limit=${PAGE}`);
        if (!rows || !rows.length) break;
        const byKind = {};
        for (const row of rows) {
          from = Math.max(from, Number(row.server_seq)); cursor = Math.max(cursor, Number(row.server_seq));
          if (!db.KINDS.includes(row.kind)) continue;
          const local = db.getAny(row.kind, row.id);
          const remoteStamp = new Date(row.updated_at).toISOString();
          if (local && local.updated_at && local.updated_at >= remoteStamp) continue; // ours is newer or the same
          (byKind[row.kind] = byKind[row.kind] || []).push({ ...row.data, id: row.id, updated_at: remoteStamp, deleted: row.deleted ? 1 : 0, dirty: 0 });
        }
        for (const [kind, recs] of Object.entries(byKind)) { await db.saveMany(kind, recs, { fromSync: true }); applied += recs.length; }
        if (rows.length < PAGE) break;
      }
      await db.setMeta('cursor', cursor);
      // 3. upload new receipt photos
      const referenced = referencedReceiptIds();
      for (const b of await db.pendingBlobs()) {
        if (!referenced.has(b.id)) continue;
        await call(`/storage/v1/object/receipts/${s.user.id}/${encodeURIComponent(b.id)}.jpg`, { method: 'POST', body: b.blob, headers: { 'Content-Type': b.type || 'image/jpeg', 'x-upsert': 'true' } });
        await db.markBlobUploaded(b.id);
      }
      const when = new Date().toISOString();
      await db.setMeta('lastSync', when);
      setState({ status: 'idle', lastSync: when, pending: await pendingCount(), message: applied ? `${applied} change${applied > 1 ? 's' : ''} received` : '' });
    } catch (e) {
      console.warn('sync failed', e);
      if (e.code === 'signed-out') setState({ status: 'signed-out', message: e.message });
      else setState({ status: navigator.onLine ? 'error' : 'offline', message: e.message || String(e) });
      setState({ pending: await pendingCount() });
    }
  })().finally(() => { running = null; });
  return running;
}

/** Fetch a receipt photo that was taken on another device. */
export async function downloadReceipt(id) {
  const s = await validSession();
  const res = await call(`/storage/v1/object/authenticated/receipts/${s.user.id}/${encodeURIComponent(id)}.jpg`, { raw: true });
  const blob = await res.blob();
  await db.putBlob(id, blob, { uploaded: 1 });
  return blob;
}

// ---------- automatic syncing ----------
let timer = null;
export function scheduleSoon(ms = 2500) { clearTimeout(timer); timer = setTimeout(() => syncNow(), ms); }
export async function start() {
  setState({ lastSync: await db.getMeta('lastSync', null), pending: await pendingCount(), status: (await getSession()) && (await getConfig()) ? (navigator.onLine ? 'idle' : 'offline') : 'signed-out' });
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', async () => setState({ status: 'offline', pending: await pendingCount() }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(() => syncNow(), 5 * 60_000);
  db.onChange(async () => { setState({ pending: await pendingCount() }); scheduleSoon(); });
  syncNow();
}
