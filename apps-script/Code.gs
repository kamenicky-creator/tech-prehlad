/**
 * Prehľad techniky: server v Google Apps Scripte.
 *
 * Dáta sú v Google tabuľke, ku ktorej je skript pripojený:
 *   hárok „Technika“  id | meno | druh | nazov | stav | vlastnictvo | preferencia | pridane | upravene | vlastnik
 *   hárok „Tím“       id | meno | aktivny   zoznam mien, z ktorých sa v prehľade vyberá
 *
 * Stĺpec „vlastnik“ je interný identifikátor prehliadača, z ktorého bol záznam pridaný.
 * Bežný člen tímu môže upraviť a odstrániť len svoje záznamy, správca všetky.
 *
 * Jeden riadok = jedno zariadenie. Tabuľku môžeš upravovať aj ručne,
 * prehľad zmeny načíta pri ďalšej synchronizácii (do minúty).
 * Postup nasadenia je v README.md v repozitári.
 */

// Voliteľné nastavenie. SPREADSHEET_ID nechaj prázdne, ak je skript pripojený k tabuľke (Rozšírenia › Apps Script).
const SPREADSHEET_ID = '';   // ID Google tabuľky s dátami; prázdne = tabuľka, ku ktorej je skript pripojený
const DEFAULT_TEAM_KEY = ''; // tímový kľúč, ak ho nevytváraš funkciou vytvorTimovyKluc

const VERSION = 4; // zvýš pri každej zmene kódu, stránka podľa toho pozná, čo beží

const SHEET = 'Technika';
const TEAM_SHEET = 'Tím';
const HEAD = ['id', 'meno', 'druh', 'nazov', 'stav', 'vlastnictvo', 'preferencia', 'pridane', 'upravene', 'vlastnik'];
const DATA_COLS = 8;    // meno … upravene, bez id a vlastníka
const CREATED_COL = 8;  // stĺpec „pridane“
const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;
const CID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_ROWS = 2000;

// Kód v aplikácii → text v tabuľke. Do tabuľky sa zapisuje čitateľný text.
const DRUH = {mobil: 'Mobil', notebook: 'Notebook', monitor: 'Monitor', tablet: 'Tablet', ine: 'Iné'};
const STAV = {nove: 'Ako nové', dobry: 'Dobrý', opotrebovane: 'Opotrebované', vymenit: 'Treba vymeniť'};
const VLAST = {osobne: 'Osobné', firemne: 'Firemné'};
const PREF = {vlastne: 'Chcem mať vlastné s firemným zabezpečením', firemne: 'Chcem mať firemné'};

/* ---------- webová aplikácia ---------- */

function doGet() {
  return out_({ok: true, data: {info: 'Prehľad techniky: server beží, verzia ' + VERSION + '.', verzia: VERSION}});
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e && e.postData ? e.postData.contents : '');
  } catch (err) {
    return out_({ok: false, error: 'bad_request'});
  }
  const key = PropertiesService.getScriptProperties().getProperty('TEAM_KEY') || DEFAULT_TEAM_KEY;
  if (!key) return out_({ok: false, error: 'not_configured'});
  if (!req || req.key !== key) return out_({ok: false, error: 'unauthorized'});
  try {
    switch (req.action) {
      case 'list':
        return out_({ok: true, data: withLock_(function () { return listFor_(req); })});
      case 'add':
        return out_({ok: true, data: withLock_(function () { addItem_(req.item, req); return listFor_(req); })});
      case 'update':
        return out_({ok: true, data: withLock_(function () { updateItem_(req.id, req.item, req); return listFor_(req); })});
      case 'delete':
        return out_({ok: true, data: withLock_(function () { deleteItem_(req.id, req); return listFor_(req); })});
      default:
        return out_({ok: false, error: 'bad_request'});
    }
  } catch (err) {
    const code = err && err.code ? err.code : 'server_error';
    if (code === 'server_error') console.error(err);
    return out_({ok: false, error: code, message: String(err && err.message ? err.message : '')});
  }
}

/**
 * Vytvorí nový tímový kľúč a vypíše ho do protokolu spustenia.
 * Spusti raz pri nasadení. Opätovným spustením starý kľúč zneplatníš.
 */
function vytvorTimovyKluc() {
  const k = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
  PropertiesService.getScriptProperties().setProperty('TEAM_KEY', k);
  Logger.log('Tímový kľúč: ' + k);
  Logger.log('Vlož ho vo Verceli do premennej GAS_KEY.');
  return k;
}

/* ---------- hárok ---------- */

function ss_() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET, 0);
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
    const list = function (vals) { return SpreadsheetApp.newDataValidation().requireValueInList(vals, true).setAllowInvalid(false).build(); };
    sh.getRange(2, 3, sh.getMaxRows() - 1, 1).setDataValidation(list(values_(DRUH)));
    sh.getRange(2, 5, sh.getMaxRows() - 1, 1).setDataValidation(list(values_(STAV)));
    sh.getRange(2, 6, sh.getMaxRows() - 1, 1).setDataValidation(list(values_(VLAST)));
    sh.getRange(2, 7, sh.getMaxRows() - 1, 1).setDataValidation(list(values_(PREF)));
    sh.getRange(2, 8, sh.getMaxRows() - 1, 2).setNumberFormat('d.M.yyyy H:mm');
    sh.setColumnWidth(1, 90);
    sh.setColumnWidths(2, 2, 130);
    sh.setColumnWidth(4, 200);
    sh.setColumnWidth(7, 300);
  }
  if (String(sh.getRange(1, HEAD.length).getValue()) !== HEAD[HEAD.length - 1]) {
    sh.getRange(1, HEAD.length).setValue(HEAD[HEAD.length - 1]).setFontWeight('bold');
  }
  return sh;
}

/* ---------- tím ---------- */

function teamSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(TEAM_SHEET);
  if (!sh) {
    sh = ss.insertSheet(TEAM_SHEET);
    sh.getRange(1, 1, 1, 3).setValues([['id', 'meno', 'aktivny']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// Aktívne mená v poradí z hárku „Tím“.
function readTeam_() {
  const sh = teamSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const seen = {};
  const out = [];
  sh.getRange(2, 1, last - 1, 3).getValues().forEach(function (r) {
    const name = String(r[1]).trim().slice(0, 40);
    const a = String(r[2]).trim().toLowerCase();
    if (!name || seen[name] || r[2] === false || a === 'false' || a === 'nie' || a === '0') return;
    seen[name] = true;
    out.push({id: String(r[0]).trim() || name, name: name});
  });
  return out;
}

function values_(map) {
  return Object.keys(map).map(function (k) { return map[k]; });
}

// Text z tabuľky (aj ručne zapísaný) → kód pre aplikáciu.
function toCode_(map, v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (map[s]) return s;
  const low = s.toLowerCase();
  for (const k in map) if (map[k].toLowerCase() === low) return k;
  return '';
}

function readAll_() {
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, HEAD.length).getValues();
  const out = [];
  vals.forEach(function (r) {
    const id = String(r[0]).trim();
    if (!id && !String(r[1]).trim() && !String(r[3]).trim()) return; // prázdny riadok
    out.push({
      id: id,
      meno: String(r[1]).trim().slice(0, 40),
      druh: toCode_(DRUH, r[2]) || 'ine',
      nazov: String(r[3]).trim().slice(0, 80),
      stav: toCode_(STAV, r[4]),
      vlastnictvo: toCode_(VLAST, r[5]),
      preferencia: toCode_(PREF, r[6]),
      t: r[7] instanceof Date ? r[7].getTime() : 0,
      o: String(r[9]).trim()
    });
  });
  // Riadky pridané ručne bez id dostanú id, aby sa dali upraviť aj v aplikácii.
  let fixed = false;
  out.forEach(function (it, i) {
    if (!ID_RE.test(it.id)) {
      it.id = newId_();
      sh.getRange(i + 2, 1).setValue(it.id);
      fixed = true;
    }
  });
  if (fixed) SpreadsheetApp.flush();
  return out;
}

// Zoznam pre prehliadač: bez identifikátora vlastníka, len s príznakom, či záznam patrí tomuto prehliadaču.
function listFor_(req) {
  const cid = cidOf_(req);
  return {v: VERSION, team: readTeam_(), items: readAll_().map(function (it) {
    return {id: it.id, meno: it.meno, druh: it.druh, nazov: it.nazov, stav: it.stav,
      vlastnictvo: it.vlastnictvo, preferencia: it.preferencia, t: it.t, mine: !!cid && it.o === cid};
  })};
}

function cidOf_(req) {
  const c = String(req && req.cid || '');
  return CID_RE.test(c) ? c : '';
}

const isAdmin_ = req => !!req && req.role === 'a';

function checkOwner_(row, req) {
  if (isAdmin_(req)) return;
  const cid = cidOf_(req);
  const owner = String(sheet_().getRange(row, HEAD.length).getValue()).trim();
  if (!cid || owner !== cid) throw {code: 'forbidden'};
}

// keepName: pri úprave môže zostať aj meno, ktoré už v zozname tímu nie je.
function clean_(item, keepName) {
  if (!item || typeof item !== 'object') throw {code: 'bad_request'};
  const s = function (v, n) { return String(v == null ? '' : v).trim().slice(0, n); };
  const c = {
    meno: s(item.meno, 40), nazov: s(item.nazov, 80),
    druh: DRUH[item.druh] ? item.druh : '', stav: STAV[item.stav] ? item.stav : '', vlastnictvo: VLAST[item.vlastnictvo] ? item.vlastnictvo : '',
    preferencia: PREF[item.preferencia] ? item.preferencia : ''
  };
  if (!c.meno || !c.nazov || !c.druh || !c.stav || !c.vlastnictvo || !c.preferencia) throw {code: 'bad_request'};
  const inTeam = readTeam_().some(function (m) { return m.name === c.meno; });
  if (!inTeam && c.meno !== keepName) throw {code: 'unknown_member'};
  // Zabráni tomu, aby sa text vložený do tabuľky správal ako vzorec.
  if (/^[=+\-@]/.test(c.nazov)) c.nazov = "'" + c.nazov;
  return c;
}

function rowOf_(c, created, updated) {
  return [c.meno, DRUH[c.druh], c.nazov, STAV[c.stav], VLAST[c.vlastnictvo], PREF[c.preferencia], created, updated];
}

function findRow_(id) {
  if (!ID_RE.test(String(id))) throw {code: 'bad_request'};
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === id) return i + 2;
  return 0;
}

function addItem_(item, req) {
  const c = clean_(item);
  const sh = sheet_();
  if (sh.getLastRow() - 1 >= MAX_ROWS) throw {code: 'quota_exceeded'};
  const now = new Date();
  sh.appendRow([newId_()].concat(rowOf_(c, now, now), [cidOf_(req)]));
}

function updateItem_(id, item, req) {
  const row = findRow_(id);
  if (!row) throw {code: 'not_found'};
  checkOwner_(row, req);
  const sh = sheet_();
  const c = clean_(item, String(sh.getRange(row, 2).getValue()).trim());
  const created = sh.getRange(row, CREATED_COL).getValue();
  sh.getRange(row, 2, 1, DATA_COLS).setValues([rowOf_(c, created instanceof Date ? created : new Date(), new Date())]);
}

function deleteItem_(id, req) {
  const row = findRow_(id);
  if (!row) return;
  checkOwner_(row, req);
  sheet_().deleteRow(row);
}

/* ---------- pomocné ---------- */

function newId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw {code: 'busy'};
  try {
    const r = fn();
    SpreadsheetApp.flush();
    return r;
  } finally {
    lock.releaseLock();
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
