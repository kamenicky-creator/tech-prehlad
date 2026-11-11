// Sprostredkuje dopyty prehľadu techniky na Google Apps Script.
// Prehliadač nikdy nevidí adresu Apps Scriptu ani tímový kľúč, tie sú len vo Verceli.
//
// Kto čo smie: člen tímu (APP_PASSWORD) pridáva zariadenia a upravuje či maže len tie,
// ktoré pridal z tohto prehliadača. Správca (ADMIN_PASSWORD) môže meniť všetko.
// Prehliadač rozpozná cookie tech_cid: náhodný identifikátor, ktorý sa nikde nezobrazuje.
import { sessionFromReq, readCookie } from './_session.js';
import { sendJson, readJsonBody, callGas } from './_http.js';

const ACTIONS = new Set(['list', 'add', 'update', 'delete']);
const CID = 'tech_cid';
const CID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const CID_MAX_AGE = 60 * 60 * 24 * 730; // 2 roky, prežije aj odhlásenie

export default async function handler(req, res) {
  const s = await sessionFromReq(req);
  if (!s) return sendJson(res, 401, {ok: false, error: 'login_required'});
  if (req.method !== 'POST') return sendJson(res, 405, {ok: false, error: 'bad_request'});

  const body = await readJsonBody(req);
  if (!body || !ACTIONS.has(body.action)) return sendJson(res, 200, {ok: false, error: 'bad_request'});

  let cid = readCookie(req.headers.cookie, CID);
  if (!CID_RE.test(cid)) {
    cid = crypto.randomUUID().replace(/-/g, '');
    res.setHeader('Set-Cookie', `${CID}=${cid}; Path=/; Max-Age=${CID_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`);
  }

  // Tieto polia nastavuje len server, nikdy prehliadač.
  delete body.key;
  body.role = s.role;
  body.cid = cid;

  const j = await callGas(body);
  if (j && j.ok && j.data && typeof j.data === 'object') j.data.role = s.role;
  return sendJson(res, j && j.status || 200, j || {ok: false, error: 'network'});
}
