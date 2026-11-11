/**
 * Prehľad techniky: server v Google Apps Scripte.
 *
 * Dáta sú v Google tabuľke, ku ktorej je skript pripojený:
 *   hárok „Technika“  id | meno | priezvisko | druh | nazov | vlastnictvo | preferencia | pridane | upravene
 *
 * Jeden riadok = jedno zariadenie. Tabuľku môžeš upravovať aj ručne,
 * prehľad zmeny načíta pri ďalšej synchronizácii (do minúty).
 * Postup nasadenia je v README.md v repozitári.
 */

// Voliteľné nastavenie. SPREADSHEET_ID nechaj prázdne, ak je skript pripojený k tabuľke (Rozšírenia › Apps Script).
const SPREADSHEET_ID = '';   // ID Google tabuľky s dátami; prázdne = tabuľka, ku ktorej je skript pripojený
const DEFAULT_TEAM_KEY = ''; // tímový kľúč, ak ho nevytváraš funkciou vytvorTimovyKluc

const SHEET = 'Technika';
const HEAD = ['id', 'meno', 'priezvisko', 'druh', 'nazov', 'vlastnictvo', 'preferencia', 'pridane', 'upravene'];
const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;
const MAX_ROWS = 2000;

// Kód v aplikácii → text v tabuľke. Do tabuľky sa zapisuje čitateľný text.
const DRUH = {mobil: 'Mobil', notebook: 'Notebook', monitor: 'Monitor', tablet: 'Tablet', ine: 'Iné'};
const VLAST = {osobne: 'Osobné', firemne: 'Firemné'};
const PREF = {vlastne: 'Chcem mať vlastné s firemným zabezpečením', firemne: 'Chcem mať firemné'};

/* ---------- webová aplikácia ---------- */

function doGet() {
  return out_({ok: true, data: {info: 'Prehľad techniky: server beží.'}});
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
        return out_({ok: true, data: withLock_(function () { return {items: readAll_()}; })});
      case 'add':
        return out_({ok: true, data: withLock_(function () { addItem_(req.item); return {items: readAll_()}; })});
      case 'update':
        return out_({ok: true, data: withLock_(function () { updateItem_(req.id, req.item); return {items: readAll_()}; })});
      case 'delete':
        return out_({ok: true, data: withLock_(function () { deleteItem_(req.id); return {items: readAll_()}; })});
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
    sh.getRange(2, 4, sh.getMaxRows() - 1, 1).setDataValidation(list(values_(DRUH)));
    sh.getRange(2, 6, sh.getMaxRows() - 1, 1).setDataValidation(list(values_(VLAST)));
    sh.getRange(2, 7, sh.getMaxRows() - 1, 1).setDataValidation(list(values_(PREF)));
    sh.getRange(2, 8, sh.getMaxRows() - 1, 2).setNumberFormat('d.M.yyyy H:mm');
    sh.setColumnWidth(1, 90);
    sh.setColumnWidths(2, 2, 130);
    sh.setColumnWidth(5, 200);
    sh.setColumnWidth(7, 300);
  }
  return sh;
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
    if (!id && !String(r[1]).trim() && !String(r[4]).trim()) return; // prázdny riadok
    out.push({
      id: id,
      meno: String(r[1]).trim().slice(0, 40),
      priezvisko: String(r[2]).trim().slice(0, 60),
      druh: toCode_(DRUH, r[3]) || 'ine',
      nazov: String(r[4]).trim().slice(0, 80),
      vlastnictvo: toCode_(VLAST, r[5]),
      preferencia: toCode_(PREF, r[6]),
      t: r[7] instanceof Date ? r[7].getTime() : 0
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

function clean_(item) {
  if (!item || typeof item !== 'object') throw {code: 'bad_request'};
  const s = function (v, n) { return String(v == null ? '' : v).trim().slice(0, n); };
  const c = {
    meno: s(item.meno, 40), priezvisko: s(item.priezvisko, 60), nazov: s(item.nazov, 80),
    druh: DRUH[item.druh] ? item.druh : '', vlastnictvo: VLAST[item.vlastnictvo] ? item.vlastnictvo : '',
    preferencia: PREF[item.preferencia] ? item.preferencia : ''
  };
  if (!c.meno || !c.priezvisko || !c.nazov || !c.druh || !c.vlastnictvo || !c.preferencia) throw {code: 'bad_request'};
  // Zabráni tomu, aby sa text vložený do tabuľky správal ako vzorec.
  ['meno', 'priezvisko', 'nazov'].forEach(function (k) { if (/^[=+\-@]/.test(c[k])) c[k] = "'" + c[k]; });
  return c;
}

function rowOf_(c, created, updated) {
  return [c.meno, c.priezvisko, DRUH[c.druh], c.nazov, VLAST[c.vlastnictvo], PREF[c.preferencia], created, updated];
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

function addItem_(item) {
  const c = clean_(item);
  const sh = sheet_();
  if (sh.getLastRow() - 1 >= MAX_ROWS) throw {code: 'quota_exceeded'};
  const now = new Date();
  sh.appendRow([newId_()].concat(rowOf_(c, now, now)));
}

function updateItem_(id, item) {
  const c = clean_(item);
  const row = findRow_(id);
  if (!row) throw {code: 'not_found'};
  const sh = sheet_();
  const created = sh.getRange(row, 8).getValue();
  sh.getRange(row, 2, 1, HEAD.length - 1).setValues([rowOf_(c, created instanceof Date ? created : new Date(), new Date())]);
}

function deleteItem_(id) {
  const row = findRow_(id);
  if (row) sheet_().deleteRow(row);
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
