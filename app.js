/* Tally — offline, multi-currency bill splitting. All data stays in this browser (localStorage). */
'use strict';

const KEY = 'tally:v1';
const COMMON = ['SGD', 'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'HKD', 'MYR', 'THB', 'IDR', 'PHP', 'VND', 'KRW', 'TWD', 'AUD', 'NZD', 'INR', 'CHF', 'CAD', 'AED'];

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const initial = n => (String(n || '?').trim()[0] || '?').toUpperCase();

const digCache = {};
function digits(cur) {
  if (cur in digCache) return digCache[cur];
  let d = 2;
  try { d = new Intl.NumberFormat('en', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits; } catch (e) { /* unknown code */ }
  return (digCache[cur] = d);
}
function validCur(c) {
  if (!/^[A-Z]{3}$/.test(c)) return false;
  try { new Intl.NumberFormat('en', { style: 'currency', currency: c }); return true; } catch (e) { return false; }
}
const roundC = (n, cur) => { const f = 10 ** digits(cur); return Math.round(n * f) / f; };
function num(n, cur) {
  const d = digits(cur);
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}
const fmt = (n, cur) => `${cur} ${num(Math.abs(n) < 1e-9 ? 0 : n, cur)}`;
function parseNum(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/,/g, '').trim();
  if (!s) return NaN;
  // allow simple arithmetic like "12.5+3*2" for quick totals
  if (/^[\d.+\-*/() ]+$/.test(s)) { try { const r = Function('"use strict";return (' + s + ')')(); return Number.isFinite(r) ? r : NaN; } catch (e) { return NaN; } }
  return NaN;
}
function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return { day: d.getDate(), mon: d.toLocaleString(undefined, { month: 'short' }), full: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) };
}

/* ---------- storage ---------- */
let S = load();
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.groups)) return s;
  } catch (e) { /* ignore */ }
  return { version: 1, groups: [] };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); return true; }
  catch (e) { toast('Could not save — phone storage is full or blocked'); return false; }
}
const group = id => S.groups.find(g => g.id === id);
const member = (g, id) => g.members.find(m => m.id === id);
const mname = (g, id) => (member(g, id)?.name) ?? 'Someone';

/* ---------- money maths ---------- */
// Split total into integer minor units by weight (largest remainder), so shares always add up exactly.
function allocate(total, weights, cur) {
  const f = 10 ** digits(cur), T = Math.round(total * f);
  const W = weights.reduce((a, [, w]) => a + w, 0);
  if (!W || !T) return {};
  const raw = weights.map(([id, w]) => { const x = T * w / W; return { id, fl: Math.floor(x), r: x - Math.floor(x) }; });
  const rem = T - raw.reduce((a, o) => a + o.fl, 0);
  [...raw].sort((a, b) => b.r - a.r).slice(0, rem).forEach(o => o.fl++);
  return Object.fromEntries(raw.map(o => [o.id, o.fl / f]));
}
function sharesOf(e) {
  const p = e.split?.parts || {}, mode = e.split?.mode || 'equal';
  if (mode === 'exact') return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, +v || 0]).filter(([, v]) => v > 0));
  const w = Object.entries(p).map(([k, v]) => [k, mode === 'equal' ? (v ? 1 : 0) : (+v || 0)]).filter(([, x]) => x > 0);
  return allocate(e.amount, w, e.currency);
}
const rateOf = (g, t) => (t.currency === g.base ? 1 : (+t.rate || 0));
const inBase = (g, t, amt = t.amount) => amt * rateOf(g, t);

function balances(g) {
  const b = Object.fromEntries(g.members.map(m => [m.id, 0]));
  const add = (id, v) => { b[id] = (b[id] || 0) + v; };
  for (const t of g.tx) {
    const r = rateOf(g, t);
    if (t.type === 'payment') { add(t.from, t.amount * r); add(t.to, -t.amount * r); }
    else {
      add(t.paidBy, t.amount * r);
      for (const [k, v] of Object.entries(sharesOf(t))) add(k, -v * r);
    }
  }
  const eps = 0.5 / 10 ** digits(g.base);
  for (const k in b) if (Math.abs(b[k]) < eps) b[k] = 0; // drop float dust, keep full precision so totals net to zero
  return b;
}
function settlePlan(b, cur) {
  const eps = 0.5 / 10 ** digits(cur);
  const cr = [], db = [];
  for (const [id, v] of Object.entries(b)) { if (v > eps) cr.push({ id, v }); else if (v < -eps) db.push({ id, v: -v }); }
  cr.sort((a, c) => c.v - a.v); db.sort((a, c) => c.v - a.v);
  const out = []; let i = 0, j = 0;
  while (i < db.length && j < cr.length) {
    const x = Math.min(db[i].v, cr[j].v);
    out.push({ from: db[i].id, to: cr[j].id, amount: roundC(x, cur) });
    db[i].v -= x; cr[j].v -= x;
    if (db[i].v <= eps) i++;
    if (cr[j].v <= eps) j++;
  }
  return out.filter(o => o.amount > 0);
}
function myEffect(g, t) { // effect of one transaction on "me", in base currency
  if (!g.me) return 0;
  const r = rateOf(g, t);
  if (t.type === 'payment') return (t.from === g.me ? t.amount * r : 0) - (t.to === g.me ? t.amount * r : 0);
  return (t.paidBy === g.me ? t.amount * r : 0) - (sharesOf(t)[g.me] || 0) * r;
}
const groupSpend = g => g.tx.filter(t => t.type !== 'payment').reduce((a, t) => a + inBase(g, t), 0);

/* ---------- UI plumbing ---------- */
const view = $('#view'), fab = $('#fab'), sheet = $('#sheet'), sheetForm = $('#sheetForm');
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}
function setBar(title, back) {
  $('#title').textContent = title;
  document.title = title === 'Tally' ? 'Tally — split bills offline' : `${title} · Tally`;
  const b = $('#backBtn'); b.hidden = !back; b.onclick = () => { location.hash = back; };
}
function updateNet() { const n = $('#netBadge'); const on = navigator.onLine; n.textContent = on ? 'Online' : 'Offline'; n.classList.toggle('off', !on); }
addEventListener('online', updateNet); addEventListener('offline', updateNet);

function openSheet(title, body, { submit = 'Save', onSubmit, extra = '', onMount } = {}) {
  sheetForm.innerHTML = `
    <div class="sheet-head"><h2 id="sheetTitle">${esc(title)}</h2>
      <button type="button" class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button></div>
    <div class="sheet-body">${body}</div>
    <div class="sheet-foot">${extra}<button type="submit" class="btn primary" value="ok">${esc(submit)}</button></div>`;
  $('[data-close]', sheetForm).onclick = () => sheet.close();
  sheetForm.onsubmit = ev => { ev.preventDefault(); if (onSubmit && onSubmit() !== false) sheet.close(); };
  sheet.showModal();
  onMount && onMount(sheetForm);
}
sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); });

/* ---------- router ---------- */
function route() {
  const h = location.hash.replace(/^#\/?/, '').split('/');
  fab.hidden = true;
  if (h[0] === 'g' && group(h[1])) return renderGroup(group(h[1]), h[2] || 'activity');
  if (h[0] === 'g') location.hash = '#/';
  renderHome();
}
addEventListener('hashchange', () => { route(); scrollTo(0, 0); });

/* ---------- home ---------- */
function renderHome() {
  setBar('Tally');
  const gs = S.groups;
  const cards = gs.map(g => {
    const b = balances(g), mine = g.me ? b[g.me] || 0 : null;
    const cls = mine == null ? 'zero' : mine > 0 ? 'pos' : mine < 0 ? 'neg' : 'zero';
    const label = mine == null ? `${g.tx.length} item${g.tx.length === 1 ? '' : 's'}` : mine > 0 ? 'you are owed' : mine < 0 ? 'you owe' : 'settled up';
    return `<li><a class="row" href="#/g/${g.id}" style="color:inherit;text-decoration:none">
      <span class="avatar">${esc(initial(g.name))}</span>
      <span class="grow"><span class="t" style="display:block">${esc(g.name)}</span>
      <span class="s" style="display:block">${g.members.length} people · ${esc(g.base)}</span></span>
      <span class="amt ${cls}">${mine ? fmt(Math.abs(mine), g.base) : ''}<small>${label}</small></span></a></li>`;
  }).join('');

  view.innerHTML = `
    ${gs.length ? `<div class="section-h"><h2>Groups</h2></div><ul class="list card">${cards}</ul>
      <div style="margin-top:12px"><button class="btn block" id="newGroup">+ New group</button></div>` :
      `<div class="card empty"><h3>Split bills, even offline</h3>
      <p>Make a group for a trip, a flat or a dinner. Everything you enter is saved on this phone only.</p>
      <button class="btn primary" id="newGroup">Create your first group</button></div>`}
    <div class="section-h"><h2>Your data</h2></div>
    <div class="card">
      <div class="kv"><span>Stored on</span><span class="zero">This device only</span></div>
      <div class="kv"><span>Storage protection</span><span id="persist" class="zero">Checking…</span></div>
      <div class="pad btn-row" style="border-top:1px solid var(--line)">
        <button class="btn small" id="exportAll">Back up to file</button>
        <button class="btn small" id="importAll">Restore from file</button>
      </div>
    </div>
    <p class="note">Tip: add Tally to your home screen (Share → Add to Home Screen on iPhone, or ⋮ → Install app on Android) so it opens like an app and works with no signal. Back up now and then — clearing browser data erases it.</p>`;

  $('#newGroup').onclick = newGroupSheet;
  $('#exportAll').onclick = exportAll;
  $('#importAll').onclick = () => $('#importFile').click();
  checkPersist();
}
async function checkPersist() {
  const el = $('#persist'); if (!el) return;
  if (!navigator.storage?.persisted) { el.textContent = 'Not supported'; return; }
  let p = await navigator.storage.persisted();
  if (!p && navigator.storage.persist) p = await navigator.storage.persist().catch(() => false);
  el.textContent = p ? 'On — won’t be auto-cleared' : 'Best effort';
  el.className = p ? 'pos' : 'zero';
}

function curInput(name, value, extra = '') {
  return `<input class="in cur" name="${name}" value="${esc(value)}" list="curList" maxlength="3" autocomplete="off" autocapitalize="characters" spellcheck="false" ${extra}>
    <datalist id="curList">${COMMON.map(c => `<option value="${c}">`).join('')}</datalist>`;
}

function newGroupSheet() {
  openSheet('New group', `
    <label class="f">Group name<input class="in" name="name" required placeholder="e.g. Japan trip, Flat 12B"></label>
    <label class="f">Main currency (balances are shown in this)<div class="pair">${curInput('base', 'SGD')}</div></label>
    <label class="f">Your name<input class="in" name="me" placeholder="Me" value="Me"></label>
    <label class="f">Others — one name per line<textarea class="in" name="others" placeholder="Alex&#10;Sam&#10;Priya"></textarea></label>`, {
    submit: 'Create group',
    onSubmit() {
      const f = sheetForm.elements, name = f.name.value.trim(), base = f.base.value.trim().toUpperCase();
      if (!name) { f.name.classList.add('invalid'); f.name.focus(); return false; }
      if (!validCur(base)) { f.base.classList.add('invalid'); toast('Use a 3-letter currency code, e.g. SGD'); return false; }
      const meName = f.me.value.trim() || 'Me';
      const others = f.others.value.split(/\n|,/).map(s => s.trim()).filter(Boolean);
      const me = { id: uid(), name: meName };
      const g = { id: uid(), name, base, members: [me, ...others.map(n => ({ id: uid(), name: n }))], me: me.id, rates: {}, tx: [], createdAt: Date.now() };
      S.groups.unshift(g); save();
      location.hash = `#/g/${g.id}`;
    },
    onMount: () => sheetForm.elements.name.focus()
  });
}

/* ---------- group ---------- */
function renderGroup(g, tab) {
  setBar(g.name, '#/');
  const tabs = [['activity', 'Activity'], ['balances', 'Balances'], ['rates', 'Rates'], ['people', 'Group']];
  const nav = `<nav class="tabs">${tabs.map(([k, l]) => `<a href="#/g/${g.id}/${k}" ${k === tab ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
  fab.hidden = false; $('#fabLabel').textContent = 'Add expense';
  fab.onclick = () => txSheet(g);
  const body = { activity: activityTab, balances: balancesTab, rates: ratesTab, people: peopleTab }[tab] || activityTab;
  view.innerHTML = nav + body(g);
  bindGroup(g, tab);
}

function activityTab(g) {
  const b = balances(g), mine = g.me ? b[g.me] || 0 : 0;
  const hero = `<div class="card hero">
    <span class="label">${!g.me ? 'Total group spend' : mine > 0 ? 'Overall, you are owed' : mine < 0 ? 'Overall, you owe' : 'You are all settled up'}</span>
    <span class="big ${!g.me ? '' : mine > 0 ? 'pos' : mine < 0 ? 'neg' : 'zero'}">${fmt(g.me ? Math.abs(mine) : groupSpend(g), g.base)}</span>
    ${g.me ? `<span class="label">Group spend ${fmt(groupSpend(g), g.base)}</span>` : ''}</div>`;
  if (!g.tx.length) return hero + `<div class="empty"><h3>No expenses yet</h3><p>Tap “Add expense” to log the first bill.</p></div>`;

  const sorted = [...g.tx].sort((a, c) => (c.date || '').localeCompare(a.date || '') || c.createdAt - a.createdAt);
  let lastMonth = '', html = hero;
  for (const t of sorted) {
    const d = new Date(t.date + 'T00:00:00');
    const mk = d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
    if (mk !== lastMonth) { html += `${lastMonth ? '</ul>' : ''}<div class="section-h"><h2>${esc(mk)}</h2></div><ul class="list card">`; lastMonth = mk; }
    const fd = fmtDate(t.date), eff = myEffect(g, t);
    const conv = t.currency !== g.base ? `<small>≈ ${fmt(inBase(g, t), g.base)}</small>` : '';
    let title, sub, right;
    if (t.type === 'payment') {
      title = `${esc(mname(g, t.from))} paid ${esc(mname(g, t.to))}`;
      sub = esc(t.desc || 'Settlement');
      right = `<span class="amt zero">${fmt(t.amount, t.currency)}${conv}</span>`;
    } else {
      title = esc(t.desc || 'Expense');
      sub = `${esc(mname(g, t.paidBy))} paid ${fmt(t.amount, t.currency)}`;
      const cls = eff > 0 ? 'pos' : eff < 0 ? 'neg' : 'zero';
      const lab = !g.me ? '' : eff > 0 ? 'you lent' : eff < 0 ? 'you borrowed' : 'not involved';
      right = `<span class="amt ${cls}">${g.me && Math.abs(eff) > 1e-9 ? fmt(Math.abs(eff), g.base) : (g.me ? '' : fmt(t.amount, t.currency))}<small>${lab || (t.currency !== g.base ? '≈ ' + fmt(inBase(g, t), g.base) : '')}</small></span>`;
    }
    html += `<li><button class="row" data-tx="${t.id}"><span class="date-chip">${esc(fd.mon)}<b>${fd.day}</b></span>
      <span class="grow"><span class="t" style="display:block">${title}</span><span class="s" style="display:block">${sub}</span></span>${right}</button></li>`;
  }
  return html + '</ul>';
}

function balancesTab(g) {
  const b = balances(g), plan = settlePlan(b, g.base);
  const max = Math.max(1e-9, ...Object.values(b).map(Math.abs));
  const rows = g.members.map(m => {
    const v = b[m.id] || 0, cls = v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero';
    const w = Math.abs(v) / max * 50;
    const bar = `<div class="bal-bar"><i style="background:var(${v >= 0 ? '--owed' : '--owe'});${v >= 0 ? 'left:50%' : `left:${50 - w}%`};width:${w}%"></i></div>`;
    return `<li class="row"><span class="avatar">${esc(initial(m.name))}</span>
      <span class="grow"><span class="t" style="display:block">${esc(m.name)}${m.id === g.me ? ' <span class="tag">you</span>' : ''}</span>${bar}</span>
      <span class="amt ${cls}">${v ? fmt(Math.abs(v), g.base) : '—'}<small>${v > 0 ? 'gets back' : v < 0 ? 'owes' : 'settled'}</small></span></li>`;
  }).join('');
  const planHtml = plan.length ? `<ul class="list card">${plan.map((p, i) => `<li class="row">
      <span class="grow"><span class="t" style="display:block">${esc(mname(g, p.from))} → ${esc(mname(g, p.to))}</span>
      <span class="s amt" style="display:block;text-align:left">${fmt(p.amount, g.base)}</span></span>
      <button class="btn small" data-settle="${i}">Record</button></li>`).join('')}</ul>
      <p class="note">Fewest payments needed to clear every balance. “Record” logs it as a payment in ${esc(g.base)}.</p>` :
    `<div class="card empty" style="padding:24px"><h3>All settled up</h3><p style="margin:0">Nobody owes anything.</p></div>`;
  return `<div class="section-h"><h2>Balances in ${esc(g.base)}</h2></div><ul class="list card">${rows}</ul>
    <div class="section-h"><h2>Settle up</h2><button class="btn small" id="manualPay">+ Payment</button></div>${planHtml}`;
}

function ratesTab(g) {
  const used = [...new Set(g.tx.map(t => t.currency).filter(c => c !== g.base))];
  const curs = [...new Set([...Object.keys(g.rates), ...used])].sort();
  const rows = curs.map(c => {
    const r = g.rates[c];
    const n = g.tx.filter(t => t.currency === c).length;
    return `<li class="pad stack" data-cur="${c}">
      ${rateLine(g, c, r)}
      <div class="btn-row">${n ? `<button class="btn small" data-apply="${c}">Use for all ${n} ${c} item${n === 1 ? '' : 's'}</button>` : ''}
      <button class="btn small danger" data-delrate="${c}" ${n ? 'disabled title="In use"' : ''}>Remove</button></div></li>`;
  }).join('');
  return `<div class="section-h"><h2>Exchange rates → ${esc(g.base)}</h2></div>
    ${curs.length ? `<ul class="list card">${rows}</ul>` : `<div class="card empty" style="padding:24px"><p style="margin:0">No foreign currencies yet. Add one below, or just pick a currency when you add an expense.</p></div>`}
    <div class="card pad stack" style="margin-top:12px">
      <div class="pair">${curInput('newCur', '', 'id="newCur" placeholder="USD"')}<input class="in num grow" id="newRate" inputmode="decimal" placeholder="in ${esc(g.base)}"><button class="btn" id="addRate">Add</button></div>
    </div>
    <p class="note">You set the rates — nothing is fetched from the internet. Each expense keeps the rate it was entered with, so changing a rate here only affects new expenses unless you tap “Use for all”.</p>`;
}

const rateDirs = {};
const nice = v => +(+v).toPrecision(6);
function rateLine(g, c, r) {
  const dir = rateDirs[g.id + c] || (r && r < 1 ? 'inv' : 'fwd');
  const shown = r ? (dir === 'fwd' ? nice(r) : nice(1 / r)) : '';
  return `<div class="rate-line"><span>1 ${dir === 'fwd' ? c : esc(g.base)} =</span><input class="in num" inputmode="decimal" data-rate="${c}" data-dir="${dir}" value="${shown}" placeholder="rate"><span>${dir === 'fwd' ? esc(g.base) : c}</span>
      <button type="button" class="swap" data-flip="${c}" aria-label="Flip rate direction">⇄</button></div>
    <div class="rate-hint" data-hint="${c}">${r ? (dir === 'fwd' ? `1 ${esc(g.base)} = ${nice(1 / r)} ${c}` : `1 ${c} = ${nice(r)} ${esc(g.base)}`) : 'No rate saved yet'}</div>`;
}

function peopleTab(g) {
  const b = balances(g);
  const used = new Set(g.tx.flatMap(t => t.type === 'payment' ? [t.from, t.to] : [t.paidBy, ...Object.keys(t.split?.parts || {}).filter(k => t.split.parts[k])]));
  const rows = g.members.map(m => `<div class="member-row">
    <input class="in" data-mname="${m.id}" value="${esc(m.name)}" aria-label="Name">
    <button class="btn small danger" data-mdel="${m.id}" ${used.has(m.id) || Math.abs(b[m.id] || 0) > 0 ? 'disabled title="Has transactions"' : ''}>Remove</button></div>`).join('');
  return `<div class="section-h"><h2>Group</h2></div>
    <div class="card pad stack">
      <label class="f">Name<input class="in" id="gName" value="${esc(g.name)}"></label>
      <label class="f">Which one is you?<select class="in" id="gMe"><option value="">— nobody (just tracking) —</option>
        ${g.members.map(m => `<option value="${m.id}" ${m.id === g.me ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
      <label class="f">Main currency<div class="pair">${curInput('gBase', g.base, `id="gBase" ${g.tx.length ? 'disabled' : ''}`)}</div></label>
      ${g.tx.length ? '<span class="note" style="margin:0">Main currency is locked once a group has expenses.</span>' : ''}
    </div>
    <div class="section-h"><h2>People</h2></div>
    <div class="card">${rows}
      <div class="member-row" style="border-top:1px solid var(--line)"><input class="in" id="newMember" placeholder="Add a person"><button class="btn small" id="addMember">Add</button></div></div>
    <div class="section-h"><h2>Export</h2></div>
    <div class="card pad btn-row"><button class="btn small" id="csv">Download CSV</button><button class="btn small" id="share">Share summary</button></div>
    <div class="section-h"><h2>Danger zone</h2></div>
    <div class="card pad"><button class="btn danger block" id="delGroup">Delete this group</button></div>`;
}

function bindGroup(g, tab) {
  $$('[data-tx]').forEach(el => el.onclick = () => txSheet(g, g.tx.find(t => t.id === el.dataset.tx)));
  if (tab === 'balances') {
    const plan = settlePlan(balances(g), g.base);
    $$('[data-settle]').forEach(el => el.onclick = () => {
      const p = plan[+el.dataset.settle];
      txSheet(g, null, { type: 'payment', from: p.from, to: p.to, amount: p.amount, currency: g.base });
    });
    $('#manualPay').onclick = () => txSheet(g, null, { type: 'payment' });
  }
  if (tab === 'rates') {
    $$('[data-rate]').forEach(inp => {
      inp.oninput = () => {
        const c = inp.dataset.rate, v = parseNum(inp.value), fwd = inp.dataset.dir === 'fwd';
        const hint = $(`[data-hint="${c}"]`);
        if (v > 0) { const r = fwd ? v : 1 / v; g.rates[c] = r; save(); hint.textContent = fwd ? `1 ${g.base} = ${nice(1 / r)} ${c}` : `1 ${c} = ${nice(r)} ${g.base}`; inp.classList.remove('invalid'); }
        else inp.classList.add('invalid');
      };
    });
    $$('[data-flip]').forEach(b => b.onclick = () => {
      const c = b.dataset.flip, cur = $(`[data-rate="${c}"]`).dataset.dir;
      rateDirs[g.id + c] = cur === 'fwd' ? 'inv' : 'fwd'; route();
    });
    $$('[data-apply]').forEach(b => b.onclick = () => {
      const c = b.dataset.apply, r = g.rates[c];
      if (!(r > 0)) return toast('Enter a rate first');
      if (!confirm(`Re-value every ${c} item at 1 ${c} = ${r} ${g.base}? This changes balances.`)) return;
      g.tx.forEach(t => { if (t.currency === c) t.rate = r; }); save(); toast('Rate applied'); route();
    });
    $$('[data-delrate]').forEach(b => b.onclick = () => { delete g.rates[b.dataset.delrate]; save(); route(); });
    $('#addRate').onclick = () => {
      const c = $('#newCur').value.trim().toUpperCase(), r = parseNum($('#newRate').value);
      if (!validCur(c) || c === g.base) return toast(c === g.base ? `${c} is already the main currency` : 'Use a 3-letter currency code');
      if (!(r > 0)) return toast('Enter how much 1 ' + c + ' is in ' + g.base);
      g.rates[c] = r; save(); route();
    };
  }
  if (tab === 'people') {
    $('#gName').onchange = e => { const v = e.target.value.trim(); if (v) { g.name = v; save(); setBar(g.name, '#/'); } };
    $('#gMe').onchange = e => { g.me = e.target.value || null; save(); };
    const gb = $('#gBase'); if (gb) gb.onchange = e => {
      const v = e.target.value.trim().toUpperCase();
      if (validCur(v)) { delete g.rates[v]; g.base = v; save(); toast('Main currency set to ' + v); } else { toast('Use a 3-letter code'); e.target.value = g.base; }
    };
    $$('[data-mname]').forEach(i => i.onchange = () => { const m = member(g, i.dataset.mname), v = i.value.trim(); if (v) { m.name = v; save(); } else i.value = m.name; });
    $$('[data-mdel]').forEach(b => b.onclick = () => {
      g.members = g.members.filter(m => m.id !== b.dataset.mdel); if (g.me === b.dataset.mdel) g.me = null; save(); route();
    });
    const addM = () => { const v = $('#newMember').value.trim(); if (!v) return; g.members.push({ id: uid(), name: v }); save(); route(); };
    $('#addMember').onclick = addM;
    $('#newMember').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addM(); } };
    $('#csv').onclick = () => exportCSV(g);
    $('#share').onclick = () => shareSummary(g);
    $('#delGroup').onclick = () => {
      if (!confirm(`Delete “${g.name}” and all ${g.tx.length} transactions from this phone? This can't be undone.`)) return;
      S.groups = S.groups.filter(x => x !== g); save(); location.hash = '#/';
    };
  }
}

/* ---------- add / edit transaction ---------- */
function txSheet(g, existing, preset = {}) {
  if (g.members.length < 2) { toast('Add at least two people first'); location.hash = `#/g/${g.id}/people`; return; }
  const t = existing ? structuredClone(existing) : {
    type: 'expense', desc: '', amount: '', currency: g.lastCur || g.base, rate: '', date: today(),
    paidBy: g.me || g.members[0].id, split: { mode: 'equal', parts: Object.fromEntries(g.members.map(m => [m.id, true])) },
    from: g.me || g.members[0].id, to: g.members.find(m => m.id !== (g.me || g.members[0].id))?.id, ...preset
  };
  if (!t.split) t.split = { mode: 'equal', parts: Object.fromEntries(g.members.map(m => [m.id, true])) };
  if (!t.paidBy) t.paidBy = g.me || g.members[0].id;
  if (!t.rate && t.currency !== g.base) t.rate = g.rates[t.currency] || '';
  let commit = () => false;
  let rateDir = t.rate && t.rate < 1 ? 'inv' : 'fwd'; // fwd: 1 CUR = x BASE ; inv: 1 BASE = x CUR
  const memberOpts = sel => g.members.map(m => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${esc(m.name)}${m.id === g.me ? ' (you)' : ''}</option>`).join('');

  const body = `
    <div class="seg" role="group" aria-label="Type">
      <button type="button" data-type="expense" aria-pressed="${t.type !== 'payment'}">Expense</button>
      <button type="button" data-type="payment" aria-pressed="${t.type === 'payment'}">Payment</button></div>
    <div data-show="expense"><label class="f">What was it?<input class="in" name="desc" value="${esc(t.type !== 'payment' ? t.desc : '')}" placeholder="Dinner, taxi, hotel…" autocomplete="off"></label></div>
    <div data-show="payment" class="pair">
      <label class="f grow">From<select class="in" name="from">${memberOpts(t.from)}</select></label>
      <label class="f grow">To<select class="in" name="to">${memberOpts(t.to)}</select></label></div>
    <label class="f">Amount<div class="pair">${curInput('currency', t.currency)}<input class="in num grow" name="amount" inputmode="decimal" value="${t.amount === '' ? '' : t.amount}" placeholder="0.00" autocomplete="off"></div></label>
    <div class="rate-box" id="rateBox">
      <div class="rate-line"><span id="rateL"></span><input class="in num" name="rate" inputmode="decimal" autocomplete="off"><span id="rateR"></span>
        <button type="button" class="swap" id="swapDir" aria-label="Flip rate direction">⇄</button></div>
      <div class="rate-hint" id="rateHint"></div></div>
    <div class="pair">
      <label class="f grow" data-show="expense">Paid by<select class="in" name="paidBy">${memberOpts(t.paidBy)}</select></label>
      <label class="f grow">Date<input class="in" type="date" name="date" value="${esc(t.date)}"></label></div>
    <div data-show="payment"><label class="f">Note (optional)<input class="in" name="note" value="${esc(t.type === 'payment' ? t.desc : '')}" placeholder="Bank transfer, PayNow…"></label></div>
    <div data-show="expense" class="stack">
      <div class="seg" role="group" aria-label="Split method">
        ${[['equal', 'Equally'], ['exact', 'Amounts'], ['percent', '%'], ['shares', 'Shares']].map(([k, l]) => `<button type="button" data-mode="${k}" aria-pressed="${t.split.mode === k}">${l}</button>`).join('')}</div>
      <div class="split-list" id="splitList"></div>
      <div class="remain" id="remain"></div></div>`;

  openSheet(existing ? (t.type === 'payment' ? 'Edit payment' : 'Edit expense') : (t.type === 'payment' ? 'Record payment' : 'Add expense'), body, {
    extra: existing ? '<button type="button" class="btn danger" id="delTx">Delete</button>' : '',
    onSubmit: () => commit(),
    onMount(form) {
      const F = form.elements;
      // keep split parts for all members
      g.members.forEach(m => { if (!(m.id in t.split.parts)) t.split.parts[m.id] = t.split.mode === 'equal' ? false : ''; });

      const setType = ty => {
        t.type = ty;
        $$('[data-type]', form).forEach(b => b.setAttribute('aria-pressed', b.dataset.type === ty));
        $$('[data-show]', form).forEach(el => el.hidden = el.dataset.show !== ty);
        $('#sheetTitle').textContent = (existing ? 'Edit ' : ty === 'payment' ? 'Record ' : 'Add ') + ty;
      };
      $$('[data-type]', form).forEach(b => b.onclick = () => setType(b.dataset.type));

      const cur = () => F.currency.value.trim().toUpperCase();
      const showRate = () => {
        const c = cur(), box = $('#rateBox');
        box.hidden = !validCur(c) || c === g.base;
        if (box.hidden) return;
        $('#rateL').textContent = rateDir === 'fwd' ? `1 ${c} =` : `1 ${g.base} =`;
        $('#rateR').textContent = rateDir === 'fwd' ? g.base : c;
        const r = +t.rate;
        F.rate.value = r > 0 ? (rateDir === 'fwd' ? nice(r) : nice(1 / r)) : '';
        rateHint();
      };
      const rateHint = () => {
        const c = cur(), r = +t.rate, a = parseNum(F.amount.value);
        const h = $('#rateHint');
        if (!(r > 0)) { h.innerHTML = `<span class="neg">Enter the exchange rate you got.</span>${g.rates[c] ? '' : ' It’s saved for next time.'}`; return; }
        h.textContent = (rateDir === 'fwd' ? `1 ${g.base} = ${+(1 / r).toPrecision(6)} ${c}` : `1 ${c} = ${+r.toPrecision(6)} ${g.base}`) +
          (a > 0 ? ` · ${fmt(a, c)} ≈ ${fmt(a * r, g.base)}` : '');
      };
      F.currency.oninput = () => {
        const c = cur(); F.currency.classList.toggle('invalid', c.length === 3 && !validCur(c));
        if (validCur(c)) { t.currency = c; t.rate = c === g.base ? '' : (g.rates[c] || ''); if (t.rate) rateDir = t.rate < 1 ? 'inv' : 'fwd'; showRate(); drawSplit(); }
      };
      F.rate.oninput = () => {
        const v = parseNum(F.rate.value);
        t.rate = v > 0 ? (rateDir === 'fwd' ? v : 1 / v) : '';
        F.rate.classList.toggle('invalid', F.rate.value !== '' && !(v > 0));
        rateHint();
      };
      $('#swapDir').onclick = () => { rateDir = rateDir === 'fwd' ? 'inv' : 'fwd'; showRate(); };
      F.amount.oninput = () => { rateHint(); drawSplit(); };
      F.amount.onblur = () => { const v = parseNum(F.amount.value); if (v > 0 && /[+\-*/]/.test(F.amount.value)) { F.amount.value = roundC(v, cur()); drawSplit(); } };

      $$('[data-mode]', form).forEach(b => b.onclick = () => {
        const mode = b.dataset.mode; if (mode === t.split.mode) return;
        const on = g.members.filter(m => t.split.mode === 'equal' ? t.split.parts[m.id] : +t.split.parts[m.id] > 0).map(m => m.id);
        const ids = on.length ? on : g.members.map(m => m.id);
        t.split.mode = mode;
        t.split.parts = Object.fromEntries(g.members.map(m => [m.id, mode === 'equal' ? ids.includes(m.id) : mode === 'shares' ? (ids.includes(m.id) ? 1 : '') : '']));
        if (mode === 'percent' && ids.length) { const each = allocate(100, ids.map(i => [i, 1]), 'USD'); Object.assign(t.split.parts, each); }
        $$('[data-mode]', form).forEach(x => x.setAttribute('aria-pressed', x.dataset.mode === mode));
        drawSplit();
      });

      function drawSplit() {
        const mode = t.split.mode, c = validCur(cur()) ? cur() : g.base, amt = parseNum(F.amount.value) || 0;
        const preview = sharesOf({ amount: amt, currency: c, split: t.split });
        $('#splitList').innerHTML = g.members.map(m => {
          const v = t.split.parts[m.id];
          const ctl = mode === 'equal'
            ? `<input type="checkbox" data-part="${m.id}" ${v ? 'checked' : ''} aria-label="Include ${esc(m.name)}">`
            : `<input class="in num" data-part="${m.id}" inputmode="decimal" value="${v === '' || v == null ? '' : v}" placeholder="0" aria-label="${esc(m.name)}">`;
          return `<label class="split-row">${mode === 'equal' ? ctl : ''}<span class="name">${esc(m.name)}</span>
            ${mode !== 'exact' ? `<span class="share" data-share="${m.id}">${preview[m.id] ? num(preview[m.id], c) : '—'}</span>` : ''}${mode !== 'equal' ? ctl : ''}</label>`;
        }).join('');
        $$('[data-part]', form).forEach(inp => {
          inp.oninput = inp.onchange = () => {
            t.split.parts[inp.dataset.part] = inp.type === 'checkbox' ? inp.checked : inp.value;
            refresh();
          };
        });
        refresh();
      }
      function refresh() {
        const mode = t.split.mode, c = validCur(cur()) ? cur() : g.base, amt = parseNum(F.amount.value) || 0;
        const preview = sharesOf({ amount: amt, currency: c, split: { mode, parts: Object.fromEntries(Object.entries(t.split.parts).map(([k, v]) => [k, mode === 'equal' ? v : parseNum(v) || 0])) } });
        $$('[data-share]', form).forEach(s => { const v = preview[s.dataset.share]; s.textContent = v ? num(v, c) : '—'; });
        const r = $('#remain'); r.className = 'remain';
        const vals = Object.values(t.split.parts);
        if (mode === 'equal') { const n = vals.filter(Boolean).length; r.textContent = n ? `${n} ${n === 1 ? 'person' : 'people'} · ${amt ? fmt(amt / n, c) + ' each' : ''}` : 'Pick at least one person'; if (!n) r.classList.add('bad'); }
        if (mode === 'exact') { const s = vals.reduce((a, v) => a + (parseNum(v) || 0), 0), left = roundC(amt - s, c); r.textContent = Math.abs(left) < 1e-9 ? `Adds up to ${fmt(amt, c)} ✓` : `${fmt(Math.abs(left), c)} ${left > 0 ? 'left to assign' : 'too much'}`; r.classList.add(Math.abs(left) < 1e-9 && amt > 0 ? 'ok' : 'bad'); }
        if (mode === 'percent') { const s = vals.reduce((a, v) => a + (parseNum(v) || 0), 0), left = Math.round((100 - s) * 1e6) / 1e6; r.textContent = Math.abs(left) < 1e-6 ? '100% ✓' : `${Math.abs(left)}% ${left > 0 ? 'left' : 'over'}`; r.classList.add(Math.abs(left) < 1e-6 ? 'ok' : 'bad'); }
        if (mode === 'shares') { const s = vals.reduce((a, v) => a + (parseNum(v) || 0), 0); r.textContent = s ? `${s} share${s === 1 ? '' : 's'} total` : 'Give someone a share'; if (!s) r.classList.add('bad'); }
      }

      commit = function () {
        const c = cur(), amount = roundC(parseNum(F.amount.value), validCur(c) ? c : g.base);
        if (!validCur(c)) { F.currency.classList.add('invalid'); toast('Use a 3-letter currency code'); return false; }
        if (!(amount > 0)) { F.amount.classList.add('invalid'); F.amount.focus(); toast('Enter an amount'); return false; }
        if (c !== g.base && !(+t.rate > 0)) { F.rate.classList.add('invalid'); F.rate.focus(); toast('Enter the exchange rate'); return false; }
        const out = {
          id: existing?.id || uid(), createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now(),
          type: t.type, amount, currency: c, rate: c === g.base ? 1 : +t.rate, date: F.date.value || today()
        };
        if (t.type === 'payment') {
          if (F.from.value === F.to.value) { toast('Pick two different people'); return false; }
          Object.assign(out, { from: F.from.value, to: F.to.value, desc: F.note.value.trim() });
        } else {
          const mode = t.split.mode;
          const parts = Object.fromEntries(g.members.map(m => [m.id, mode === 'equal' ? !!t.split.parts[m.id] : (parseNum(t.split.parts[m.id]) || 0)]).filter(([, v]) => v));
          const sum = Object.values(parts).reduce((a, v) => a + (+v || 0), 0);
          if (!Object.keys(parts).length) { toast('Pick who shares this'); return false; }
          if (mode === 'exact' && Math.abs(roundC(sum, c) - amount) > 1e-9) { toast(`Amounts must add up to ${fmt(amount, c)}`); return false; }
          if (mode === 'percent' && Math.abs(sum - 100) > 1e-6) { toast('Percentages must add up to 100'); return false; }
          Object.assign(out, { desc: F.desc.value.trim() || 'Expense', paidBy: F.paidBy.value, split: { mode, parts } });
        }
        if (c !== g.base) g.rates[c] = out.rate;
        g.lastCur = c;
        if (existing) g.tx[g.tx.findIndex(x => x.id === existing.id)] = out; else g.tx.push(out);
        save(); toast(existing ? 'Saved' : t.type === 'payment' ? 'Payment recorded' : 'Expense added'); route();
      }

      if (existing) $('#delTx').onclick = () => {
        if (!confirm('Delete this item?')) return;
        g.tx = g.tx.filter(x => x.id !== existing.id); save(); sheet.close(); toast('Deleted'); route();
      };

      setType(t.type); showRate(); drawSplit();
      if (!existing) (t.type === 'payment' ? F.amount : F.desc).focus();
    }
  });
}

/* ---------- backup / export ---------- */
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function exportAll() {
  download(`tally-backup-${today()}.json`, JSON.stringify({ app: 'tally', exportedAt: new Date().toISOString(), ...S }, null, 2), 'application/json');
  toast('Backup file saved');
}
$('#importFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.groups)) throw new Error('bad');
    const ids = new Set(S.groups.map(g => g.id));
    const fresh = data.groups.filter(g => !ids.has(g.id)), clash = data.groups.length - fresh.length;
    let msg = `Restore ${data.groups.length} group(s) from this file?`;
    if (clash) msg += `\n\n${clash} already exist here — OK replaces them with the file's version.`;
    if (!confirm(msg)) return;
    const incoming = new Map(data.groups.map(g => [g.id, g]));
    S.groups = [...fresh, ...S.groups.map(g => incoming.get(g.id) || g)];
    save(); toast('Restored'); route();
  } catch (err) { toast('That file isn’t a Tally backup'); }
};
function exportCSV(g) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Date', 'Type', 'Description', 'Paid by / From', 'To', 'Amount', 'Currency', `Rate to ${g.base}`, `Amount in ${g.base}`, ...g.members.map(m => `${m.name} share (${g.base})`)];
  const rows = [...g.tx].sort((a, b) => a.date.localeCompare(b.date)).map(t => {
    const r = rateOf(g, t), sh = t.type === 'payment' ? {} : sharesOf(t);
    return [t.date, t.type, t.desc, mname(g, t.type === 'payment' ? t.from : t.paidBy), t.type === 'payment' ? mname(g, t.to) : '',
      t.amount, t.currency, r, roundC(t.amount * r, g.base), ...g.members.map(m => sh[m.id] ? roundC(sh[m.id] * r, g.base) : '')];
  });
  download(`${g.name.replace(/[^\w-]+/g, '_')}-${today()}.csv`, [head, ...rows].map(r => r.map(q).join(',')).join('\n'), 'text/csv');
}
async function shareSummary(g) {
  const plan = settlePlan(balances(g), g.base);
  const text = `${g.name} — ${fmt(groupSpend(g), g.base)} spent\n` +
    (plan.length ? plan.map(p => `• ${mname(g, p.from)} pays ${mname(g, p.to)} ${fmt(p.amount, g.base)}`).join('\n') : 'All settled up!');
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); toast('Summary copied'); }
  } catch (e) { /* cancelled */ }
}

/* ---------- boot ---------- */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
updateNet();
route();
