/* =========================================================================
   _diag_tree.mjs — LECTURE SEULE. L'arbre d'un dossier, AVEC la description que
   le programme lui-même a écrite (`_meta.json` : type, nom, ordre, parent).

   C'est ce qui dit QUI a créé quel dossier : une section « Data » et une
   section « data » ne portent pas le même type, et une instance renommée garde
   son identifiant dans sa description.

   Usage : node _diag_tree.mjs --name=BidH [--depth=5]
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
const DEPTH = Number(args.get('depth') || 5);

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
  if (!res.ok) throw new Error(`${res.status} ${path.slice(0, 80)}`);
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

const when = (f) => `${String(f.createdTime || '').slice(0, 16).replace('T', ' ')}`;
const metaOf = async (folderId) => {
  const found = await listAll(`'${folderId}' in parents and name='_meta.json' and trashed=false`);
  if (!found.length) return null;
  const res = await fetch(`${API}/drive/v3/files/${found[0].id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  const txt = await res.text().catch(() => '');
  try { return JSON.parse(txt); } catch { return { raw: txt.slice(0, 120) }; }
};

const all = await listAll(`trashed=false and name contains '${NAME}'`);
const roots = all.filter((f) => f.mimeType === FOLDER && String(f.name).includes(NAME))
  .sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)))
  .slice(0, 4);
say(`# dossiers dont le nom contient « ${NAME} » : ${roots.length} racine(s) retenue(s)`);

const walk = async (node, depth, indent) => {
  const meta = await metaOf(node.id);
  const desc = meta
    ? `type=${meta.type || '?'} name=${meta.name || '?'} order=${meta.order === undefined ? '?' : meta.order}`
      + ` parent=${String(meta.parentId || '').slice(0, 6)}${meta.extra ? ` extra=${JSON.stringify(meta.extra).slice(0, 120)}` : ''}`
    : 'SANS _meta.json';
  say(`${'  '.repeat(indent)}${node.name}  (${when(node)})  →  ${desc}`);
  if (depth > DEPTH) return;
  const kids = (await listAll(`'${node.id}' in parents and trashed=false`))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  for (const k of kids) {
    if (k.mimeType === FOLDER) { await walk(k, depth + 1, indent + 1); continue; }
    if (k.name === '_meta.json') continue;
    say(`${'  '.repeat(indent + 1)}· ${k.name}  (${when(k)}, ${k.size || 0} B)`);
  }
  if (!kids.length) say(`${'  '.repeat(indent + 1)}(vide)`);
};

for (const r of roots) {
  say('');
  await walk(r, 0, 0);
}

const report = args.get('report');
if (report) { try { writeFileSync(report, lines.join('\r\n') + '\r\n', 'utf8'); } catch { /* au mieux */ } }
