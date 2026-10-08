/* =========================================================================
   _diag_report.mjs — LECTURE SEULE. Ce que le rapport de l'utilisateur demande,
   lu sur le Drive RÉEL :

     1. les dossiers JUMEAUX (même nom, même parent) ;
     2. les FICHIERS jumeaux (même nom, même dossier parent) ;
     3. les `.pdb` (où ils sont) ;
     4. les fichiers les plus récents (ce qui vient d'être écrit) ;
     5. le voisinage des dossiers « instance… » récents.

   Aucune écriture : uniquement des GET.
   Usage : node _diag_report.mjs [--recent=40] [--report=tmp_diag_report.txt]
   ========================================================================= */
import { writeFileSync } from 'node:fs';

const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';

const args = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true'];
}));
const RECENT = Number(args.get('recent') || 40);

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
  const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,parents)');
  do {
    const res = await fetch(`${API}/drive/v3/files?q=${encodeURIComponent(q)}&fields=${fields}&pageSize=1000`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''), {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      say(`# LISTE IMPOSSIBLE : ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
      return out;
    }
    const j = await res.json();
    (j.files || []).forEach((f) => out.push(f));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
};

const files = await listAll('trashed=false');
const byId = new Map(files.map((f) => [String(f.id), f]));
const FOLDER = 'application/vnd.google-apps.folder';
const isFolder = (f) => f && f.mimeType === FOLDER;

const pathOf = (node) => {
  const segs = [];
  let cur = node;
  let guard = 0;
  while (cur && guard++ < 40) {
    segs.unshift(String(cur.name || ''));
    const pid = Array.isArray(cur.parents) ? String(cur.parents[0] || '') : '';
    cur = byId.get(pid);
  }
  return segs.join('/');
};

say(`# objets visibles : ${files.length} (dossiers ${files.filter(isFolder).length})`);
say(`# récupéré : ${new Date().toISOString()}`);
say('');

/* ── 1. dossiers du même nom sous le même parent (jumeaux de DOSSIER) ──────── */
say('## 1. DOSSIERS JUMEAUX (même nom, même parent)');
const byParentName = new Map();
files.filter(isFolder).forEach((f) => {
  const p = (f.parents || [''])[0] || '';
  const k = `${p}\u0000${f.name}`;
  if (!byParentName.has(k)) byParentName.set(k, []);
  byParentName.get(k).push(f);
});
let twinFolders = 0;
for (const [, group] of byParentName) {
  if (group.length < 2) continue;
  twinFolders += 1;
  say(`   ${pathOf(group[0])}  →  ${group.length} dossiers`);
  group.forEach((g) => say(`      ${g.createdTime}  id=${g.id}`));
}
say(`   (${twinFolders} dossiers jumeaux)`);
say('');

/* ── 2. fichiers du même nom dans le même dossier ─────────────────────────── */
say('## 2. FICHIERS JUMEAUX (même nom, même dossier parent)');
const byParentFileName = new Map();
files.filter((f) => !isFolder(f)).forEach((f) => {
  const p = (f.parents || [''])[0] || '';
  const k = `${p}\u0000${f.name}`;
  if (!byParentFileName.has(k)) byParentFileName.set(k, []);
  byParentFileName.get(k).push(f);
});
let twinFiles = 0;
let twinSpotCount = 0;
const twinByName = new Map();
for (const [, group] of byParentFileName) {
  if (group.length < 2) continue;
  twinFiles += group.length;
  twinSpotCount += 1;
  const nm = String(group[0].name || '');
  twinByName.set(nm, (twinByName.get(nm) || 0) + 1);
}
say(`   ${twinSpotCount} dossiers portent plus d’un identifiant du même nom (${twinFiles} fichiers)`);
[...twinByName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
  .forEach(([nm, c]) => say(`      ${String(c).padStart(4)} × ${nm}`));
say('');

/* ── 3. les .pdb ──────────────────────────────────────────────────────────── */
say('## 3. LES .pdb');
const pdbs = files.filter((f) => !isFolder(f) && /\.pdb$/i.test(String(f.name || '')));
say(`   ${pdbs.length} fichiers .pdb visibles`);
pdbs.sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime))).slice(0, 30)
  .forEach((f) => say(`      ${f.createdTime}  ${pathOf(f)}  (${f.size || 0} B)`));
say('');

/* ── 4. les fichiers les plus récents ─────────────────────────────────────── */
say(`## 4. LES ${RECENT} FICHIERS LES PLUS RÉCENTS`);
[...files].filter((f) => !isFolder(f))
  .sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)))
  .slice(0, RECENT)
  .forEach((f) => say(`   ${f.createdTime}  ${(f.size || 0).toString().padStart(8)} B  ${pathOf(f)}`));
say('');

/* ── 5. le voisinage des dossiers « instance… » récents ───────────────────── */
say('## 5. LES DOSSIERS « instance… » RÉCENTS');
files.filter((f) => isFolder(f) && /^instance/i.test(String(f.name || '')))
  .sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)))
  .slice(0, 10)
  .forEach((f) => {
    say(`   ${f.createdTime}  ${pathOf(f)}   id=${f.id}`);
    files.filter((k) => String((k.parents || [])[0] || '') === String(f.id))
      .forEach((k) => say(`      ${isFolder(k) ? '[DIR] ' : '      '}${k.name}  ${isFolder(k) ? '' : `${k.size || 0} B`}  ${k.createdTime}`));
  });

/* ── 6. chaque EXPÉRIENCE et ses dossiers ENFANTS (les instances) ─────────── */
say('## 6. LES DOSSIERS D’EXPÉRIENCE ET LEURS ENFANTS');
const isExp = (f) => {
  if (!isFolder(f)) return false;
  const p = pathOf(f).split('/');
  const i = p.indexOf('projects');
  return i >= 0 && p.length === i + 3;   // projects/<projet>/<expérience>
};
files.filter(isExp)
  .sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)))
  .slice(0, 14)
  .forEach((f) => {
    say(`   ${f.createdTime}  ${pathOf(f)}`);
    files.filter((k) => String((k.parents || [])[0] || '') === String(f.id) && isFolder(k))
      .sort((a, b) => String(a.createdTime).localeCompare(String(b.createdTime)))
      .forEach((k) => say(`      [DIR] ${k.name}   ${k.createdTime}`));
  });
say('');

/* ── 7. les groupes de jumeaux, en détail (20 premiers) ───────────────────── */
say('## 7. JUMEAUX DE FICHIERS, EN DÉTAIL (20 premiers groupes)');
const groups = [...byParentFileName.entries()].filter(([, g]) => g.length > 1);
groups.slice(0, 20).forEach(([, g]) => {
  const one = g[0];
  say(`   ${pathOf(one)}  —  ${g.length} copies de « ${one.name} »`);
  g.forEach((f) => say(`      ${f.createdTime}  ${(f.size || 0).toString().padStart(8)} B  id=${f.id}`));
});
say('');

/* ── 8. les DOSSIERS créés récemment (les deux noms d'une instance) ───────── */
say('## 8. DOSSIERS CRÉÉS DANS LES 3 DERNIÈRES HEURES');
const cutoff = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
files.filter((f) => isFolder(f) && String(f.createdTime) > cutoff)
  .sort((a, b) => String(a.createdTime).localeCompare(String(b.createdTime)))
  .forEach((f) => say(`   ${f.createdTime}  ${pathOf(f)}`));

writeFileSync(args.get('report') || 'tmp_diag_report.txt', lines.join('\r\n'), 'utf8');
