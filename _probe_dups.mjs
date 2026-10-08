/* =========================================================================
   _probe_dups.mjs — LECTURE SEULE. Y a-t-il VRAIMENT plusieurs fichiers du même
   nom dans le même dossier (des jumeaux créés par des envois concurrents), ou mon
   listage les comptait-il deux fois ?

   Il liste, pour un nom donné (défaut `_meta.json`), tous les fichiers visibles et
   groupe par dossier PARENT : un groupe de plus d'un IDENTIFIANT différent est une
   vraie duplication. Les IDENTIFIANTS sont affichés, donc la réponse ne se discute pas.

   Usage : node _probe_dups.mjs [--name=_meta.json] [--max=3] [--report=tmp_dups.txt]
   ========================================================================= */
import { writeFileSync } from 'node:fs';

const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';
const FOLDER = 'application/vnd.google-apps.folder';

const args = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true'];
}));
const NAME = args.get('name') || '_meta.json';
const MAX = Number(args.get('max') || 3);

const lines = [];
const say = (s = '') => { lines.push(String(s)); console.log(String(s)); };

const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'workspace' })
}).catch(() => null);
const token = tokenRes ? (await tokenRes.json().catch(() => ({}))).access_token : '';
if (!token) { say('PAS DE JETON : rien n’a été lu.'); process.exit(0); }

const listAll = async (q) => {
  const out = [];
  let pageToken = '';
  const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,size,createdTime,parents)');
  do {
    const res = await fetch(`${API}/drive/v3/files?q=${encodeURIComponent(q)}&fields=${fields}&pageSize=1000`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`GET files → ${res.status}`);
    const j = await res.json();
    out.push(...(j.files || []));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
};
const nameOf = async (id) => {
  const res = await fetch(`${API}/drive/v3/files/${id}?fields=name`, { headers: { Authorization: `Bearer ${token}` } });
  const j = res.ok ? await res.json().catch(() => null) : null;
  return (j && j.name) || `<inconnu:${id}>`;
};

const files = await listAll(`trashed=false and name = '${NAME}'`);
say(`# fichiers visibles nommés « ${NAME} » : ${files.length}`);
const byParent = new Map();
for (const f of files) {
  const p = (f.parents || [])[0] || '(sans parent)';
  if (!byParent.has(p)) byParent.set(p, []);
  byParent.get(p).push(f);
}
const dup = [...byParent.entries()].filter(([, list]) => new Set(list.map((f) => f.id)).size > 1);
say(`# dossiers qui en portent PLUS D'UN identifiant distinct : ${dup.length}`);
for (const [parentId, list] of dup.slice(0, MAX)) {
  say('');
  say(`## ${await nameOf(parentId)}  id=${parentId}  → ${list.length} fichiers`);
  for (const f of list) say(`   ${String(f.createdTime).slice(0, 19)}  ${f.size || 0} B  id=${f.id}`);
}
const sameId = [...byParent.values()].some((list) => new Set(list.map((f) => f.id)).size < list.length);
say('');
say(sameId
  ? '# ⚠ au moins un dossier liste PLUSIEURS FOIS le même identifiant (artefact de listage)'
  : '# aucun dossier ne répète un identifiant : les groupes ci-dessus sont de VRAIS jumeaux');

const report = args.get('report');
if (report) { try { writeFileSync(report, lines.join('\n') + '\n'); } catch { /* au mieux */ } }
