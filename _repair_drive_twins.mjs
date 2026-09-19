/* =========================================================================
   _repair_drive_twins.mjs — RÉPARER LES CONTENEURS JUMEAUX D'UN DATASET.

   Constaté sur le Drive réel le 19/09/2026 (dataset « GEC-UPJV-projects ») :
     • DEUX dossiers `projects` à la racine du dataset — celui du 11/09 (4
       sous-dossiers : bianca, p53H, tests, unassigned) et un jumeau créé le
       19/09 à 11:42 (2 sous-dossiers). Les figures du projet p53H sont
       ÉPARPILLÉES entre les deux (jusqu'à 11:29 dans l'ancien, 38 fichiers de
       13:48 à 17:55 dans le nouveau) ;
     • DEUX dossiers `protocols`, tous les deux vides.
   Cause : la recherche d'un dossier qui ÉCHOUE (quota, 5xx, délai) était
   confondue avec « le dossier n'existe pas » — corrigé depuis dans
   src/utils/driveUpload.js (`listFoldersByName` + `canonicalDatasetDirId`), qui
   ne crée plus jamais un conteneur après un échec. Ce script répare l'état
   DÉJÀ présent sur le Drive.

   Ce qu'il fait :
     1. choisit LE conteneur canonique (celui qui porte du contenu, à contenu
        égal le plus ancien) — même règle que l'application, importée de
        src/utils/datasetDirTwins.js ;
     2. FUSIONNE les jumeaux dans ce conteneur : dossiers et fichiers sont
        DÉPLACÉS (jamais copiés, jamais supprimés) ; un dossier de même nom est
        fusionné récursivement ; un FICHIER de même nom déjà présent est laissé
        en place et signalé (rien n'est écrasé) ;
     3. met à la corbeille un jumeau devenu VIDE (jamais un jumeau qui porte
        encore quoi que ce soit) ;
     4. ne touche à rien d'autre et n'écrit jamais dans _workspace.

   Usage (SANS argument = lecture seule, le plan est affiché) :
     node _repair_drive_twins.mjs
     node _repair_drive_twins.mjs --dataset=GEC-UPJV-projects
     node _repair_drive_twins.mjs --dataset=1fiiNoFCfioYFP1rt_1IwV1PZ3d0jlwil --apply
     node _repair_drive_twins.mjs --all --apply          (tous les datasets)
     node _repair_drive_twins.mjs --dirs=projects,protocols
   ========================================================================= */
import { register } from 'node:module';
import { writeFileSync } from 'node:fs';

register('./_esm_test_hook.mjs', import.meta.url);
const { pickCanonicalFolder, CANONICAL_DATASET_DIRS } = await import('./src/utils/datasetDirTwins.js');

const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';
const FOLDER = 'application/vnd.google-apps.folder';

const args = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true'];
}));
const APPLY = args.get('apply') === 'true';
const ALL = args.get('all') === 'true';
const DATASET = args.get('dataset') || 'GEC-UPJV-projects';
const DIRS = (args.get('dirs') || CANONICAL_DATASET_DIRS.join(','))
  .split(',').map((s) => s.trim()).filter(Boolean);

const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'workspace' })
}).catch(() => null);
const token = tokenRes ? (await tokenRes.json().catch(() => ({}))).access_token : '';
/* Ce script n'est pas un test : sans jeton il ne peut rien VÉRIFIER, et le dire
   suffit (sortie 0) — une panne réseau ne doit pas faire rougir la suite. */
if (!token) {
  console.log('PAS DE JETON — serveur de jetons injoignable : rien de vérifié (relancer quand le réseau revient).');
  process.exit(0);
}

const api = async (path, init = {}) => {
  const res = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res;
};
const json = async (path, init) => (await api(path, init)).json();

/** TOUS les enfants d'un dossier (paginé : un dossier de projet peut en avoir
 *  plus de mille). */
const listAll = async (parentId) => {
  const out = [];
  let pageToken = '';
  do {
    const q = encodeURIComponent(`'${parentId}' in parents and trashed=false`);
    const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,size,createdTime)');
    const page = await json(`/drive/v3/files?q=${q}&fields=${fields}&pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ''}`);
    out.push(...(page.files || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return out;
};

const isFolder = (node) => String(node.mimeType || '') === FOLDER;

/** Les jumeaux d'un nom donné, DE LA PLUS ANCIENNE création à la plus récente. */
const twinsNamed = async (parentId, name) => (await listAll(parentId))
  .filter((n) => isFolder(n) && n.name === name)
  .sort((a, b) => String(a.createdTime || '').localeCompare(String(b.createdTime || '')));

const moveFile = async (fileId, toFolderId) => {
  /* La cible est un IDENTIFIANT : passer un chemin (projects/p53H/…) ferait
     répondre 404 au Drive — et déplacer zéro fichier en silence. */
  if (!/^[A-Za-z0-9_-]{5,}$/.test(String(toFolderId || ''))) {
    throw new Error(`cible invalide « ${toFolderId} » (un identifiant de dossier est attendu)`);
  }
  const meta = await json(`/drive/v3/files/${fileId}?fields=id,parents`);
  const parents = (meta.parents || []).filter((p) => p && p !== toFolderId);
  if (!parents.length && meta.parents && meta.parents.includes(toFolderId)) return false;
  await api(`/drive/v3/files/${fileId}?addParents=${toFolderId}&removeParents=${parents.join(',')}&fields=id,parents`, { method: 'PATCH' });
  return true;
};

const trashFile = async (fileId) => {
  await api(`/drive/v3/files/${fileId}?fields=id`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true })
  });
};

/** Ranger à la corbeille les dossiers VIDES qu'une fusion laisse derrière elle
 *  (les fichiers ont été DÉPLACÉS dans le conteneur retenu : ces dossiers ne
 *  contiennent plus rien). Un dossier qui porte encore quoi que ce soit reste en
 *  place — un dossier vide, lui, est recréé à la demande par l'application.
 *  @returns {Promise<number>} nombre de dossiers rangés */
const pruneEmptyFolders = async (folderId, depth = 0) => {
  if (depth > 8) return 0;
  const kids = await listAll(folderId).catch(() => null);
  if (!kids) return 0;
  let removed = 0;
  for (const kid of kids) {
    if (!isFolder(kid)) continue;
    removed += await pruneEmptyFolders(kid.id, depth + 1);
    const left = await listAll(kid.id).catch(() => null);
    if (left && left.length === 0) {
      try { await trashFile(kid.id); removed += 1; } catch { /* gardé */ }
    }
  }
  return removed;
};

/* ── Sortie : console ET (option) fichier, pour relire le plan en entier ──── */
const REPORT = args.get('report') || '';
const lines = [];
const say = (s = '') => { lines.push(String(s)); console.log(String(s)); };
const finish = () => {
  if (REPORT) { try { writeFileSync(REPORT, lines.join('\n') + '\n', 'utf8'); } catch { /* ignore */ } }
};

/* ── Le dossier « Lab Workspace » et les datasets à examiner ─────────────── */
const wsRes = await json(`/drive/v3/files?q=${encodeURIComponent(
  `name='Lab Workspace' and mimeType='${FOLDER}' and trashed=false`
)}&fields=files(id,name)&pageSize=10`);
const wsId = (wsRes.files || [])[0] ? (wsRes.files || [])[0].id : '';
if (!wsId) { say('« Lab Workspace » introuvable — rien à faire.'); finish(); process.exit(0); }

const allFolders = (await listAll(wsId)).filter((n) => isFolder(n) && n.name !== '_workspace');
const targets = ALL ? allFolders : allFolders.filter((d) => d.id === DATASET || d.name === DATASET);
if (!targets.length) {
  say(`Dataset introuvable : « ${DATASET} »`);
  say(`Datasets présents : ${allFolders.map((d) => d.name).join(', ') || '(aucun)'}`);
  finish();
  process.exit(0);
}

say(`Mode : ${APPLY ? 'APPLIQUER (fichiers DÉPLACÉS, jumeaux vides à la corbeille)' : 'LECTURE SEULE (plan affiché, rien n’est modifié)'}`);
say(`Conteneurs examinés : ${DIRS.join(', ')}`);
say('');

/* ── Le plan : fusionner chaque jumeau dans LE conteneur canonique ───────── */

const planMerge = async (fromId, toId, toPath, ops) => {
  const [fromKids, toKids] = await Promise.all([listAll(fromId), listAll(toId)]);
  for (const kid of fromKids) {
    const clash = toKids.find((t) => t.name === kid.name && isFolder(t) === isFolder(kid));
    if (!isFolder(kid)) {
      if (clash) ops.push({ kind: 'skip', name: kid.name, why: `un fichier du même nom est déjà dans ${toPath}` });
      else ops.push({ kind: 'move', id: kid.id, name: kid.name, to: toId, path: `${toPath}/${kid.name}` });
      continue;
    }
    if (clash) { await planMerge(kid.id, clash.id, `${toPath}/${kid.name}`, ops); continue; }
    ops.push({ kind: 'move', id: kid.id, name: kid.name, to: toId, path: `${toPath}/${kid.name}`, folder: true });
  }
};

let moves = 0;
let skips = 0;
let twinGroups = 0;

for (const dataset of targets) {
  say(`═══ Dataset « ${dataset.name} » [${dataset.id}]`);
  for (const dir of DIRS) {
    const twins = await twinsNamed(dataset.id, dir);
    if (twins.length < 2) continue;
    twinGroups += 1;
    const scored = [];
    for (const twin of twins) {
      const kids = await listAll(twin.id).catch(() => null);
      scored.push({ id: twin.id, createdTime: twin.createdTime || '', items: kids ? kids.length : null });
    }
    const keep = pickCanonicalFolder(scored);
    const extras = twins.filter((t) => t.id !== keep.id);
    say(`  • « ${dir} » : ${twins.length} jumeaux → conteneur RETENU [${keep.id}] (${scored.find((s) => s.id === keep.id).items} élément(s))`);
    for (const extra of extras) say(`      jumeau à FUSIONNER : [${extra.id}] créé ${extra.createdTime}`);
    const ops = [];
    for (const extra of extras) await planMerge(extra.id, keep.id, dir, ops);
    const extraMoves = ops.filter((o) => o.kind === 'move');
    const extraSkips = ops.filter((o) => o.kind === 'skip');
    moves += extraMoves.length;
    skips += extraSkips.length;
    say(`      → ${extraMoves.length} déplacement(s), ${extraSkips.length} homonyme(s) laissé(s) en place`);
    const byTarget = new Map();
    for (const op of extraMoves) {
      const parent = op.path.replace(/\/[^/]*$/, '');
      byTarget.set(parent, (byTarget.get(parent) || 0) + 1);
    }
    for (const [parent, n] of byTarget) say(`         ↗ ${parent} : ${n} élément(s)`);
    for (const op of extraSkips.slice(0, 10)) say(`         = ${op.name} : ${op.why}`);
    if (extraSkips.length > 10) say(`         = … et ${extraSkips.length - 10} autre(s) homonyme(s)`);
  }
}

if (!twinGroups) {
  say('');
  say('Aucun conteneur jumeau : rien à réparer.');
  finish();
  process.exit(0);
}

say('');
say(`TOTAL : ${moves} déplacement(s), ${skips} homonyme(s) conservé(s).`);
say('Les dossiers vidés par la fusion seront rangés à la corbeille, puis le jumeau s’il ne reste rien.');
if (!APPLY) {
  say('Aucune modification (relancer avec --apply pour exécuter).');
  finish();
  process.exit(0);
}

/* ── Exécution ──────────────────────────────────────────────────────────── */

say('');
say('── Exécution ──');
let done = 0;
let failed = 0;
let trashed = 0;
let kept = 0;
for (const target of targets) {
  for (const dir of DIRS) {
    const twins = await twinsNamed(target.id, dir);
    if (twins.length < 2) continue;
    const scored = [];
    for (const twin of twins) {
      const kids = await listAll(twin.id).catch(() => null);
      scored.push({ id: twin.id, createdTime: twin.createdTime || '', items: kids ? kids.length : null });
    }
    const keep = pickCanonicalFolder(scored);
    for (const extra of twins.filter((t) => t.id !== keep.id)) {
      const ops = [];
      await planMerge(extra.id, keep.id, dir, ops);
      for (const op of ops) {
        if (op.kind !== 'move') continue;
        try { await moveFile(op.id, op.to); done += 1; }
        catch (err) { failed += 1; say(`  ✗ ${op.name} : ${err.message}`); }
      }
      const pruned = await pruneEmptyFolders(extra.id).catch(() => 0);
      if (pruned) say(`  🧹 ${pruned} dossier(s) vide(s) laissé(s) par la fusion rangé(s) à la corbeille`);
      const left = await listAll(extra.id).catch(() => null);
      if (left && left.length === 0) {
        try { await trashFile(extra.id); trashed += 1; say(`  🗑 jumeau vide « ${dir} » [${extra.id}] mis à la corbeille`); }
        catch (err) { say(`  ✗ corbeille ${extra.id} : ${err.message}`); }
      } else {
        kept += 1;
        say(`  ⚠ jumeau « ${dir} » [${extra.id}] CONSERVÉ : ${left ? left.length : '?'} élément(s) restant(s) — rien n’est supprimé`);
      }
    }
  }
}
say(`Déplacés : ${done} · échecs : ${failed} · jumeaux vides à la corbeille : ${trashed} · jumeaux conservés : ${kept}`);

/* ── Vérification : plus qu'un conteneur par nom ─────────────────────────── */

say('');
say('── Vérification ──');
for (const dataset of targets) {
  const leftovers = [];
  for (const dir of DIRS) {
    const n = (await twinsNamed(dataset.id, dir)).length;
    if (n > 1) leftovers.push(`${dir} ×${n}`);
  }
  say(`  ${dataset.name} : ${leftovers.length ? `ENCORE DES JUMEAUX → ${leftovers.join(', ')}` : 'un seul conteneur par nom ✓'}`);
}
finish();
