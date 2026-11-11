// Sprostredkuje dopyty prehľadu techniky na Google Apps Script.
// Prehliadač nikdy nevidí adresu Apps Scriptu ani tímový kľúč, tie sú len vo Verceli.
import { sessionFromReq } from './_session.js';
import { sendJson, readJsonBody, callGas } from './_http.js';

const ACTIONS = new Set(['list', 'add', 'update', 'delete']);

export default async function handler(req, res) {
  const s = await sessionFromReq(req);
  if (!s) return sendJson(res, 401, {ok: false, error: 'login_required'});
  if (req.method !== 'POST') return sendJson(res, 405, {ok: false, error: 'bad_request'});

  const body = await readJsonBody(req);
  if (!body || !ACTIONS.has(body.action)) return sendJson(res, 200, {ok: false, error: 'bad_request'});
  delete body.key;
  body.role = s.role;

  const j = await callGas(body);
  return sendJson(res, j && j.status || 200, j || {ok: false, error: 'network'});
}
