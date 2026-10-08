/* =========================================================================
   _repair_drive_file_twins.mjs — LES JUMEAUX DE FICHIERS DÉJÀ ÉCRITS (même nom,
   même dossier).

   Le correctif (verrou « chercher → écrire », voir _upload_twins_test.mjs) empêche
   d'en CRÉER de nouveaux ; il ne supprime rien. Or le Drive réel en portait déjà
   beaucoup le 08/10/2026 : 372 dossiers, 1 944 fichiers (123 `_meta.json`, 12
   `name.txt`, …), des copies IDENTIQUES écrites dans la même seconde par des
   passes concurrentes. L'application, elle, lit « le premier du nom » : ces
   copies sont donc vues par l'utilisateur — et certaines portent un contenu
   DIFFÉRENT (la plus récente est alors la bonne).

   CE QUE FAIT CET OUTIL, règle par règle :
     · il groupe les fichiers par (DOSSIER PARENT, NOM) et ne regarde QUE les
       groupes de plus d'un identifiant distinct (une vraie duplication) ;
     · quand TOUTES les copies ont la MÊME TAILLE (le cas des copies identiques,
       de très loin le plus fréquent), il en garde UNE — la plus RÉCENTE — et met
       les autres À LA CORBEILLE ;
     · quand les tailles DIFFÈRENT, il ne touche à RIEN et le SIGNALE (une copie
       n'est pas l'autre : c'est à l'utilisateur de regarder) ;
     · il ne supprime JAMAIS définitivement : `trashed=true` = la corbeille du
       Drive, récupérable pendant 30 jours ;
     · il n'écrit RIEN par défaut (essai à blanc) : il faut `--apply`.

   (Pour les dossiers jumeaux — deux `projects/` racines, deux dossiers d'instance
   frères — c'est l'autre outil : `_repair_drive_twins.mjs --deep`.)

   Usage :
     node _repair_drive_file_twins.mjs                        (essai à blanc, tout)
     node _repair_drive_file_twins.mjs --name=_meta.json      (essai à blanc, un nom)
     node _repair_drive_file_twins.mjs --apply                (CORRIGE vraiment)
     node _repair_drive_file_twins.mjs --apply --name=_meta.json --max=50
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
const APPLY = args.get('apply') === 'true';
const MAX = Number(args.get('max') || 0);

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
  const res = await fetch(path.startsWith('http') ? path : API + path, {
    ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 160)}`);
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

const files = await listAll('trashed=false');
const byId = new Map(files.map((f) => [String(f.id), f]));
const pathOf = (node) => {
  const segs = [String(node.name || '')];
  let cur = node;
  let guard = 0;
  while (cur && guard++ < 40) {
    const parent = byId.get(String((cur.parents || [])[0] || ''));
    if (!parent) break;
    segs.unshift(String(parent.name || ''));
    cur = parent;
  }
  return segs.join('/');
};

const groups = new Map();
files.filter((f) => f.mimeType !== FOLDER && (!NAME || f.name === NAME)).forEach((f) => {
  const key = `${(f.parents || [''])[0] || ''}\u0000${f.name}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(f);
});

const twinGroups = [...groups.values()].filter((g) => g.length > 1);
say(`# jumeaux candidats : ${twinGroups.length} groupe(s)${NAME ? ` pour le nom « ${NAME} »` : ''}`);
say(`# mode : ${APPLY ? 'CORRECTION (les extras partent à la corbeille)' : 'essai à blanc (rien n’est modifié)'}`);
say('');

let trashed = 0;
let leftAlone = 0;
let done = 0;
for (const group of twinGroups) {
  if (MAX && done >= MAX) break;
  const sizes = new Set(group.map((f) => Number(f.size || 0)));
  const newest = [...group].sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)))[0];
  const extras = group.filter((f) => f.id !== newest.id);
  if (sizes.size > 1) {
    /* DES COPIES DIFFÉRENTES : on ne décide pas à la place de l'utilisateur. */
    leftAlone += 1;
    say(`⟂ ${pathOf(newest)} — ${group.length} copies de tailles DIFFÉRENTES, laissé tel quel :`);
    group.forEach((f) => say(`     ${f.createdTime}  ${(f.size || 0).toString().padStart(9)} B  id=${f.id}`));
    continue;
  }
  done += 1;
  say(`✓ ${pathOf(newest)} — ${group.length} copies identiques (${newest.size || 0} B) : on garde la plus récente`);
  say(`     GARDE  ${newest.createdTime}  id=${newest.id}`);
  for (const f of extras) {
    say(`     ${APPLY ? 'CORBEILLE' : 'à ranger'} ${f.createdTime}  id=${f.id}`);
    if (!APPLY) continue;
    try {
      await api(`/drive/v3/files/${f.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true })
      });
      trashed += 1;
    } catch (err) {
      say(`     ⚠ ${f.id} : ${err.message}`);
    }
  }
}

say('');
say(`# groupes corrigés : ${done} · copies rangées à la corbeille : ${trashed}`
  + ` · groupes LAISSÉS tels quels (tailles différentes) : ${leftAlone}`);
if (!APPLY) say('# essai à blanc : relancez avec --apply pour ranger vraiment les extras.');

writeFileSync(args.get('report') || 'tmp_repair_file_twins.txt', lines.join('\r\n'), 'utf8');

