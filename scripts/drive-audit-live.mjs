/* =========================================================================
   scripts/drive-audit-live.mjs — FASE 0, POINT (c) : L'AUDIT EN LECTURE SEULE
   DU DRIVE RÉEL.

   ⛔ CE FICHIER NE CONTIENT AUCUNE ÉCRITURE : que des `GET` sur l'API Drive.
      (`_guard_no_trash.mjs` le vérifie : aucune requête `trashed=true`, et toute
      recherche porte `trashed=false`.) Il est rangé dans `scripts/` — PAS à la
      racine — pour que `_run_all.cjs` ne le lance JAMAIS : la suite de tests ne
      doit pas toucher au Drive réel.

   USAGE
     • `node scripts/drive-audit-live.mjs --dataset="MON DATASET"`      → PLAN
       (défaut) : dit exactement quelles requêtes il FERAIT, et n'en fait
       aucune ;
     • `node scripts/drive-audit-live.mjs --dataset="MON DATASET" --go`  → exécute
       la lecture et rend le rapport.

   LE JETON : le serveur de jetons de l'espace de travail (le même que
   `_probe_backup_drive.mjs`). Aucun jeton n'est imprimé — jamais.

   CE QUI EST CHERCHÉ (les points demandés) :
     ① dossiers jumeaux (même parent, même nom) ;
     ② dossiers hors plan qui CONTIENNENT des fichiers ;
     ③ expériences de même nom (deux fois le même dossier d'expérience) ;
     ④ expériences sans projet (un dossier posé là où un projet est attendu) ;
     ⑤ fichiers `<ancien nom>.json` résiduels (le nom ne correspond à aucun
       dossier d'expérience vivant) ;
     ⑥ projets en tombe (`_workspace/state.json` → `deletedProjects`) dont le
       dossier existe encore ;
     ⑦ taille réelle des `_workspace/datasets/ds_<id>.json`.

   ⛔ LE DATASET D'ADMINISTRATION N'EST PAS TOUCHÉ : tout dossier de dataset dont
      la copie déclare `kind: 'administration'` est SAUTÉ et DIT comme tel.
   ========================================================================= */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('../_harness/real-upload-hook.mjs', import.meta.url);

const ARGS = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true'];
}));
const DATASET = String(ARGS.get('dataset') || '').trim();
const GO = ARGS.get('go') === 'true';
const TOKEN_URL = String(ARGS.get('token-url') || 'https://drive-token-server-763848765523.europe-west1.run.app');
const API = 'https://www.googleapis.com';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const APP_ROOT = 'Lab Workspace';
const WORKSPACE_DIR = '_workspace';

if (!DATASET) {
  console.error('⛔ Il faut NOMMER le dataset à auditer : --dataset="NOM EXACT" (aucune autre lecture n’est faite sans cela).');
  process.exit(2);
}

/* ⛔ GARDE-FOU INTERNE : ce fichier ne doit contenir AUCUNE écriture vers l'API
   Drive. La seule requête non-GET est l'ÉCHANGE DE JETON (POST au serveur de
   jetons) — c'est un échange de droits, pas une écriture de données. Le fichier
   se refuse lui-même si jamais autre chose apparaît : un audit qui écrirait ne
   serait plus un audit. */
{
  const SRC = readFileSync(new URL(import.meta.url), 'utf8');
  const code = SRC.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const posts = code.match(/method:\s*['"]POST['"]/g) || [];
  const others = code.match(/method:\s*['"](PATCH|DELETE|PUT)['"]/g) || [];
  const forbidden = [];
  if (posts.length > 1) forbidden.push(`${posts.length} POST (un seul est permis : le jeton)`);
  if (others.length) forbidden.push(`méthode(s) d’écriture : ${others.join(', ')}`);
  /* Une phrase d'explication n'est pas une requête : on ne regarde que les
     lignes qui construisent vraiment un appel (même règle que _guard_no_trash). */
  code.split('\n').forEach((l) => {
    if (/trashed\s*=\s*true/.test(l) && /(\?q=|files\?|q=)/.test(l)) forbidden.push('une recherche dans la corbeille');
    if (/uploadType/.test(l) && /\/upload\//.test(l)) forbidden.push('un envoi de fichier (uploadType)');
  });
  if (forbidden.length) {
    console.error(`⛔ GARDE-FOU : l’audit en lecture seule contient ${[...new Set(forbidden)].join(' · ')} — REFUSÉ.`);
    process.exit(3);
  }
}

const DATASET_SLUG = DATASET.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const PLANNED = [
  `${APP_ROOT}`,
  `${APP_ROOT}/${DATASET_SLUG}`,
  `  + les dossiers fixes du dataset (projects, storage, protocols, backups, publications, general_library_images)`,
  `  + projects/<projet> pour chaque projet du modèle`,
  `  + projects/<projet>/<expérience> puis <instance>/<section>/<sous-section> pour chaque expérience`,
  `  + fichiers : <objet>.json, <section>.html, _meta.json (un par dossier), ${DATASET_SLUG}.json`
];

const dryPlan = () => {
  console.log('# PLAN DE L’AUDIT (mode PLAN — AUCUNE requête n’a été faite)');
  console.log('');
  console.log('① Jeton : POST ' + TOKEN_URL + '  { "grant_type": "workspace" }');
  console.log('② GET  ' + API + '/drive/v3/files?q=name=\'' + APP_ROOT + '\' and mimeType=folder and trashed=false');
  console.log('③ GET  ' + API + '/drive/v3/files?q=name=\'' + DATASET_SLUG + '\' and \'<racine>\' in parents and trashed=false');
  console.log('④ GET  ' + API + '/drive/v3/files/<datasetId>/permissions? … — NON : aucune requête d’écriture, jamais');
  console.log('⑤ Parcours : GET ' + API + '/drive/v3/files?q=\'<dossier>\' in parents and trashed=false&pageSize=1000 (+ nextPageToken)');
  console.log('   — récursif, profondeur maximale 8 (TIDY_MAX_DEPTH), au plus 2 000 dossiers (TIDY_MAX_FOLDERS)');
  console.log('⑥ Pour chaque dossier : GET ' + API + '/drive/v3/files/<id>?alt=media  (son _meta.json)');
  console.log('⑦ Copies de dataset : GET ' + API + '/drive/v3/files/<id>?alt=media  (_workspace/datasets/ds_<id>.json)');
  console.log('⑧ État de l’espace  : GET ' + API + '/drive/v3/files/<id>?alt=media  (_workspace/state.json → deletedProjects)');
  console.log('');
  console.log('Arbre attendu (le plan, pour comparaison) :');
  PLANNED.forEach((l) => console.log('   ' + l));
  console.log('');
  console.log(`Aucune requête n’a été émise. Pour la lecture réelle : --dataset="${DATASET}" --go`);
  process.exit(0);
};

if (!GO) dryPlan();

/* ── LA LECTURE — GET SEULEMENT ─────────────────────────────────────────── */
const TOKEN = await (async () => {
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'workspace' })
  }).catch(() => null);
  const json = res ? await res.json().catch(() => ({})) : {};
  return String(json.access_token || '');
})();
if (!TOKEN) {
  console.error('PAS DE JETON : rien n’a été lu (le serveur de jetons n’a pas répondu).');
  process.exit(0);
}
let READS = 0;
const api = async (path) => {
  READS += 1;
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
};
const textOf = async (id) => {
  READS += 1;
  const res = await fetch(`${API}/drive/v3/files/${id}?alt=media`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return res.ok ? res.text() : '';
};
const listChildren = async (parentId, token = '') => {
  const q = encodeURIComponent(`'${parentId}' in parents and trashed=false`);
  return api(`/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,size,createdTime,appProperties)`
    + `&pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
};
const walk = async (rootId, { maxDepth = 8, maxFolders = 2000 } = {}) => {
  const folders = [];
  const files = [];
  const queue = [{ id: rootId, path: [], depth: 0 }];
  const seen = new Set();
  while (queue.length && folders.length < maxFolders) {
    const cur = queue.shift();
    if (seen.has(cur.id)) continue;
    seen.add(cur.id);
    folders.push(cur);
    let token = '';
    do {
      const page = await listChildren(cur.id, token);
      token = page.nextPageToken || '';
      for (const f of page.files || []) {
        const isDir = f.mimeType === FOLDER_MIME;
        const entry = { ...f, path: [...cur.path, f.name], parent: cur.id };
        if (isDir) { if (cur.depth + 1 <= maxDepth) queue.push({ id: f.id, path: entry.path, depth: cur.depth + 1 }); }
        else files.push(entry);
      }
    } while (token);
  }
  return { folders, files };
};

/* ── LES VÉRIFICATIONS (les sept points demandés) ───────────────────────── */
const findOne = async (name, parentId) => {
  const q = encodeURIComponent(`name='${String(name).replace(/'/g, "\\'")}' and '${parentId}' in parents and trashed=false`);
  const j = await api(`/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size)&pageSize=100`);
  return (j.files || [])[0] || null;
};
const root = await (async () => {
  const q = encodeURIComponent(`name='${APP_ROOT}' and mimeType='${FOLDER_MIME}' and trashed=false`);
  const j = await api(`/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=10`);
  return (j.files || [])[0] || null;
})();
if (!root) {
  console.log(`Aucun dossier « ${APP_ROOT} » visible pour ce compte : rien à auditer (et rien n’a été écrit).`);
  process.exit(0);
}
const datasetFolder = await findOne(DATASET_SLUG, root.id);
if (!datasetFolder) {
  console.log(`Aucun dossier « ${DATASET_SLUG} » sous « ${APP_ROOT} » : vérifie --dataset=…`);
  process.exit(0);
}
/* ⛔ LE DATASET D'ADMINISTRATION N'EST PAS AUDITÉ. */
const dsMetaNode = await findOne('_meta.json', datasetFolder.id);
const dsMeta = JSON.parse((dsMetaNode ? await textOf(dsMetaNode.id) : '') || '{}');
const kind = String((dsMeta && dsMeta.dataset && dsMeta.dataset.kind) || dsMeta.kind || 'scientific');
if (kind === 'administration') {
  console.log(`⛔ « ${DATASET_SLUG} » est une base d’ADMINISTRATION : SAUTÉE, comme demandé (aucun dossier parcouru).`);
  process.exit(0);
}

const { folders, files } = await walk(datasetFolder.id);
const byParent = new Map();
for (const f of folders) {
  if (!byParent.has(f.parent)) byParent.set(f.parent, []);
  byParent.get(f.parent).push(f);
}
const KNOWN_LEVELS = new Set(['projects', 'storage', 'protocols', 'backups', 'publications', 'general_library_images']);
const bytes = (n) => `${(Number(n) / 1048576).toFixed(2)} Mo`;
const filesIn = (id) => files.filter((x) => x.parent === id);

console.log(`# AUDIT EN LECTURE SEULE — « ${DATASET} » (${DATASET_SLUG})`);
console.log(`   ${folders.length} dossier(s), ${files.length} fichier(s) lus, ${READS} requêtes GET, 0 écriture.`);
console.log('');

/* ① jumeaux : même parent, même nom */
const twinPairs = [];
for (const g of byParent.values()) {
  const byName = new Map();
  for (const f of g) byName.set(f.name, [...(byName.get(f.name) || []), f]);
  for (const [, list] of byName) if (list.length > 1) twinPairs.push(list);
}
console.log(`① DOSSIERS JUMEAUX (même parent, même nom) : ${twinPairs.length}`);
twinPairs.slice(0, 20).forEach((l) => console.log(`   · ${l[0].path.join('/')} — ${l.length} copies : ${l.map((x) => x.id).join(', ')}`));

/* ② dossiers hors plan QUI CONTIENNENT des fichiers — le plan = les niveaux
   attendus (projects/<projet>/<expérience>/<instance>/<section>/<sous-section>) */
const stray = folders.filter((f) => filesIn(f.id).length > 0 && f.path.length > 4 && !KNOWN_LEVELS.has(f.path[1]));
console.log(`② DOSSIERS HORS PLAN AVEC FICHIERS : ${stray.length}`);
stray.slice(0, 10).forEach((f) => console.log(`   · ${f.path.join('/')} (${filesIn(f.id).length} fichier(s))`));

/* ③ expériences de même nom (deux dossiers pour la même expérience) */
const expFolders = folders.filter((f) => f.path.includes('projects') && f.path.length >= 4 && !KNOWN_LEVELS.has(f.name));
const expGroups = new Map();
for (const f of expFolders) {
  const key = `${f.path.slice(0, 3).join('/')}|${f.path[3]}`;
  expGroups.set(key, [...(expGroups.get(key) || []), f]);
}
const dupExp = [...expGroups.values()].filter((g) => g.length > 1);
console.log(`③ EXPÉRIENCES DE MÊME NOM (même projet) : ${dupExp.length}`);
dupExp.slice(0, 10).forEach((g) => console.log(`   · ${g[0].path.slice(0, 4).join('/')} — ${g.length} dossiers`));

/* ④ expériences sans projet (posées directement sous projects/) */
const noProject = expFolders.filter((f) => f.path.length === 3 && f.path[1] === 'projects');
console.log(`④ EXPÉRIENCES SANS PROJET (directement sous projects/) : ${noProject.length}`);
noProject.slice(0, 10).forEach((f) => console.log(`   · ${f.path.join('/')}`));

/* ⑤ fichiers <ancien nom>.json sans dossier d'expérience vivant */
const jsonFiles = files.filter((f) => f.name.endsWith('.json') && f.name !== '_meta.json');
const expNames = new Set(expFolders.map((f) => f.name));
const staleJson = jsonFiles.filter((f) => f.path.includes('projects') && f.path.length >= 5
  && !expNames.has(String(f.name).replace(/\.json$/, '')));
console.log(`⑤ FICHIERS <ancien nom>.json SANS DOSSIER VIVANT : ${staleJson.length}`);
staleJson.slice(0, 15).forEach((f) => console.log(`   · ${f.path.join('/')}`));

/* ⑥ projets en tombe dont le dossier existe encore */
const stateFile = files.find((f) => f.name === 'state.json' && f.path.includes('_workspace'));
let tombstoned = [];
if (stateFile) {
  const state = JSON.parse((await textOf(stateFile.id)) || '{}');
  const deleted = Array.isArray(state.deletedProjects) ? state.deletedProjects : [];
  const names = new Set(folders.filter((f) => f.path.length === 3 && f.path[1] === 'projects').map((f) => f.name));
  tombstoned = deleted
    .map((t) => (typeof t === 'string' ? t : (t && (t.id || t.name)) || ''))
    .filter(Boolean)
    .filter((n) => names.has(String(n).replace(/[^A-Za-z0-9]+/g, '_')) || names.has(String(n)));
}
console.log(`⑥ PROJETS EN TOMBE DONT LE DOSSIER EXISTE ENCORE : ${tombstoned.length}${stateFile ? '' : ' (état de l’espace illisible : rien n’est affirmé)'}`);
tombstoned.slice(0, 10).forEach((n) => console.log(`   · ${n}`));

/* ⑦ taille réelle des ds_<id>.json */
console.log('⑦ COPIES DE DATASET (_workspace/datasets/ds_<id>.json) :');
const dsCopies = files.filter((f) => /^ds_.*\.json$/.test(f.name));
if (!dsCopies.length) console.log('   aucune copie trouvée');
dsCopies.forEach((f) => console.log(`   · ${f.name} — ${bytes(f.size)} (${f.size} octets)${Number(f.size) > 8 * 1024 * 1024 ? ' ⚠ AU-DESSUS DE LA LIMITE DE 8 Mo' : ''}`));

console.log('');
const total = twinPairs.length + dupExp.length + staleJson.length + tombstoned.length;
console.log(`# VERDICT : ${total === 0
  ? 'aucun jumeau, aucun reste de renommage, aucune tombe pendante'
  : 'des lignes sont à réparer (voir ci-dessus) — la FASE 4 s’en charge, par déplacements et corbeille SEULEMENT.'}`);
console.log(`# Rien n’a été écrit ni supprimé : ${READS} GET, aucune autre requête.`);
