/* =========================================================================
   _probe_new_experiment.mjs — LECTURE SEULE. « Les .pdb que je viens de
   charger ne sont pas dans le dossier » : où sont-ils allés ?

   Le script interroge le Drive réel avec le jeton de l'application, puis :

     1. liste TOUS les dossiers visibles par ce jeton, pour pouvoir résoudre
        le CHEMIN complet de n'importe quel fichier (id → parents → … → racine) ;
     2. liste tout ce qui a été CRÉÉ depuis --since (défaut : aujourd'hui 00:00)
        et affiche, pour chaque entrée, son chemin résolu — un fichier déposé
        « ailleurs » se voit donc immédiatement ;
     3. dit, sans détour, s'il existe un `.pdb` créé dans la fenêtre (c'est la
        question posée) et où.

   Usage : node _probe_new_experiment.mjs [--since=2026-10-08T00:00:00] [--pdb]
           node _probe_new_experiment.mjs --report=tmp_new_exp.txt
   ========================================================================= */
import { writeFileSync } from 'node:fs';

const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';
const FOLDER = 'application/vnd.google-apps.folder';

const args = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true'];
}));
const SINCE = args.get('since') || new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
const ONLY_PDB = args.get('pdb') === 'true';

const lines = [];
const say = (s = '') => { lines.push(String(s)); console.log(String(s)); };

const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'workspace' })
}).catch(() => null);
const token = tokenRes ? (await tokenRes.json().catch(() => ({}))).access_token : '';
if (!token) { say('PAS DE JETON : rien n’a été lu.'); process.exit(0); }

const api = async (path, opts = {}) => {
  const res = await fetch(API + path, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const reason = (body && body.error && body.error.errors && body.error.errors[0]
      && body.error.errors[0].reason) || '';
    throw new Error(`${opts.method || 'GET'} ${path} → ${res.status}${reason ? ` (${reason})` : ''}`);
  }
  return res.json();
};
const listAll = async (q) => {
  const out = [];
  let pageToken = '';
  const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,size,createdTime,parents)');
  do {
    const j = await api(`/drive/v3/files?q=${encodeURIComponent(q)}&fields=${fields}&pageSize=1000`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''));
    out.push(...(j.files || []));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
};

/* 1. Tous les dossiers — de quoi résoudre n'importe quel chemin. */
const folders = await listAll(`trashed=false and mimeType='${FOLDER}'`);
const byId = new Map(folders.map((f) => [f.id, f]));
const seen = new Set(folders.map((f) => f.id));
const pathOf = (file) => {
  const names = [];
  let cur = file;
  for (let i = 0; i < 12 && cur; i++) {
    names.unshift(cur.name);
    const parentId = (cur.parents || [])[0];
    if (!parentId) break;
    cur = byId.get(parentId) || null;
    if (!cur) { names.unshift(`<hors portée:${parentId}>`); break; }
  }
  return names.join('/');
};
say(`# dossiers visibles : ${folders.length}`);
say('');

/* 2. Tout ce qui a été créé depuis --since (une requête par type). */
const created = await listAll(`trashed=false and createdTime > '${SINCE}'`);
created.sort((a, b) => String(a.createdTime).localeCompare(String(b.createdTime)));
const dirs = created.filter((f) => f.mimeType === FOLDER);
const files = created.filter((f) => f.mimeType !== FOLDER);
say(`# créé depuis ${SINCE} : ${dirs.length} dossier(s), ${files.length} fichier(s)`);
for (const d of dirs) say(`  [dir ] ${String(d.createdTime).slice(0, 16).replace('T', ' ')}  ${pathOf(d)}`);
for (const f of files) {
  if (ONLY_PDB && !/\.pdb/i.test(f.name)) continue;
  say(`  [file] ${String(f.createdTime).slice(0, 16).replace('T', ' ')}  ${pathOf(f)}  (${f.size || 0} B)`);
}
say('');

/* 3. La question, posée frontalement : un .pdb créé dans la fenêtre, où ? */
const pdbs = created.filter((f) => f.mimeType !== FOLDER && /\.pdb/i.test(f.name));
say(`# .pdb créés dans la fenêtre : ${pdbs.length}`);
for (const f of pdbs) say(`  ${pathOf(f)}  (${f.size || 0} B)  ${f.createdTime}`);
/* …et, pour comparaison, TOUS les .pdb que ce jeton voit (où qu'ils soient). */
const allPdb = await listAll(`trashed=false and name contains '.pdb' and mimeType != '${FOLDER}'`);
allPdb.sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)));
say(`# tous les .pdb visibles par ce jeton : ${allPdb.length} (40 plus récents)`);
for (const f of allPdb.slice(0, 40)) say(`  ${String(f.createdTime).slice(0, 16).replace('T', ' ')}  ${pathOf(f)}  (${f.size || 0} B)`);

const report = args.get('report');
if (report) { try { writeFileSync(report, lines.join('\n') + '\n'); } catch { /* au mieux */ } }
