// PocketBudget — shared UI helpers, components and pop-ups.
import { ICONS } from './icons.js';
import { CATEGORIES, CATEGORY_NAMES, PAYMENT_METHODS, money } from './logic.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
export const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const parseISO = v => { const p = (v || '').split('-').map(Number); return p[0] ? new Date(p[0], (p[1] || 1) - 1, p[2] || 1) : null; };
export const fmtDate = d => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0,3)}` + (d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '');
export { money };

/** Escape text for HTML (all user data goes through this). */
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function icon(name, size = 20, cls = '') {
  const body = ICONS[name] || ICONS._default;
  return `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
export const catSlug = c => ({ Mandatory: 'mandatory', Food: 'food', Transport: 'transport', Health: 'health', Miscellaneous: 'misc' }[c] || 'unc');
export const catAvatar = (c, size = 40) => `<span class="avatar cat-${catSlug(c)}" style="--s:${size}px">${icon(c, Math.round(size * 0.5))}</span>`;

export function monthLabel(month) { const [y, m] = month.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; }
export function shiftMonth(month, d) { let [y, m] = month.split('-').map(Number); m += d; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return `${y}-${String(m).padStart(2, '0')}`; }

/** ‹ Month › switcher. `hrefFor(month)` builds the link for a month. */
export function monthNav(month, hrefFor) {
  return `<div class="month-nav">
    <a class="icon-btn" href="${esc(hrefFor(shiftMonth(month, -1)))}" data-replace aria-label="Previous month">${icon('chev-left')}</a>
    <button type="button" class="month-label" data-month-pick="${esc(month)}" aria-label="Choose month" aria-haspopup="dialog">
      <span class="month-text">${esc(monthLabel(month))}</span>${icon('chev-down', 18, 'month-chev')}
    </button>
    <a class="icon-btn" href="${esc(hrefFor(shiftMonth(month, 1)))}" data-replace aria-label="Next month">${icon('chev-right')}</a>
  </div>`;
}

export function categoryChips(name, selected, target) {
  let found = false;
  let h = `<div class="chip-grid cat-chips" data-target="${esc(target)}" role="radiogroup">`;
  for (const cat of CATEGORY_NAMES) {
    if (cat === selected) found = true;
    h += `<label class="chip cat-${catSlug(cat)}"><input type="radio" name="${esc(name)}" value="${esc(cat)}" ${cat === selected ? 'checked' : ''}><span>${icon(cat, 18)}${cat === 'Uncategorised' ? 'Review later' : esc(cat)}</span></label>`;
  }
  if (selected && !found) h += `<label class="chip cat-unc"><input type="radio" name="${esc(name)}" value="${esc(selected)}" checked><span>${icon('', 18)}${esc(selected)}</span></label>`;
  return h + '</div>';
}
export function paymentChips(name, selected) {
  const sel = selected || PAYMENT_METHODS[0];
  let found = false, h = '<div class="chip-row" role="radiogroup">';
  for (const p of PAYMENT_METHODS) { if (p === sel) found = true; h += `<label class="chip small"><input type="radio" name="${esc(name)}" value="${esc(p)}" ${p === sel ? 'checked' : ''}><span>${esc(p)}</span></label>`; }
  if (!found) h += `<label class="chip small"><input type="radio" name="${esc(name)}" value="${esc(sel)}" checked><span>${esc(sel)}</span></label>`;
  return h + '</div>';
}
export function toggle(name, label, checked = false, { value = null, id = null, hint = null } = {}) {
  return `<label class="toggle"><span class="toggle-text"><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</span>
    <input type="checkbox" name="${esc(name)}" ${value !== null ? `value="${esc(value)}"` : ''} ${id ? `id="${esc(id)}"` : ''} ${checked ? 'checked' : ''}><span class="switch" aria-hidden="true"></span></label>`;
}
export function txRow(x, showPayment = false) {
  const sub = [x.category, x.subcategory || 'General'];
  if (showPayment && x.payment_method && x.payment_method !== 'Other') sub.push(x.payment_method);
  if (x.journey) sub.push(x.journey);
  return `<a class="tx ${x.review_status === 'needs_review' ? 'needs-review' : ''}" href="#/edit/${encodeURIComponent(x.id)}">
    ${catAvatar(x.category)}
    <span class="tx-main"><strong>${esc(x.merchant || x.description)}</strong><small>${esc(sub.join(' · '))}</small></span>
    <span class="tx-side"><b>${esc(money(x.amount))}</b>${x.review_status === 'needs_review' ? '<em class="badge warn">Review</em>' : ''}</span></a>`;
}
export function friendlyDate(isoStr) {
  const p = (isoStr || '').split('-').map(Number); if (p.length < 3 || !p[0]) return isoStr || '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(p[0], p[1] - 1, p[2]); const diff = Math.round((today - d) / 864e5);
  if (diff === 0) return 'Today'; if (diff === 1) return 'Yesterday';
  return fmtDate(d);
}
/** Group rows (already sorted newest first) by a date field. */
export function groupByDay(rows, field = 'spent_on') {
  const out = []; let cur = null;
  for (const r of rows) { if (!cur || cur.day !== r[field]) { cur = { day: r[field], items: [] }; out.push(cur); } cur.items.push(r); }
  return out;
}

/* ---------- Subcategory selects ---------- */
function categoryValueOf(el) { if (el.tagName === 'SELECT') return el.value; const c = el.querySelector('input[type=radio]:checked'); return c ? c.value : ''; }
export function fillSubcategory(el) {
  const sub = document.getElementById(el.dataset.target); if (!sub) return;
  const current = sub.dataset.current || sub.value;
  const list = (CATEGORIES[categoryValueOf(el)] || ['Other']).slice();
  if (current && sub.dataset.current && !list.includes(current)) list.push(current);
  sub.innerHTML = '';
  list.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; if (v === current) o.selected = true; sub.appendChild(o); });
  sub.dataset.current = '';
}
export function wireCategories(root) {
  $$('.category-select, .cat-chips', root).forEach(el => {
    fillSubcategory(el);
    el.addEventListener('change', () => {
      fillSubcategory(el);
      if (categoryValueOf(el) !== 'Uncategorised') { const box = root.querySelector('#manual-needs-review'); if (box) box.checked = false; }
    });
  });
}

/* ---------- Line items ---------- */
export function itemRow(nameField, totalField, name = '', total = '') {
  const row = document.createElement('div'); row.className = 'item-row';
  const n = document.createElement('input'); n.name = nameField; n.placeholder = 'Item'; n.value = name;
  const t = document.createElement('input'); t.name = totalField; t.type = 'number'; t.step = '0.01'; t.inputMode = 'decimal'; t.placeholder = 'Rs'; t.value = total;
  const b = document.createElement('button'); b.type = 'button'; b.className = 'icon-btn sm'; b.textContent = '×'; b.setAttribute('aria-label', 'Remove item');
  b.onclick = () => { const f = row.closest('form'); row.remove(); if (f) f.dispatchEvent(new Event('input', { bubbles: true })); };
  row.append(n, t, b); return row;
}

/* ---------- Toasts ---------- */
export function toast(message, type = 'success') {
  const box = $('.toasts'); if (!box || !message) return;
  const t = document.createElement('div'); t.className = `toast ${type}`; t.setAttribute('role', 'status');
  t.innerHTML = `<span class="toast-ico">${icon(type === 'success' ? 'check' : 'alert', 18)}</span><span class="toast-msg"></span><button type="button" class="toast-x" aria-label="Dismiss">${icon('x', 16)}</button>`;
  t.querySelector('.toast-msg').textContent = message;
  const close = () => { t.classList.add('hide'); setTimeout(() => t.remove(), 300); };
  t.querySelector('.toast-x').onclick = close;
  const olds = [...box.querySelectorAll('.toast:not(.hide)')];
  olds.slice(0, Math.max(0, olds.length - 1)).forEach(o => { o.classList.add('hide'); setTimeout(() => o.remove(), 300); });
  box.appendChild(t);
  setTimeout(close, type === 'error' ? 7000 : 3800);
}

/* ---------- Busy overlay ---------- */
export function showBusy(text, sub) {
  const b = $('#busy'); if (!b) return;
  $('#busy-text').textContent = text || 'Working…'; $('#busy-sub').textContent = sub || '';
  b.hidden = false; requestAnimationFrame(() => b.classList.add('open'));
}
export function setBusySub(sub) { const s = $('#busy-sub'); if (s) s.textContent = sub || ''; }
export function hideBusy() { const b = $('#busy'); if (b) { b.classList.remove('open'); b.hidden = true; } }

/* ---------- Confirmation sheet ---------- */
export function confirmSheet({title='Are you sure?',text='',ok='Confirm',danger=true}={}){
  return new Promise(resolve=>{
    const bd=$('#sheet'); if(!bd){resolve(window.confirm(title+'\n'+text));return;}
    $('#sheet-title').textContent=title; $('#sheet-text').textContent=text;
    const okBtn=$('#sheet-ok'), cancel=$('#sheet-cancel');
    okBtn.textContent=ok; okBtn.className='btn '+(danger?'danger':'primary');
    bd.hidden=false; requestAnimationFrame(()=>bd.classList.add('open'));
    const done=v=>{bd.classList.remove('open');setTimeout(()=>{bd.hidden=true;},200);okBtn.onclick=cancel.onclick=bd.onclick=null;document.removeEventListener('keydown',esc);resolve(v);};
    const esc=e=>{if(e.key==='Escape')done(false);};
    okBtn.onclick=()=>done(true); cancel.onclick=()=>done(false);
    bd.onclick=e=>{if(e.target===bd)done(false);};
    document.addEventListener('keydown',esc); okBtn.focus();
  });
}


/* ---------- Month / date picker (v3.3) ---------- */
export const Picker=(()=>{
  let root,card,state={};
  const SHORT=MONTHS.map(m=>m.slice(0,3));
  function build(){
    root=document.createElement('div'); root.className='picker'; root.hidden=true;
    root.innerHTML='<div class="picker-card" role="dialog" aria-modal="true"></div>';
    card=root.firstChild; document.body.appendChild(root);
    root.addEventListener('click',e=>{if(e.target===root)close();});
    document.addEventListener('keydown',e=>{if(!root.hidden&&e.key==='Escape')close();});
    window.addEventListener('resize',()=>{if(!root.hidden)place();});
  }
  const btn=(label,cls,fn,attrs='')=>`<button type="button" class="${cls}" data-act="${fn}" ${attrs}>${label}</button>`;
  function render(){
    const t=new Date(); t.setHours(0,0,0,0);
    const title=(label,act,aria)=>btn(`${label}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`,'pk-title',act,`aria-label="${aria}"`);
    const head=(prevAria,mid,nextAria)=>`<div class="pk-head">${btn('‹','pk-nav','prev',`aria-label="${prevAria}"`)}${mid}${btn('›','pk-nav','next',`aria-label="${nextAria}"`)}</div>`;
    let h='';
    if(state.view==='years'){
      const start=state.yearPage;
      h=head('Earlier years',`<strong>${start} – ${start+11}</strong>`,'Later years')+'<div class="pk-grid months">';
      for(let y=start;y<start+12;y++){const cls=['pk-cell']; if(y===state.viewYear)cls.push('sel'); if(y===t.getFullYear())cls.push('now');
        h+=btn(y,cls.join(' '),'setYear',`data-v="${y}"`);}
      h+=`</div><div class="pk-foot">${btn('Cancel','pill','close')}${btn('Back','pill','toMonths')}</div>`;
    }else if(state.view==='months'){
      const y=state.viewYear;
      const [sy,sm]=state.mode==='month'?(state.value||'').split('-').map(Number):[state.viewYear,state.viewMonth+1];
      h=head('Previous year',title(y,'toYears','Choose year'),'Next year')+'<div class="pk-grid months">';
      SHORT.forEach((m,i)=>{const cls=['pk-cell']; if(y===sy&&i+1===sm)cls.push('sel'); if(y===t.getFullYear()&&i===t.getMonth())cls.push('now');
        h+=state.mode==='month'?btn(m,cls.join(' '),'pick',`data-v="${y}-${String(i+1).padStart(2,'0')}"`):btn(m,cls.join(' '),'setMonth',`data-v="${i}"`);});
      h+='</div><div class="pk-foot">'+btn('Cancel','pill','close')+(state.mode==='month'
        ?btn('This month','pill','pick',`data-v="${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}"`)
        :btn('Back to days','pill','toDays'))+'</div>';
    }else{
      const y=state.viewYear,m=state.viewMonth, sel=parseISO(state.value);
      const first=new Date(y,m,1), offset=(first.getDay()+6)%7, days=new Date(y,m+1,0).getDate();
      h=head('Previous month',title(`${MONTHS[m]} ${y}`,'toMonths','Choose month and year'),'Next month');
      h+='<div class="pk-grid days">'+['Mo','Tu','We','Th','Fr','Sa','Su'].map(d=>`<span class="pk-dow">${d}</span>`).join('');
      for(let i=0;i<offset;i++) h+='<span></span>';
      for(let d=1;d<=days;d++){const dt=new Date(y,m,d);const cls=['pk-cell'];
        if(sel&&+dt===+sel)cls.push('sel'); if(+dt===+t)cls.push('now');
        h+=btn(d,cls.join(' '),'pick',`data-v="${iso(dt)}"`);}
      const yd=new Date(t); yd.setDate(yd.getDate()-1);
      h+=`</div><div class="pk-foot">${btn('Cancel','pill','close')}${btn('Today','pill','pick',`data-v="${iso(t)}"`)}${btn('Yesterday','pill','pick',`data-v="${iso(yd)}"`)}</div>`;
    }
    card.innerHTML=h;
    card.querySelectorAll('[data-act]').forEach(b=>b.addEventListener('click',()=>{
      const a=b.dataset.act, v=b.dataset.v;
      if(a==='close') return close();
      if(a==='pick'){close(); state.onPick&&state.onPick(v); return;}
      if(a==='toMonths') state.view='months';
      else if(a==='toDays') state.view='days';
      else if(a==='toYears'){state.view='years'; state.yearPage=state.viewYear-7;}
      else if(a==='setYear'){state.viewYear=Number(v); state.view='months';}
      else if(a==='setMonth'){state.viewMonth=Number(v); state.view='days';}
      else{
        const d=a==='next'?1:-1;
        if(state.view==='years') state.yearPage+=12*d;
        else if(state.view==='months') state.viewYear+=d;
        else{state.viewMonth+=d; if(state.viewMonth<0){state.viewMonth=11;state.viewYear--;} if(state.viewMonth>11){state.viewMonth=0;state.viewYear++;}}
      }
      render(); place();
      const f=card.querySelector('.pk-cell.sel')||card.querySelector('.pk-cell.now')||card.querySelector('.pk-cell'); if(f) f.focus({preventScroll:true});
    }));
  }
  function place(){
    const wide=window.matchMedia('(min-width:760px)').matches;
    root.classList.toggle('as-sheet',!wide);
    card.style.left=card.style.top='';
    if(!wide||!state.anchor) return;
    const r=state.anchor.getBoundingClientRect(), w=card.offsetWidth, h=card.offsetHeight;
    let left=Math.min(Math.max(12,r.left+r.width/2-w/2),window.innerWidth-w-12);
    let top=r.bottom+10; if(top+h>window.innerHeight-12) top=Math.max(12,r.top-h-10);
    card.style.left=left+'px'; card.style.top=top+'px';
  }
  function open(o){
    if(!root) build();
    const base=o.mode==='month'?parseISO((o.value||'')+'-01'):parseISO(o.value);
    const d=base||new Date();
    state={...o,viewYear:d.getFullYear(),viewMonth:d.getMonth(),view:o.mode==='month'?'months':'days'};
    render(); root.hidden=false; place(); requestAnimationFrame(()=>root.classList.add('open'));
    const s=card.querySelector('.sel')||card.querySelector('.now'); if(s) s.focus({preventScroll:true});
  }
  function close(){if(!root)return; root.classList.remove('open'); root.hidden=true; if(state.anchor) state.anchor.focus({preventScroll:true});}
  return {open,close};
})();


/* Turn <input type="date"> into a styled button + hidden field with the same YYYY-MM-DD value. */
export function setDateValue(inp,v){
  inp.value=v||'';
  if(inp._btn){
    const d=parseISO(inp.value);
    inp._btn.querySelector('span').textContent=d?fmtDate(d):'Pick a date';
    inp._btn.classList.toggle('is-empty',!d);
    if(d) inp._btn.classList.remove('needs-confirmation','invalid');
  }
  inp.dispatchEvent(new Event('input',{bubbles:true}));
  inp.dispatchEvent(new Event('change',{bubbles:true}));
}
export function enhanceDate(inp){
  const b=document.createElement('button'); b.type='button'; b.className='date-btn '+(inp.className||'');
  b.innerHTML='<svg class="ico" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg><span></span>';
  if(inp.id){b.id=inp.id+'-btn';}
  if(inp.required){inp.dataset.required='1'; inp.required=false;}
  inp.type='hidden'; inp.parentNode.insertBefore(b,inp); inp._btn=b;
  const d=parseISO(inp.value); b.querySelector('span').textContent=d?fmtDate(d):'Pick a date'; b.classList.toggle('is-empty',!d);
  b.addEventListener('click',()=>Picker.open({mode:'date',anchor:b,value:inp.value,onPick:v=>setDateValue(inp,v)}));
}

/* ---------- Image compression for storage (keeps receipts small for sync) ---------- */
export async function compressImage(file, maxSide = 1600, quality = 0.82) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(b => res(b || file), 'image/jpeg', quality));
}
