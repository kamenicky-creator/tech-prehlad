(function(){
'use strict';

const CFG = Object.assign({apiUrl:'/api/data', teamName:'', pollSeconds:60}, window.TECH_CONFIG || {});
const POLL_MS = Math.max(20, Number(CFG.pollSeconds) || 60) * 1000;

const KINDS = [
  {v:'mobil', l:'Mobil'}, {v:'notebook', l:'Notebook'}, {v:'monitor', l:'Monitor'},
  {v:'tablet', l:'Tablet'}, {v:'ine', l:'Iné'}
];
const OWN = [{v:'osobne', l:'Osobné', c:'p-own'}, {v:'firemne', l:'Firemné', c:'p-firm'}];
const PREF = [
  {v:'vlastne', l:'Chcem mať vlastné s firemným zabezpečením', s:'Vlastné so zabezpečením', c:'p-own'},
  {v:'firemne', l:'Chcem mať firemné', s:'Firemné', c:'p-firm'}
];
const KL = Object.fromEntries(KINDS.map(k => [k.v, k.l]));
const OL = Object.fromEntries(OWN.map(k => [k.v, k.l]));
const PL = Object.fromEntries(PREF.map(k => [k.v, k]));
const ERR = {
  proxy_not_configured: 'Server nie je nastavený: vo Verceli chýba GAS_URL alebo GAS_KEY.',
  proxy_key_mismatch: 'Tímový kľúč vo Verceli (GAS_KEY) nesedí s kľúčom v Apps Scripte.',
  not_configured: 'V Apps Scripte ešte nie je vytvorený tímový kľúč.',
  quota_exceeded: 'Tabuľka je plná, ďalšie zariadenia sa nedajú pridať.',
  busy: 'Server je práve zaneprázdnený. Skús to o chvíľu znova.',
  not_found: 'Toto zariadenie medzitým niekto odstránil.',
  bad_request: 'Údaje sa nepodarilo uložiť. Skontroluj, či sú vyplnené všetky polia.',
  unknown_member: 'Toto meno už nie je v zozname tímu. Obnov stránku a vyber meno znova.',
  forbidden: 'Toto zariadenie môže upraviť len ten, kto ho pridal, alebo správca.'
};

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lsGet = k => { try { return localStorage.getItem('techTab.'+k); } catch(e){ return null; } };
const lsSet = (k,v) => { try { localStorage.setItem('techTab.'+k, v); } catch(e){} };
const str = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : '';
const fold = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const collator = new Intl.Collator('sk', {sensitivity:'base'});

const S = { mode:'loading', role:'u', team:[], kto:'', items:[], loaded:false, err:'', busy:0, editId:null, q:'', kind:'', lastOk:0 };
let delId = null;

if(CFG.teamName){ $('#brand').textContent = CFG.teamName + ': prehľad techniky'; document.title = CFG.teamName + ': prehľad techniky'; }

function clean(b){
  if(!b || typeof b !== 'object' || typeof b.id !== 'string' || !b.id) return null;
  return {
    id: b.id.slice(0,40),
    meno: str(b.meno, 40),
    druh: KL[b.druh] ? b.druh : 'ine', nazov: str(b.nazov, 80),
    vlastnictvo: OL[b.vlastnictvo] ? b.vlastnictvo : '',
    preferencia: PL[b.preferencia] ? b.preferencia : '',
    t: typeof b.t === 'number' ? b.t : 0,
    mine: b.mine === true
  };
}
const canEdit = () => S.mode === 'live' || S.mode === 'local';
const isAdmin = () => S.role === 'a' || S.mode === 'local';
const canTouch = x => !!x && canEdit() && (x.mine || isAdmin());

/* ---------- server ---------- */
async function api(action, extra){
  let r;
  try {
    r = await fetch(CFG.apiUrl, {
      method:'POST', credentials:'same-origin', cache:'no-store',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(Object.assign({action}, extra || {}))
    });
  } catch(e){ throw {code:'network'}; }
  if(r.status === 401){
    location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
    throw {code:'login_required'};
  }
  let j = null;
  try { j = await r.json(); } catch(e){ throw {code:'network'}; }
  if(!j || !j.ok) throw {code: (j && j.error) || 'network'};
  return j.data || {};
}
function applyItems(data){
  if(data && (data.role === 'a' || data.role === 'u')) S.role = data.role;
  if(data && Array.isArray(data.team)){
    S.team = data.team.map(m => m && str(m.name, 40)).filter(Boolean);
    renderKto();
  }
  if(data && Array.isArray(data.items)){
    S.items = data.items.map(clean).filter(Boolean);
    S.loaded = true; S.lastOk = Date.now();
    if(S.editId && !S.items.some(x => x.id === S.editId)) stopEdit(true);
  }
}
let loading = false;
async function refresh(){
  if(S.mode === 'local' || loading || S.busy) return;
  loading = true;
  try {
    const d = await api('list');
    if(!S.busy) applyItems(d);
    S.mode = 'live';
    if(S.err && S.err.indexOf('uložiť') === -1) S.err = '';
  } catch(e){
    if(e.code !== 'login_required'){
      S.err = ERR[e.code] || (S.loaded ? 'Spojenie so serverom vypadlo, zoznam môže byť neaktuálny.' : 'Zoznam sa nepodarilo načítať. Skontroluj pripojenie.');
    }
  } finally {
    loading = false;
    render();
  }
}

/* ---------- form ---------- */
function chipsHtml(name, opts, kindClass){
  return opts.map(o => '<label class="chip '+(kindClass ? 'k-'+o.v : o.c)+'"><input type="radio" name="'+name+'" value="'+o.v+'"><span>'+esc(o.l)+'</span></label>').join('');
}
$('#cDruh').innerHTML = chipsHtml('druh', KINDS, true);
$('#cVl').innerHTML = chipsHtml('vl', OWN);
$('#cPref').innerHTML = chipsHtml('pref', PREF);
$('#fKind').innerHTML = '<option value="">Všetky druhy</option>' + KINDS.map(k => '<option value="'+k.v+'">'+k.l+'</option>').join('');
// Zoznam mien. Pri úprave staršieho záznamu sa pridá aj meno, ktoré v zozname tímu už nie je.
function renderKto(extra){
  const sel = $('#fKto'), cur = extra || sel.value || S.kto;
  const names = S.team.slice();
  if(cur && names.indexOf(cur) === -1) names.push(cur);
  sel.innerHTML = '<option value="">' + (names.length ? 'Vyber svoje meno' : 'Zoznam mien je zatiaľ prázdny') + '</option>' +
    names.map(n => '<option value="'+esc(n)+'">'+esc(n)+'</option>').join('');
  sel.value = names.indexOf(cur) !== -1 ? cur : '';
}
renderKto();

const radio = n => { const el = document.querySelector('input[name="'+n+'"]:checked'); return el ? el.value : ''; };
const setRadio = (n, v) => document.querySelectorAll('input[name="'+n+'"]').forEach(el => { el.checked = el.value === v; });
setRadio('pref', lsGet('pref') || '');

function readForm(){
  return {
    meno: $('#fKto').value.slice(0,40),
    druh: radio('druh'), nazov: $('#fNazov').value.trim().slice(0,80),
    vlastnictvo: radio('vl'), preferencia: radio('pref')
  };
}
function validate(d){
  const bad = [];
  const mark = (el, b) => { if(el.tagName === 'FIELDSET') el.classList.toggle('fieldset-bad', b); else el.setAttribute('aria-invalid', String(b)); if(b) bad.push(el); };
  mark($('#fKto'), !d.meno);
  mark($('#fsDruh'), !d.druh); mark($('#fNazov'), !d.nazov);
  mark($('#fsVl'), !d.vlastnictvo); mark($('#fsPref'), !d.preferencia);
  if(bad.length){
    const f = bad[0], target = f.tagName === 'FIELDSET' ? f.querySelector('input') : f;
    if(target) target.focus();
    toast('Vyplň prosím všetky polia.');
    return false;
  }
  return true;
}
function resetDevice(){
  $('#fNazov').value = ''; setRadio('druh',''); setRadio('vl',''); setRadio('pref', lsGet('pref') || '');
  document.querySelectorAll('[aria-invalid]').forEach(el => el.setAttribute('aria-invalid','false'));
  document.querySelectorAll('.fieldset-bad').forEach(el => el.classList.remove('fieldset-bad'));
}
function startEdit(id){
  const it = S.items.find(x => x.id === id);
  if(!canTouch(it)) return;
  S.editId = id;
  renderKto(it.meno); $('#fNazov').value = it.nazov;
  setRadio('druh', it.druh); setRadio('vl', it.vlastnictvo); setRadio('pref', it.preferencia);
  renderForm(); renderList();
  $('#fNazov').focus();
  if(window.matchMedia('(max-width:900px)').matches) $('#formTitle').scrollIntoView({behavior:'smooth', block:'start'});
}
function stopEdit(silent){
  S.editId = null;
  renderKto(S.kto);
  resetDevice();
  if(!silent){ renderForm(); renderList(); }
}

async function submit(){
  if(!canEdit()){ toast(S.loaded ? 'Server je práve nedostupný, skús to o chvíľu.' : 'Zoznam sa ešte načítava.'); return; }
  const d = readForm();
  if(!validate(d)) return;
  lsSet('pref', d.preferencia);
  const editing = S.editId;
  if(!editing) S.kto = d.meno;
  const btn = $('#submit'); btn.disabled = true;
  try {
    await write(async () => {
      if(S.mode === 'local'){
        const id = editing || ('l' + Date.now().toString(36) + Math.random().toString(36).slice(2,6));
        const prev = S.items.find(x => x.id === id);
        const it = clean(Object.assign({id, t: prev ? prev.t : Date.now(), mine: true}, d));
        S.items = S.items.filter(x => x.id !== id).concat([it]);
        saveLocal();
      } else {
        applyItems(editing ? await api('update', {id: editing, item: d}) : await api('add', {item: d}));
      }
    });
    if(editing){ S.editId = null; renderKto(S.kto); toast('Zmena je uložená.'); }
    else toast('Zariadenie je pridané. Môžeš pridať ďalšie.');
    resetDevice(); render();
    $('#fsDruh input').focus();
  } catch(e){ onWriteError(e); }
  finally { btn.disabled = false; }
}
async function remove(id){
  try {
    await write(async () => {
      if(S.mode === 'local'){ S.items = S.items.filter(x => x.id !== id); saveLocal(); }
      else applyItems(await api('delete', {id}));
    });
    if(S.editId === id) stopEdit(true);
    toast('Zariadenie je odstránené.');
    render();
  } catch(e){ onWriteError(e); }
}
async function write(fn){
  S.busy++; renderSync();
  try { await fn(); if(S.err) S.err = ''; }
  finally { S.busy--; renderSync(); }
}
function onWriteError(e){
  const code = e && e.code;
  if(code === 'login_required') return;
  S.err = ERR[code] ? ERR[code] : 'Zmenu sa nepodarilo uložiť. Skontroluj pripojenie a skús to znova.';
  if(code === 'not_found') refresh();
  render();
}

/* ---------- local fallback ---------- */
function startLocal(){
  S.mode = 'local';
  S.team = Array.isArray(CFG.localTeam) ? CFG.localTeam.slice() : ['Ukážka'];
  renderKto();
  let data = null;
  try { data = JSON.parse(lsGet('data') || 'null'); } catch(e){}
  S.items = Array.isArray(data) ? data.map(clean).filter(Boolean) : [];
  S.loaded = true;
  render();
}
function saveLocal(){ lsSet('data', JSON.stringify(S.items)); }

/* ---------- render ---------- */
function render(){ renderSync(); renderRole(); renderStats(); renderForm(); renderList(); }
function renderRole(){ $('#role').hidden = !(S.mode === 'live' && S.role === 'a'); }
function renderSync(){
  const el = $('#sync');
  let t, cls = '';
  if(S.err){ t = S.err; cls = 'err'; }
  else if(S.mode === 'loading'){ t = 'Pripájam sa…'; cls = 'busy'; }
  else if(S.busy){ t = 'Ukladám…'; cls = 'busy'; }
  else if(S.mode === 'local'){ t = 'Ukladá sa len v tomto prehliadači'; cls = 'local'; }
  else t = 'Uložené pre celý tím';
  if(el.textContent !== t) el.textContent = t;
  el.className = 'sync ' + cls;
}
function personKey(x){ return fold(x.meno).replace(/\s+/g,' ').trim(); }
function plural(n){ return n === 1 ? 'zariadenie' : (n >= 2 && n <= 4 ? 'zariadenia' : 'zariadení'); }
// Koľko ľudí z tímu už niečo zapísalo (bez tímu: počet rôznych mien).
function people(it){
  const done = new Set(it.map(personKey));
  return S.team.length ? S.team.filter(n => done.has(personKey({meno:n}))).length : done.size;
}
function renderStats(){
  const it = S.items;
  const st = (n, t, c) => '<div class="stat '+(c||'')+'"><span class="n">'+n+'</span><span class="t">'+t+'</span></div>';
  $('#stats').innerHTML = S.loaded ? (
    st(it.length, plural(it.length)) +
    st(people(it) + (S.team.length ? '<small> / '+S.team.length+'</small>' : ''), 'ľudí sa zapísalo') +
    st(it.filter(x => x.vlastnictvo === 'osobne').length, 'osobných', 'ho') +
    st(it.filter(x => x.vlastnictvo === 'firemne').length, 'firemných', 'o') +
    st(it.filter(x => x.preferencia === 'vlastne').length, 'chce vlastné so zabezpečením', 'ho') +
    st(it.filter(x => x.preferencia === 'firemne').length, 'chce firemné', 'o')
  ) : '';
  const done = new Set(it.map(personKey));
  const missing = S.team.filter(n => !done.has(personKey({meno:n})));
  const m = $('#missing');
  m.hidden = !S.loaded || !S.team.length;
  m.innerHTML = missing.length ? '<b>Ešte sa nezapísali:</b> ' + missing.map(esc).join(', ') : '<b>Zapísal sa celý tím.</b>';
}
function renderForm(){
  const ed = !!S.editId;
  $('#formTitle').textContent = ed ? 'Upraviť zariadenie' : 'Pridať zariadenie';
  $('#formHint').textContent = ed ? 'Uprav údaje a ulož zmenu.' : 'Vyber svoje meno a pridaj zariadenia jedno po druhom.';
  $('#submit').textContent = ed ? 'Uložiť zmenu' : 'Pridať zariadenie';
  $('#cancelEdit').hidden = !ed;
}
function renderList(){
  const wrap = $('#tblWrap');
  $('#exportBtn').hidden = !S.items.length || !isAdmin();
  if(!S.loaded){
    wrap.innerHTML = '<div class="empty"><p>'+(S.err ? esc(S.err) : 'Načítavam zoznam…')+'</p></div>';
    $('#foot').textContent = ''; return;
  }
  const q = fold(S.q);
  const rows = S.items
    .filter(x => !S.kind || x.druh === S.kind)
    .filter(x => !q || fold(x.meno+' '+x.nazov+' '+KL[x.druh]).indexOf(q) !== -1)
    .sort((a,b) => collator.compare(a.meno, b.meno) || KINDS.findIndex(k => k.v === a.druh) - KINDS.findIndex(k => k.v === b.druh) || a.t - b.t);
  if(!S.items.length){
    wrap.innerHTML = '<div class="empty"><p>Zatiaľ tu nie je žiadne zariadenie. Pridaj prvé vo formulári.</p></div>';
    $('#foot').textContent = ''; return;
  }
  if(!rows.length){
    wrap.innerHTML = '<div class="empty"><p>Filtru nezodpovedá žiadne zariadenie.</p></div>';
    $('#foot').textContent = ''; return;
  }
  let h = '<table><thead><tr><th scope="col">Meno</th><th scope="col">Druh</th><th scope="col">Názov zariadenia</th><th scope="col">Vo vlastníctve</th><th scope="col">Preferencia</th><th scope="col" aria-label="Akcie"></th></tr></thead><tbody>';
  rows.forEach(x => {
    const p = PL[x.preferencia];
    h += '<tr'+(x.id === S.editId ? ' class="editing"' : '')+'>' +
      '<td class="who">'+esc(x.meno)+'</td>' +
      '<td><span class="tag k-'+x.druh+'">'+KL[x.druh]+'</span></td>' +
      '<td class="dev">'+esc(x.nazov)+'</td>' +
      '<td class="plain">'+(OL[x.vlastnictvo] || '–')+'</td>' +
      '<td class="pref">'+(p ? esc(p.s) : '–')+'</td>' +
      '<td class="ops">'+(canTouch(x) ? '<button class="btn small" data-edit="'+esc(x.id)+'">Upraviť</button> <button class="btn small danger" data-del="'+esc(x.id)+'">Odstrániť</button>' : '')+'</td>' +
      '</tr>';
  });
  wrap.innerHTML = h + '</tbody></table>';
  const notes = [];
  if(rows.length !== S.items.length) notes.push('Zobrazené ' + rows.length + ' z ' + S.items.length + ' zariadení.');
  if(!isAdmin() && S.items.some(x => !x.mine)) notes.push('Upraviť a odstrániť môžeš zariadenia, ktoré si pridal v tomto prehliadači. Ostatné zmení správca.');
  $('#foot').textContent = notes.join(' ');
}

/* ---------- export ---------- */
function exportCsv(){
  const cell = v => '"' + String(v).replace(/"/g,'""') + '"';
  const lines = [['Meno','Druh zariadenia','Názov zariadenia','Vo vlastníctve','Preferencia'].map(cell).join(';')];
  S.items.slice().sort((a,b) => collator.compare(a.meno, b.meno))
    .forEach(x => lines.push([x.meno, KL[x.druh], x.nazov, OL[x.vlastnictvo] || '', PL[x.preferencia] ? PL[x.preferencia].l : ''].map(cell).join(';')));
  const url = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], {type:'text/csv;charset=utf-8'}));
  const a = document.createElement('a');
  a.href = url; a.download = 'prehlad-techniky.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- events ---------- */
$('#submit').addEventListener('click', submit);
$('#cancelEdit').addEventListener('click', () => stopEdit());
['fNazov'].forEach(id => $('#'+id).addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); submit(); } }));
$('#form').addEventListener('input', e => {
  if(e.target.getAttribute('aria-invalid') === 'true' && e.target.value.trim()) e.target.setAttribute('aria-invalid','false');
  const fs = e.target.closest('fieldset'); if(fs) fs.classList.remove('fieldset-bad');
});
$('#form').addEventListener('change', e => { const fs = e.target.closest('fieldset'); if(fs) fs.classList.remove('fieldset-bad'); });
$('#q').addEventListener('input', e => { S.q = e.target.value; renderList(); });
$('#fKind').addEventListener('change', e => { S.kind = e.target.value; renderList(); });
$('#exportBtn').addEventListener('click', exportCsv);
$('#tblWrap').addEventListener('click', e => {
  const b = e.target.closest('button'); if(!b) return;
  if(b.dataset.edit) startEdit(b.dataset.edit);
  else if(b.dataset.del){
    const it = S.items.find(x => x.id === b.dataset.del); if(!canTouch(it)) return;
    delId = it.id;
    $('#delText').textContent = it.meno + ': ' + KL[it.druh] + ', ' + it.nazov;
    const d = $('#delDlg'); if(typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open','');
  }
});
$('#delNo').addEventListener('click', () => $('#delDlg').close());
$('#delYes').addEventListener('click', () => { const id = delId; delId = null; $('#delDlg').close(); if(id) remove(id); });
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible' && Date.now() - S.lastOk > 15000) refresh(); });

let toastT = 0;
function toast(msg){
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 4200);
}

/* ---------- start ---------- */
render();
if(!CFG.apiUrl){ startLocal(); }
else {
  $('#logout').hidden = false;
  refresh();
  setInterval(() => { if(document.visibilityState === 'visible') refresh(); }, POLL_MS);
}
})();
