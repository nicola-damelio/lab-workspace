/* =========================================================================
   _recover_new_material.mjs — LECTURE SEULE sur le Drive.

   Prépare la MATIÈRE de reprise des expériences que le Drive porte dans leurs
   fichiers-objets et que le dataset (sa copie vive) ne porte PLUS — y compris
   celles publiées APRÈS la reprise du 2026-10-09 (Test 84 → Test 91).

   Sortie : `_recover/recoverable_new.json`, même forme que
   `_recover/recoverable_experiments.json`, donc lisible par
   `node _recover_experiments.mjs --mat=_recover/recoverable_new.json`.

   Aucune écriture sur le Drive : seule la matière locale est écrite.
   Usage : node _recover_new_material.mjs
   ========================================================================= */
import { writeFileSync, mkdirSync } from 'node:fs';
import LZString from 'lz-string';

const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';
const FOLDER = 'application/vnd.google-apps.folder';
const COPY_NAME = 'ds_ds_1788383774488.json';
const OUT = '_recover/recoverable_new.json';

const lines = [];
const say = (s = '') => { lines.push(String(s)); console.log(String(s)); };

const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'workspace' })
}).catch(() => null);
const token = tokenRes ? (await tokenRes.json().catch(() => ({}))).access_token : '';
if (!token) { say('PAS DE JETON : rien n’a été lu.'); process.exit(0); }

const listPage = async (q, fields) => {
  const out = [];
  let pageToken = '';
  do {
    const res = await fetch(`${API}/drive/v3/files?q=${encodeURIComponent(q)}`
      + `&fields=${encodeURIComponent(`nextPageToken,${fields}`)}&pageSize=1000`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''), {
      headers: { Authorization: `Bearer ${token}` }
    });
    const j = await res.json().catch(() => ({}));
    out.push(...(j.files || []));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
};
const download = async (id) => {
  const res = await fetch(`${API}/drive/v3/files/${id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  return res.ok ? await res.text() : '';
};
const decode = (payload, compressed = true) => {
  let raw = String(payload || '');
  if (compressed || (!raw.startsWith('{') && !raw.startsWith('['))) {
    for (const dec of [
      () => LZString.decompressFromUTF16(raw),
      () => LZString.decompressFromBase64(raw),
      () => LZString.decompress(raw)
    ]) { try { const d = dec(); if (d) { raw = d; break; } } catch { /* suivante */ } }
  }
  try { return JSON.parse(raw); } catch { return null; }
};

/* ① LA COPIE VIVE : la référence (« ce que le dataset porte aujourd'hui ») */
const copyFile = (await listPage(`name='${COPY_NAME}' and trashed=false`, 'files(id,name,size,modifiedTime)'))[0];
if (!copyFile) { say(`✖ copie « ${COPY_NAME} » introuvable.`); process.exit(0); }
const copyDoc = JSON.parse(await download(copyFile.id));
const liveState = decode(copyDoc.record && copyDoc.record.payload,
  !(copyDoc.record && copyDoc.record.isCompressed === false)) || {};
const liveTests = Array.isArray(liveState.tests) ? liveState.tests : [];
const liveProjects = new Set((Array.isArray(liveState.projects) ? liveState.projects : [])
  .map((p) => String((p && p.name) || '').trim()).filter(Boolean));
say(`copie ${copyFile.name} · modifiée ${copyFile.modifiedTime} · tests=${liveTests.length} · projets=${liveProjects.size}`);

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
const liveNames = new Set(liveTests.map((t) => norm(t && t.name)).filter(Boolean));
const liveIds = new Set(liveTests.map((t) => String(t && t.id)));

/* ② TOUT LE DRIVE, UNE FOIS : on ne garde que les OBJETS D'EXPÉRIENCE
      (`…/<Test>/<instance>/<Test>.json`) — les objets de projet, d'agenda,
      de stockage et les `_meta.json` suivent le motif « nom = dossier » mais
      ne sont pas des expériences. */
const all = await listPage('trashed=false', 'files(id,name,mimeType,size,modifiedTime,createdTime,parents)');
const byId = new Map(all.map((f) => [f.id, f]));
const pathOf = (f) => {
  const parts = [];
  let cur = f;
  let guard = 0;
  while (cur && guard < 20) { parts.unshift(cur.name); const p = (cur.parents || [])[0]; cur = p ? byId.get(p) : null; guard += 1; }
  return parts.join('/');
};
const objects = all.filter((f) => {
  if (f.mimeType === FOLDER || !/\.json$/i.test(f.name)) return false;
  const p = pathOf(f);
  if (/^_workspace\//.test(p)) return false;
  const segs = p.split('/');
  const leaf = String(f.name).replace(/\.json$/i, '');
  const instance = segs[segs.length - 2] || '';
  return leaf !== '_meta' && /^(instance\d+|New_Instance_\d+)$/i.test(instance) && leaf === segs[segs.length - 3];
});
say(`objets d'expérience sur le Drive : ${objects.length}`);

/* ③ LES CANDIDATS : nom du test absent du dataset (toutes générations —
      c'est l'`id` de la charge qui tranchera, comme dans le script de reprise). */
const candidates = objects.filter((f) => !liveNames.has(norm(String(f.name).replace(/\.json$/i, ''))));
say(`candidats (nom absent du dataset) : ${candidates.length}`);

const recoverable = [];
for (const f of candidates) {
  const body = JSON.parse(await download(f.id));
  const data = (body && body.data) || null;
  const id = String((body && body.id) || '');
  const already = id && liveIds.has(id);
  say(`   ${already ? '⛔ déjà dans le dataset (id)' : '➕ à reprendre'}  « ${body && body.name} »`
    + `  id=${id}  savedAt=${(body && body.savedAt) || '—'}  ${Math.round(Number(f.size || 0) / 1024)} Ko`
    + `  fichier=${pathOf(f)}`);
  if (already) continue;
  recoverable.push({
    name: String((body && body.name) || f.name.replace(/\.json$/i, '')),
    generations: 1,
    file: pathOf(f),
    object: body,
    data: data && {
      instanceName: data.instanceName, testCategory: data.testCategory,
      operator: data.operator, projectNames: data.projectNames, date: data.date
    }
  });
}

mkdirSync('_recover', { recursive: true });
writeFileSync(OUT, `${JSON.stringify({
  at: new Date().toISOString(),
  copy: { file: copyFile.name, id: copyFile.id, modifiedTime: copyFile.modifiedTime, tests: liveTests.length },
  recoverable
}, null, 2)}\n`, 'utf8');

say(`\n════ RÉSUMÉ — ce qui sera proposé à l'import ════`);
recoverable.forEach((r) => {
  const d = r.data || {};
  const p = (Array.isArray(d.projectNames) ? d.projectNames : []).filter(Boolean);
  say(`   • « ${r.name} »  id=${r.object.id}  ${d.operator || '—'}  projet(s) ${p.join(', ') || '—'}`
    + `${p.length && !p.every((n) => liveProjects.has(n)) ? '  ⚠ projet absent du dataset' : ''}`);
});
say(`\n→ matière : ${OUT}  (${recoverable.length} expérience(s))`);
say(`→ suite  : node _recover_experiments.mjs --mat=${OUT}`);
