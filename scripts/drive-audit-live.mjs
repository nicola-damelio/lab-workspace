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
     ③ dossiers JUMEAUX sous `projects/` (même parent, même nom — mesuré par le
        parent ET le nom seulement : compter un doublon par une ressemblance de
        chemin réunit un dossier avec ses descendants, et c'est faux) ;
     ④ expériences sans projet (un dossier posé là où un projet est attendu) ;
     ⑤ fichiers `<ancien nom>.json` résiduels (le nom ne correspond à aucun
       dossier d'expérience vivant) ;
     ⑥ projets en tombe (`_workspace/state.json` → `deletedProjects`) dont le
       dossier existe encore ;
     ⑦ taille réelle des `_workspace/datasets/ds_<id>.json` **et ce qu'elle
       contient** : combien d'expériences, combien de projets, horodate la plus
       récente (demandé le 16/10/2026) ;
     ⑧ **quelles expériences de l'arbre du Drive manquent dans la copie** (leur
       identifiant est lu dans le `<objet>.json` du dossier ; lectures plafonnées
       par `--exp-json=N`, défaut 40) ;
     ⑨ **deux dossiers du Drive pour un seul objet de l'app** : pour chaque
       groupe de jumeaux, l'`id` porté par le `<objet>.json` de chacun — deux
       dossiers qui portent le MÊME id sont deux copies d'UNE SEULE entité (le
       défaut du renommage, prouvé sans rien écrire ; `--twin-json=N`, défaut 20).

   ⛔ LE DATASET D'ADMINISTRATION N'EST PAS TOUCHÉ : tout dossier de dataset dont
      la copie déclare `kind: 'administration'` est SAUTÉ et DIT comme tel.
   ========================================================================= */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
/* LA RÈGLE DE NOMMAGE DE L'APP, importée TELLE QUELLE (module pur, sans
   dépendance) : le dossier d'un dataset sur le Drive porte son slug. */
import { datasetFolderSlug } from '../src/utils/driveNaming.js';

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
const MAX_FOLDERS = 2000;

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

/* ⚠ LE NOM DU DOSSIER N'EST PAS `[^A-Za-z0-9]+ → _` : c'est la règle de l'APP
   (`sanitizeSlug`, driveNaming.js:26-33 — elle GARDE `-` et `.`). Le dossier
   réel s'appelle « GEC-UPJV-projects », pas « GEC_UPJV_projects » : avec
   l'ancienne règle l'audit ne trouvait AUCUN dataset et sortait par la porte
   « vérifie --dataset=… » (constaté le 16/10/2026 sur le Drive réel — la sonde
   de racine a montré le vrai nom). Le nom du dataset est donc EXACTEMENT ce que
   l'app écrit sur le Drive, et `--dataset=` accepte le titre affiché. */
const DATASET_SLUG = datasetFolderSlug(DATASET);
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
  console.log('   — puis, pour cette copie : GET …?alt=media sur le <objet>.json de chaque dossier d’expérience (⑧, plafonné par --exp-json)');
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
let RETRIES = 0;
/* ⏱ DÉBIT ET REPRISE : une requête toutes les THROTTLE_MS, et sur 429 / 403
   (« quota ») / 5xx on attend puis on recommence (attente croissante, ou
   `Retry-After` s'il est donné). AUCUNE méthode d'écriture n'est ajoutée :
   le garde-fou ci-dessus compte toujours UN SEUL POST (l'échange de jeton). */
const THROTTLE_MS = Math.max(0, Number(ARGS.get('throttle') || 150));
const RETRY_MAX = Math.max(0, Number(ARGS.get('retries') || 6));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
const RETRYABLE = (status) => status === 429 || status === 403 || status >= 500;
const driveGet = async (url) => {
  let res = null;
  for (let attempt = 0; attempt <= RETRY_MAX; attempt += 1) {
    const gap = THROTTLE_MS - (Date.now() - lastCall);
    if (gap > 0) await sleep(gap);
    READS += 1;
    lastCall = Date.now();
    res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (res.ok || !RETRYABLE(res.status) || attempt === RETRY_MAX) return res;
    RETRIES += 1;
    const after = Number(res.headers.get('retry-after') || 0);
    const wait = after > 0 ? after * 1000 : Math.min(32000, 800 * 2 ** attempt) + Math.floor(Math.random() * 400);
    console.error(`   ⏳ ${res.status} — attente ${(wait / 1000).toFixed(1)} s puis reprise (${attempt + 1}/${RETRY_MAX})`);
    await sleep(wait);
  }
  return res;
};
const api = async (path) => {
  const res = await driveGet(`${API}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
};
const textOf = async (id) => {
  const res = await driveGet(`${API}/drive/v3/files/${id}?alt=media`);
  return res.ok ? res.text() : '';
};
const listChildren = async (parentId, token = '') => {
  const q = encodeURIComponent(`'${parentId}' in parents and trashed=false`);
  return api(`/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,size,createdTime,appProperties)`
    + `&pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
};
const walk = async (rootId, { maxDepth = 8, maxFolders = MAX_FOLDERS } = {}) => {
  const folders = [];
  const files = [];
  /* ⚠ `name` ET `parent` SUR CHAQUE DOSSIER : la file ne portait que
     (`id`, `path`, `depth`), donc `folders` n'avait ni nom ni parent — et ①
     (jumeaux, groupés par parent+nom) réunissait alors TOUS les dossiers en un
     seul groupe (nom `undefined`) et ⑤ comparait les noms de fichiers à un
     ensemble vide (463 « restes » faux). Constaté le 16/10/2026 sur le Drive
     réel (507 dossiers annoncés « 1 groupe de 507 jumeaux »). */
  const queue = [{ id: rootId, name: '', parent: '', path: [], depth: 0 }];
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
        if (isDir) { if (cur.depth + 1 <= maxDepth) queue.push({ id: f.id, name: f.name, parent: cur.id, path: entry.path, depth: cur.depth + 1 }); }
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

/* ── LE DOSSIER `_workspace` : UN FRÈRE DU DATASET, À LA RACINE ──────────────
   C'est LUI qui porte les copies `datasets/ds_<id>.json` ET `state.json` (les
   projets en tombe). Le parcours ne visitait que l'intérieur du dataset :
   l'audit déclarait donc « aucune copie trouvée » et « état de l'espace
   illisible » alors que les faits étaient sur le Drive (constaté le
   16/10/2026 : 10 copies `ds_*.json` présentes, aucune vue). LECTURE SEULE. */
const wsFolder = await (async () => {
  const q = encodeURIComponent(`name='_workspace' and mimeType='${FOLDER_MIME}' and trashed=false`);
  const j = await api(`/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=10`);
  return (j.files || [])[0] || null;
})();
let wsRead = false;
if (wsFolder) {
  const sub = await walk(wsFolder.id, { maxDepth: 4, maxFolders: 200 });
  wsRead = true;
  for (const f of sub.folders) {
    folders.push({ ...f, name: f.name || '_workspace', path: f.path.length ? ['_workspace', ...f.path] : ['_workspace'], workspace: true });
  }
  for (const f of sub.files) files.push({ ...f, path: ['_workspace', ...f.path], workspace: true });
}
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
console.log(`   couverture du parcours : ${folders.length} dossier(s) pour un plafond de ${MAX_FOLDERS} — ${folders.length < MAX_FOLDERS ? 'aucun plafond atteint, le parcours du dataset est complet' : '⛔ PLAFOND ATTEINT : la lecture est PARTIELLE'}.`);
console.log('');

/* ① jumeaux : même parent, même nom */
const twinPairs = [];
for (const g of byParent.values()) {
  const byName = new Map();
  for (const f of g) byName.set(f.name, [...(byName.get(f.name) || []), f]);
  for (const [, list] of byName) if (list.length > 1) twinPairs.push(list);
}
console.log(`① DOSSIERS JUMEAUX (même parent, même nom) : ${twinPairs.length}`);
console.log(`   couverture : les ${folders.length} dossier(s) lus sont TOUS comparés, réunis en ${byParent.size} groupe(s) parent — aucun dossier écarté de la comparaison.`);
twinPairs.slice(0, 20).forEach((l) => console.log(`   · ${l[0].path.join('/')} — ${l.length} copies : ${l.slice(0, 8).map((x) => x.id).join(', ')}${l.length > 8 ? ` … +${l.length - 8}` : ''}`));

/* ② dossiers hors plan QUI CONTIENNENT des fichiers — le plan = les niveaux
   attendus (projects/<projet>/<expérience>/<instance>/<section>/<sous-section>) */
const stray = folders.filter((f) => filesIn(f.id).length > 0 && f.path.length > 4 && !KNOWN_LEVELS.has(f.path[1]));
console.log(`② DOSSIERS HORS PLAN AVEC FICHIERS : ${stray.length}`);
console.log(`   couverture : ${folders.filter((f) => filesIn(f.id).length > 0).length} dossier(s) contiennent des fichiers (sur ${folders.length} lus) — la règle les a tous examinés.`);
stray.slice(0, 10).forEach((f) => console.log(`   · ${f.path.join('/')} (${filesIn(f.id).length} fichier(s))`));

/* ③ DOSSIERS JUMEAUX SOUS UN PROJET (même parent, même nom) : deux dossiers du
   même niveau qui portent le même nom — c'est ce que produit un envoi qui
   recrée un dossier au lieu de le renommer.
   ⚠ LA VERSION D'AVANT MESURAIT AUTRE CHOSE : elle groupait par
   `path.slice(0,3)|path[3]`, donc elle réunissait un dossier AVEC SES
   DESCENDANTS (le 4e segment d'un descendant, c'est le nom de son parent) et
   annonçait « 81 expériences en double » là où il n'y avait AUCUN jumeau —
   ① le dit : 0 (constaté le 16/10/2026). Ne jamais compter un doublon par une
   ressemblance de chemin : le parent et le nom, rien d'autre. */
const expFolders = folders.filter((f) => f.path.includes('projects') && f.path.length >= 4 && !KNOWN_LEVELS.has(f.name));
const projTwinGroups = [];
{
  const byPn = new Map();
  for (const f of folders) {
    if (f.path[0] !== 'projects' || f.path.length < 2) continue;
    const key = `${f.parent}|${f.name}`;
    byPn.set(key, [...(byPn.get(key) || []), f]);
  }
  for (const g of byPn.values()) if (g.length > 1) projTwinGroups.push(g);
}
const dupExp = projTwinGroups;
console.log(`③ DOSSIERS JUMEAUX SOUS projects/ (même parent, même nom) : ${dupExp.length}`);
console.log(`   couverture : ${folders.filter((f) => f.path[0] === 'projects').length} dossier(s) sous projects/ comparés deux à deux par (parent, nom).`);
dupExp.slice(0, 10).forEach((g) => console.log(`   · ${g[0].path.join('/')} — ${g.length} dossiers (${g.slice(0, 4).map((x) => x.id).join(', ')})`));

/* ④ expériences sans projet (posées directement sous projects/) : leur chemin
   est ['projects', '<nom>'] — la version d'avant testait `path[1] === 'projects'`
   (index décalé d'un cran) et ne trouvait donc jamais rien. */
const noProject = expFolders.filter((f) => f.path.length === 2 && f.path[0] === 'projects');
console.log(`④ EXPÉRIENCES SANS PROJET (directement sous projects/) : ${noProject.length} sur ${expFolders.length} dossier(s) d’expérience lu(s).`);
noProject.slice(0, 10).forEach((f) => console.log(`   · ${f.path.join('/')}`));

/* ⑤ fichiers <ancien nom>.json sans dossier d'expérience vivant */
const jsonFiles = files.filter((f) => f.name.endsWith('.json') && f.name !== '_meta.json');
const expNames = new Set(expFolders.map((f) => f.name));
const staleJson = jsonFiles.filter((f) => f.path.includes('projects') && f.path.length >= 5
  && !expNames.has(String(f.name).replace(/\.json$/, '')));
console.log(`⑤ FICHIERS <ancien nom>.json SANS DOSSIER VIVANT : ${staleJson.length} sur ${jsonFiles.length} fichier(s) .json lu(s).`);
staleJson.slice(0, 15).forEach((f) => console.log(`   · ${f.path.join('/')}`));

/* ⑥ projets en tombe dont le dossier existe encore */
const stateFile = files.find((f) => f.name === 'state.json' && f.path.includes('_workspace'));
let tombstoned = [];
let tombCount = 0;
if (stateFile) {
  const state = JSON.parse((await textOf(stateFile.id)) || '{}');
  const deleted = Array.isArray(state.deletedProjects) ? state.deletedProjects : [];
  tombCount = deleted.length;
  const names = new Set(folders.filter((f) => f.path.length === 2 && f.path[0] === 'projects').map((f) => f.name));
  tombstoned = deleted
    .map((t) => (typeof t === 'string' ? t : (t && (t.id || t.name)) || ''))
    .filter(Boolean)
    .filter((n) => names.has(String(n).replace(/[^A-Za-z0-9]+/g, '_')) || names.has(String(n)));
}
console.log(`⑥ PROJETS EN TOMBE DONT LE DOSSIER EXISTE ENCORE : ${tombstoned.length}${stateFile ? ` sur ${tombCount} projet(s) publié(s) en tombe` : wsRead ? ' (state.json absent : aucune tombe publiée — rien n’est affirmé)' : ' (dossier _workspace non trouvé : rien n’est affirmé)'}`);
tombstoned.slice(0, 10).forEach((n) => console.log(`   · ${n}`));

/* ⑦ taille réelle des ds_<id>.json + CE QU'ELLE CONTIENT (demandé le 16/10/2026) :
   nombre d'expériences et de projets, horodate la plus récente, et — ⑧ — quelles
   expériences de l'ARBRE du Drive manquent dans la copie. LECTURE SEULE. */
import LZString from 'lz-string';
const EXP_JSON_MAX = Number(ARGS.get('exp-json') || 40);
/** Le `record` d'une copie : `{kind, at, record}` — `payload` peut être compressé
 *  (`isCompressed`, lz-string UTF-16), comme le document Firestore. PUR. */
const copyRecordOf = (rawText) => {
  let parsed = null;
  try { parsed = JSON.parse(rawText || ''); } catch { parsed = null; }
  const rec = parsed && parsed.record ? parsed.record : null;
  if (!rec) return { parsed, rec: null, payload: null, readError: 'JSON illisible' };
  let payload = null;
  try {
    const raw = rec.isCompressed && typeof rec.payload === 'string'
      ? LZString.decompressFromUTF16(rec.payload)
      : rec.payload;
    payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch { payload = null; }
  return { parsed, rec, payload, readError: payload ? '' : 'charge illisible' };
};
/** Les identifiants d'expérience portés par un dossier d'expérience de l'arbre :
 *  son `<objet>.json` (ou celui de sa première instance) porte le champ `id`. */
const experimentJsonOf = (folderNode) => {
  const kids = filesIn(folderNode.id).filter((f) => f.name.endsWith('.json')
    && f.name !== '_meta.json' && !f.name.endsWith('.files.json'));
  if (kids.length) return kids[0];
  const childFolders = folders.filter((x) => x.parent === folderNode.id);
  for (const cf of childFolders) {
    const inner = filesIn(cf.id).filter((f) => f.name.endsWith('.json')
      && f.name !== '_meta.json' && !f.name.endsWith('.files.json'));
    if (inner.length) return inner[0];
  }
  return null;
};

console.log('⑦ COPIES DE DATASET (_workspace/datasets/ds_<id>.json) :');
const dsCopies = files.filter((f) => /^ds_.*\.json$/.test(f.name));
console.log(`   copie(s) trouvée(s) : ${dsCopies.length}`);
if (!dsCopies.length) console.log('   aucune copie trouvée');
const copyFacts = [];
for (const f of dsCopies) {
  const { parsed, rec, payload, readError } = copyRecordOf(await textOf(f.id));
  const tests = payload && Array.isArray(payload.tests) ? payload.tests : [];
  const projects = payload && Array.isArray(payload.projects) ? payload.projects : [];
  const ids = tests.map((t) => String((t && t.id) || '')).filter(Boolean);
  /* L'horodate la plus récente PORTÉE PAR LA COPIE : `at` du fichier, `updatedAt`
     du document, et le `date`/`savedAt` le plus récent des expériences. */
  const stamps = [
    (parsed && parsed.at) || '',
    rec && rec.updatedAt ? String(rec.updatedAt) : '',
    ...tests.map((t) => String((t && (t.savedAt || t.updatedAt || t.date)) || ''))
  ].filter(Boolean).sort();
  copyFacts.push({ file: f, ids, tests, projects, readError, rec, payload, latest: stamps[stamps.length - 1] || '' });
  console.log(`   · ${f.name} — ${bytes(f.size)} (${f.size} octets)${Number(f.size) > 8 * 1024 * 1024 ? ' ⚠ AU-DESSUS DE LA LIMITE DE 8 Mo' : ''}`);
  /* À QUI EST CETTE COPIE : sans le nom du dataset, ⑧ compare l'arbre d'un
     dataset aux copies des AUTRES — le seul lien est le `<id>` du nom de
     fichier. On l'imprime donc, et on dit quand il manque. */
  const whom = (payload && payload.dataset && (payload.dataset.name || payload.dataset.title)) || '';
  console.log(`     dataset de la copie : ${whom || '(aucun nom dans la charge — l’identité ne vient que du nom de fichier ds_<id>)'}`);
  if (readError) {
    console.log(`     ⚠ ${readError} — le contenu de cette copie n'est pas affirmé`);
    continue;
  }
  console.log(`     expériences : ${tests.length} · projets : ${projects.length} · charge compressée : ${rec && rec.isCompressed ? 'oui' : 'non'}`);
  console.log(`     horodate la plus récente portée : ${copyFacts[copyFacts.length - 1].latest || '(aucune)'} · fichier écrit : ${(parsed && parsed.at) || '(sans at)'}`);
}

/* ⑧ EXPÉRIENCES DE L'ARBRE ABSENTES DE LA COPIE (l'audit demandé) : pour chaque
   dossier d'expérience, son JSON porte l'identifiant ; la copie doit le porter.
   Les lectures sont PLAFONNÉES (`--exp-json=N`, défaut 40) et le compte est dit. */
console.log('⑧ EXPÉRIENCES DE L’ARBRE ABSENTES DE LA COPIE :');
if (!dsCopies.length || !copyFacts.some((c) => !c.readError)) {
  console.log('   (pas de copie lisible : rien n’est affirmé)');
} else {
  const treeExps = expFolders.filter((f) => f.path[0] === 'projects');
  const read = [];
  for (const f of treeExps.slice(0, EXP_JSON_MAX)) {
    const node = experimentJsonOf(f);
    if (!node) { read.push({ path: f.path.join('/'), id: '', note: 'sans JSON d’objet' }); continue; }
    let id = '';
    try {
      const obj = JSON.parse((await textOf(node.id)) || '{}');
      id = String((obj && obj.id) || '');
    } catch { id = ''; }
    read.push({ path: f.path.join('/'), id, note: id ? '' : 'id absent du JSON' });
  }
  for (const c of copyFacts) {
    if (c.readError) { console.log(`   · ${c.file.name} : copie illisible (rien affirmé)`); continue; }
    const missing = read.filter((x) => x.id && !c.ids.includes(x.id));
    const nameless = read.filter((x) => !x.id);
    c.treeMissing = missing.length;
    console.log(`   · ${c.file.name} : ${missing.length} expérience(s) de l’arbre absente(s) de la copie (${read.length}/${treeExps.length} dossier(s) lu(s)${nameless.length ? `, ${nameless.length} sans identifiant lisible` : ''})`);
    missing.slice(0, 10).forEach((x) => console.log(`     · ${x.path} (id ${x.id})`));
    if (treeExps.length > read.length) console.log(`     (reste ${treeExps.length - read.length} dossier(s) non lu(s) — relancer avec --exp-json=${treeExps.length} pour tout lire)`);
  }
}


/* ⑨ UN SEUL OBJET DE L'APP, PLUSIEURS DOSSIERS SUR LE DRIVE (le point 2, prouvé
   en LECTURE SEULE) : chaque dossier porte un `<objet>.json` dont le champ `id`
   est l'IDENTITÉ de l'entité. Un même id lu dans PLUSIEURS dossiers = deux (ou
   trois) dossiers Drive pour UNE seule entité — c'est ce que produit un
   renommage quand l'identité n'est écrite qu'au DERNIER niveau du plan
   (driveStructure.js:639-648, `isLast ? extra : null`), et c'est aussi ce que
   laisse derrière lui un envoi qui recrée un dossier au lieu de le renommer.
   Lectures plafonnées par --twin-json (défaut 40). */
const TWIN_JSON_MAX = Number(ARGS.get('twin-json') || 40);
console.log('⑨ UN SEUL OBJET DE L’APP, PLUSIEURS DOSSIERS SUR LE DRIVE :');
const idCandidates = folders.filter((f) => f.path[0] === 'projects' && f.path.length >= 3 && !KNOWN_LEVELS.has(f.name));
const byEntity = new Map();
let idRead = 0;
for (const f of idCandidates.slice(0, TWIN_JSON_MAX)) {
  const node = experimentJsonOf(f);
  if (!node) continue;
  let id = '';
  try { const obj = JSON.parse((await textOf(node.id)) || '{}'); id = String((obj && obj.id) || ''); } catch { id = ''; }
  if (!id) continue;
  idRead += 1;
  byEntity.set(id, [...(byEntity.get(id) || []), f.path.join('/')]);
}
const dupEntities = [...byEntity.entries()].filter(([, ps]) => ps.length > 1);
for (const [id, ps] of dupEntities.slice(0, 15)) {
  console.log(`   ⚠ id ${id} → ${ps.length} dossiers : ${ps.join(' | ')}`);
}
console.log(`   ${dupEntities.length} objet(s) porté(s) par plusieurs dossiers (${idRead}/${idCandidates.length} dossier(s) avec id lu ; --twin-json=N pour tout examiner)`);

console.log('');
const total = twinPairs.length + dupExp.length + staleJson.length + tombstoned.length + dupEntities.length;
const missingInCopies = copyFacts.filter((c) => !c.readError)
  .reduce((n, c) => n + (c.treeMissing || 0), 0);
console.log(`# VERDICT : ${total === 0 && missingInCopies === 0
  ? 'aucun jumeau, aucun reste de renommage, aucune tombe pendante'
  : 'des lignes sont à réparer (voir ci-dessus) — la FASE 4 s’en charge, par déplacements et corbeille SEULEMENT.'}`);
console.log(`# Rien n’a été écrit ni supprimé : ${READS} GET (dont ${RETRIES} reprise(s) après 429/403/5xx), aucune autre requête.`);
console.log(`# Débit : ${THROTTLE_MS} ms entre deux GET, jusqu’à ${RETRY_MAX} reprise(s) par requête — l’API n’a pas été pressée.`);
