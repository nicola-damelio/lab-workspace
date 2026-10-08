/* =========================================================================
   _probe_folder.mjs — LECTURE SEULE. « Le dossier vient d'être créé, mais les
   fichiers n'y sont pas » : on regarde EXACTEMENT ce que ce dossier porte.

   Usage : node _probe_folder.mjs --name=interaction_pdbs [--depth=6] [--docs]
   ========================================================================= */
import { writeFileSync } from 'node:fs';

const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';
const FOLDER = 'application/vnd.google-apps.folder';

const args = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true'];
}));
const NAME = args.get('name') || '';
const DEPTH = Number(args.get('depth') || 6);
const DOCS = args.get('docs') === 'true';

const lines = [];
const say = (s = '') => { lines.push(String(s)); console.log(String(s)); };

const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'workspace' })
}).catch(() => null);
const token = tokenRes ? (await tokenRes.json().catch(() => ({}))).access_token : '';
if (!token) { say('PAS DE JETON : rien n’a été lu.'); process.exit(0); }

const api = async (path) => {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const reason = (body && body.error && body.error.errors && body.error.errors[0]
      && body.error.errors[0].reason) || '';
    throw new Error(`GET ${path} → ${res.status}${reason ? ` (${reason})` : ''}`);
  }
  return res.json();
};
const listAll = async (q) => {
  const out = [];
  let pageToken = '';
  const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,parents)');
  do {
    const j = await api(`/drive/v3/files?q=${encodeURIComponent(q)}&fields=${fields}&pageSize=1000`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''));
    out.push(...(j.files || []));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
};
const when = (f) => `${String(f.createdTime || '').slice(0, 16).replace('T', ' ')} ${f.mimeType === FOLDER ? '[dir]' : `(${f.size || 0} B)`}`;

const all = await listAll(`trashed=false and name contains '${NAME}'`);
const roots = all.filter((f) => f.mimeType === FOLDER && String(f.name).includes(NAME));
say(`# dossiers dont le nom contient « ${NAME} » : ${roots.length}`);

const walk = async (id, depth, indent, dump) => {
  if (depth > DEPTH) return;
  const children = (await listAll(`'${id}' in parents and trashed=false`)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const counts = { dirs: 0, files: 0 };
  for (const c of children) {
    if (c.mimeType === FOLDER) counts.dirs++; else counts.files++;
    say(`${'  '.repeat(indent)}${c.name}  ${when(c)}`);
    if (DOCS && c.mimeType !== FOLDER && /\.json$/i.test(c.name) && !/^_/.test(c.name) && Number(c.size || 0) < 90000) {
      const party = await fetch(`${API}/drive/v3/files/${c.id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
      const j = await party.json().catch(() => null);
      if (j) {
        const hits = [];
        const rec = (node, path, d) => {
          if (!node || typeof node !== 'object' || d > 6) return;
          for (const [k, v] of Object.entries(node)) {
            if (/structure(?!Composition)|pdb|sequence$/i.test(k) && v !== null && v !== '' && v !== undefined) {
              const shown = typeof v === 'string' ? v : JSON.stringify(v);
              hits.push(`${'  '.repeat(indent + 2)}${path}${k} = ${shown.length > 140 ? `${shown.slice(0, 140)}…` : shown}`);
            }
            rec(v, `${path}${k}.`, d + 1);
          }
        };
        rec(j, '', 0);
        say(`${'  '.repeat(indent + 1)}↳ ${c.name} : ${hits.length} champ(s) de structure`);
        hits.slice(0, 24).forEach((h) => say(h));
      }
    }
    if (c.mimeType === FOLDER) await walk(c.id, depth + 1, indent + 1, dump);
  }
  if (indent > 0) say(`${'  '.repeat(indent)}— ${counts.dirs} dossier(s), ${counts.files} fichier(s)`);
};
for (const r of roots) {
  say('');
  say(`## ${r.name}  id=${r.id}  ${when(r)}`);
  await walk(r.id, 1, 1, DOCS);
}

const report = args.get('report');
if (report) { try { writeFileSync(report, lines.join('\n') + '\n'); } catch { /* au mieux */ } }
