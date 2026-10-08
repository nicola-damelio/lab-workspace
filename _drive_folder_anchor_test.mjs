/* =========================================================================
   _drive_folder_anchor_test.mjs — LE DOSSIER D'UN DATASET N'EST PAS CELUI D'UN
   AUTRE.

   LE DÉFAUT (constaté sur le Drive réel, dataset « GEC-UPJV-projects ») : le
   dossier où l'application écrivait portait le nom d'un dataset SUPPRIMÉ
   (`GEC-UPJV-pp`) — ses projets, ses sauvegardes, sa bibliothèque de figures, sa
   bibliothèque de papiers et son stockage — pendant que le dossier au bon nom,
   lui, ne recevait presque rien. L'application gardait UN SEUL identifiant de
   dossier pour TOUS les datasets, avec « à qui il appartient » : quand deux
   datasets se succédaient plus vite que cette mémoire n'était réécrite, le
   dossier du précédent servait encore. Le contexte Drive, lui, était posé par un
   `useEffect` — donc APRÈS le rendu, alors qu'un envoi part d'un geste.

   CE QUI EST VÉRIFIÉ ICI (modules réels, aucun navigateur) :
     • la mémoire des dossiers est TENUE PAR DATASET : pas de fuite de l'un à
       l'autre, même en alternant ;
     • l'ancienne mémoire unique est reprise, sous le dataset qu'elle nommait ;
     • la TABLE DE DÉCISION du dossier retenu, cas par cas — vivant et au bon nom
       → on écrit dedans ; titre changé → on renomme EN PLACE ; nom d'un autre
       dataset → on l'abandonne (c'est le défaut ci-dessus) ; corbeille →
       abandon ; Drive muet → on garde (jamais de perte hors ligne) ; un dossier
       déjà au bon nom → jamais de renommage qui fabriquerait un jumeau ;
     • le BRANCHEMENT : `driveUpload.ensureDriveFolder` demande la décision,
       vérifie par l'identifiant du dataset, et `App.jsx` pose le contexte
       PENDANT le rendu — pas dans un `useEffect`.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const A = await import('./src/utils/driveFolderAnchor.js');
const UPLOAD_SRC = readFileSync('./src/utils/driveUpload.js', 'utf8');
const APP = readFileSync('./src/App.jsx', 'utf8');
/* App.jsx est en CRLF : les repères de plusieurs lignes se lisent sur la version
   normalisée (le contenu, lui, est le même). */
const APP_N = APP.split('\r\n').join('\n');

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (actual, expected, what) => { assert.deepEqual(actual, expected, what); passed += 1; };
const has = (src, needle, what) => ok(src.includes(needle), what);
const hasNot = (src, needle, what) => ok(!src.includes(needle), what);

/** Un localStorage minimal : les clés sont le VRAI sujet du test. */
const fakeStorage = () => {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(String(k)); }
  };
};

/* ── 1. LA MÉMOIRE EST PAR DATASET ───────────────────────────────────────── */

const s1 = fakeStorage();
A.rememberDatasetFolderEntry(s1, 'ds_A', { id: 'FOLDER_A', name: 'Dataset_A' });
A.rememberDatasetFolderEntry(s1, 'ds_B', { id: 'FOLDER_B', name: 'Dataset_B' });
eq(A.datasetFolderEntry(s1, 'ds_A'), { id: 'FOLDER_A', name: 'Dataset_A' },
  'le dossier retenu pour A est celui de A');
eq(A.datasetFolderEntry(s1, 'ds_B'), { id: 'FOLDER_B', name: 'Dataset_B' },
  '…et celui de B est celui de B : les deux cohabitent');
eq(A.datasetFolderEntry(s1, 'ds_C'), { id: '', name: '' },
  'un dataset dont on ne sait rien n’hérite du dossier de personne');
eq(A.datasetFolderEntry(s1, ''), { id: '', name: '' }, 'aucun dataset ouvert → aucun dossier');

/* Renommer le dossier de B ne touche pas celui de A (le défaut d’origine). */
A.rememberDatasetFolderEntry(s1, 'ds_B', { id: 'FOLDER_B', name: 'Dataset_B_renamed' });
eq(A.datasetFolderEntry(s1, 'ds_A'), { id: 'FOLDER_A', name: 'Dataset_A' },
  'un changement du côté de B laisse A intact');

/* Oublier B ne touche pas A non plus. */
A.forgetDatasetFolderEntry(s1, 'ds_B');
eq(A.datasetFolderEntry(s1, 'ds_B'), { id: '', name: '' }, 'B est oublié');
eq(A.datasetFolderEntry(s1, 'ds_A'), { id: 'FOLDER_A', name: 'Dataset_A' }, 'A est intact');

/* ── 2. L’ANCIENNE MÉMOIRE UNIQUE EST REPRISE, UNE FOIS ─────────────────── */

const s2 = fakeStorage();
s2.setItem('labDriveFolderId', 'OLD_SINGLE');
s2.setItem('labDriveFolderDatasetId', 'ds_OLD');
s2.setItem('labDriveFolderName', 'Ancien_titre');
eq(A.datasetFolderEntry(s2, 'ds_OLD'), { id: 'OLD_SINGLE', name: 'Ancien_titre' },
  'l’ancienne mémoire unique est reprise sous le dataset qu’elle nommait');
eq(A.datasetFolderEntry(s2, 'ds_AUTRE'), { id: '', name: '' },
  '…et par personne d’autre : elle n’est pas distribuée à tous les datasets');
ok(s2.getItem('labDriveFolders').indexOf('OLD_SINGLE') !== -1,
  'la reprise est écrite dans la mémoire par dataset');

/* L’ancienne mémoire reste le reflet du dataset COURANT (un poste resté sur une
   version antérieure de l’application continue de lire un dossier cohérent). */
const s3 = fakeStorage();
A.rememberDatasetFolderEntry(s3, 'ds_A', { id: 'FOLDER_A', name: 'Dataset_A' });
eq(s3.getItem('labDriveFolderId'), 'FOLDER_A', 'la mémoire unique reflète le dossier retenu');
eq(s3.getItem('labDriveFolderDatasetId'), 'ds_A', '…avec son dataset');
eq(s3.getItem('labDriveFolderName'), 'Dataset_A', '…et son nom');

/* ── 3. UNE MÉMOIRE ABÎMÉE NE FAIT PAS ÉCRIRE À CÔTÉ ───────────────────── */

const s4 = fakeStorage();
s4.setItem('labDriveFolders', '{ ce n’est pas du JSON');
eq(A.datasetFolderEntry(s4, 'ds_A'), { id: '', name: '' }, 'un cache illisible rend « on ne sait rien »');
A.rememberDatasetFolderEntry(s4, 'ds_A', { id: 'FOLDER_A', name: 'Dataset_A' });
eq(A.datasetFolderEntry(s4, 'ds_A'), { id: 'FOLDER_A', name: 'Dataset_A' }, '…et se réécrit proprement');
s4.setItem('labDriveFolders', JSON.stringify({
  ds_X: { name: 'sans identifiant' }, ds_Y: { id: 'FY', name: 'Dataset_Y' }
}));
eq(A.readDatasetFolderCache(s4), { ds_Y: { id: 'FY', name: 'Dataset_Y' } },
  'une entrée sans identifiant ne désigne aucun dossier et est ignorée');

/* ── 4. LA TABLE DE DÉCISION, CAS PAR CAS ──────────────────────────────── */

const decision = (entry, wanted, meta, twinExists = false) =>
  A.folderUseDecision({ entry, wanted, meta, twinExists });

const SAME = { id: 'F', name: 'GEC-UPJV-projects' };
eq(decision(SAME, 'GEC-UPJV-projects', { name: 'GEC-UPJV-projects', trashed: false }),
  { action: 'use', reason: 'name-matches' }, 'vivant et au bon nom → on écrit dedans');
eq(decision({}, 'GEC-UPJV-projects', { name: 'GEC-UPJV-projects', trashed: false }),
  { action: 'forget', reason: 'no-cache' }, 'aucun identifiant retenu → on cherche par le nom');
eq(decision(SAME, 'GEC-UPJV-projects', { name: 'GEC-UPJV-projects', trashed: true }),
  { action: 'forget', reason: 'trashed' }, 'un dossier à la CORBEILLE ne reçoit plus rien');
eq(decision(SAME, 'GEC-UPJV-projects', { name: 'Ou_est_le_dossier', trashed: false }),
  { action: 'forget', reason: 'other-name' },
  'un dossier au nom d’un AUTRE dataset est abandonné — jamais utilisé');
eq(decision(SAME, 'GEC-UPJV-projects', null),
  { action: 'use', reason: 'unverified' },
  'Drive muet (hors ligne) → on garde le dossier retenu, comme avant');
eq(decision(SAME, 'GEC-UPJV-projects', {}),
  { action: 'use', reason: 'unnamed' },
  'un dossier sans nom lisible ne fait pas perdre la mémoire');

/* Le TITRE du dataset a changé : c’est le dossier que l’application a créé pour
   ce dataset, sous son ancien nom → on le renomme EN PLACE (tout ce qui est
   déjà dedans suit), sauf si un dossier porte DÉJÀ le nouveau nom (jumeau). */
eq(decision({ id: 'F', name: 'Ancien_titre' }, 'Nouveau_titre', { name: 'Ancien_titre', trashed: false }),
  { action: 'rename', reason: 'title-changed' }, 'titre changé → renommage en place');
eq(decision({ id: 'F', name: 'Ancien_titre' }, 'Nouveau_titre', { name: 'Ancien_titre', trashed: false }, true),
  { action: 'forget', reason: 'twin' }, '…sauf si le nouveau nom existe déjà : jamais de jumeau');

/* Aucun dataset ouvert : le dossier retenu est la racine de l’espace de travail —
   même comportement qu’avant (aucune vérification à faire). */
eq(decision(SAME, '', { name: 'Peu_importe', trashed: false }),
  { action: 'use', reason: 'no-dataset-name' }, 'rien d’ouvert → la racine, sans jugement');

/* ── 5. LE PARCOURS RÉEL, REJOUÉ : le dossier de `-pp` n’est plus utilisé ──
   L’application n’écrit QUE dans le dossier que la décision accepte. Voici le
   cas du Drive réel : la mémoire désigne le dossier `GEC-UPJV-pp` (nom d’un
   dataset supprimé) pour le dataset `GEC-UPJV-projects`, et un dossier au bon
   nom existe déjà. Le parcours doit rendre le dossier AU BON NOM — et surtout
   pas celui de l’autre dataset. */
const resolve = ({ entry, wanted, drive }) => {
  const meta = drive[entry.id] || null;
  const twinExists = !!(meta && !meta.trashed && meta.name !== wanted && entry.name === meta.name
    && drive.twin === wanted);
  const d = A.folderUseDecision({ entry, wanted, meta, twinExists });
  if (d.action === 'use') return entry.id;
  if (d.action === 'rename') return entry.id;
  return (drive.byName || {})[wanted] || '(création)';
};
const REAL_DRIVE = {
  F_ORPHAN: { name: 'GEC-UPJV-pp', trashed: false },
  F_LIVE: { name: 'GEC-UPJV-projects', trashed: false },
  byName: { 'GEC-UPJV-projects': 'F_LIVE' }
};
eq(resolve({ entry: { id: 'F_ORPHAN', name: 'GEC-UPJV-projects' }, wanted: 'GEC-UPJV-projects', drive: REAL_DRIVE }),
  'F_LIVE', 'l’envoi ne repart PAS dans le dossier `GEC-UPJV-pp` : il va au dossier du dataset');
eq(resolve({ entry: { id: 'F_LIVE', name: 'GEC-UPJV-projects' }, wanted: 'GEC-UPJV-projects', drive: REAL_DRIVE }),
  'F_LIVE', 'et le dossier du dataset reste utilisé tel quel, sans requête de plus');
eq(resolve({ entry: { id: 'F_ORPHAN', name: 'GEC-UPJV-projects' }, wanted: 'GEC-UPJV-projects', drive: {} }),
  'F_ORPHAN', 'Drive muet (hors ligne) → on garde le dossier retenu, comme avant');
eq(resolve({
  entry: { id: 'F_ORPHAN', name: 'GEC-UPJV-projects' },
  wanted: 'GEC-UPJV-projects',
  drive: { F_ORPHAN: { name: 'GEC-UPJV-pp', trashed: true } }
}), '(création)', 'dossier à la CORBEILLE → on repart du nom, jamais d’un dossier rangé à la corbeille');

/* ── 6. LE BRANCHEMENT (src/utils/driveUpload.js) ───────────────────────── */

has(UPLOAD_SRC, "from './driveFolderAnchor'", 'driveUpload importe la mémoire par dataset');
has(UPLOAD_SRC, 'datasetFolderEntry(folderStore(), driveRootId).id',
  'le dossier du dataset ouvert est lu DANS SON entrée (jamais une entrée partagée)');
has(UPLOAD_SRC, 'const anchoredDatasetFolderId = async (name) => {', 'le resolver commence par le dossier retenu');
has(UPLOAD_SRC, 'const registeredDatasetFolderId = async (name) => {', 'puis le registre partagé (clé = dataset)');
has(UPLOAD_SRC, 'findDatasetFolderId(readDriveMirror(), { id: driveRootId, name: driveRootName })',
  'le registre est interrogé PAR L’IDENTIFIANT du dataset ouvert');
has(UPLOAD_SRC, 'folderUseDecision({ entry, wanted: name, meta, twinExists })',
  'le dossier retenu n’est utilisé QUE si la décision l’accepte');
has(UPLOAD_SRC, 'folderUseDecision({ entry: { id: registered, name }, wanted: name, meta })',
  'le dossier du registre est vérifié de la même façon');
has(UPLOAD_SRC, 'const meta = await driveFolderMetaOrNull(', 'la vérification demande l’état réel au Drive');
has(UPLOAD_SRC, 'forgetDriveFolder();', 'un dossier refusé est oublié (et lui seul)');
hasNot(UPLOAD_SRC, 'driveRootResolved', 'plus d’identifiant de dossier unique et partagé');
hasNot(UPLOAD_SRC, "setDriveFolderId('')", 'changer de dataset n’efface plus le dossier retenu');
hasNot(UPLOAD_SRC, 'if (nextId && nextId !== driveRootResolvedId) setDriveFolderId',
  'ni l’ancien effacement au changement de dataset');

/* ── 7. LE BRANCHEMENT (src/App.jsx) : LE CONTEXTE EST POSÉ PENDANT LE RENDU */

has(APP_N, 'setDriveRootContext({', 'App.jsx pose le contexte Drive');
has(APP_N, 'const anchorDriveContext = (id, name, kind) => setDriveRootContext(',
  'un seul geste nommé pour l’ancrer (utilisé aux changements de dataset)');
has(APP_N, "setDriveRootContext({\n    id: currentDatasetId || '',",
  'l’ancrage général est posé PENDANT le rendu (avant tout envoi, avant les effets)');
const anchorLine = APP_N.indexOf("setDriveRootContext({\n    id: currentDatasetId || ''");
ok(anchorLine !== -1, 'l’ancrage général est posé PENDANT le rendu');
hasNot(APP_N.slice(Math.max(0, anchorLine - 240), anchorLine), 'useEffect',
  'il n’est pas dans un effet : un envoi part d’un geste, donc AVANT les effets');
has(APP_N, 'anchorDriveContext(targetId,', 'le chargement d’une sauvegarde ancre le dataset cible tout de suite');
has(APP_N, 'anchorDriveContext(newId,', 'la création d’un dataset ancre son dossier tout de suite');
has(APP_N, 'anchorDriveContext(dset.id, baseTitle, \'administration\')',
  'l’ouverture d’une base d’administration ancre son dossier tout de suite');
has(APP_N, 'anchorDriveContext(dset.id, openedTitle,', 'l’ouverture d’un dataset ancre son dossier tout de suite');
has(APP_N, "anchorDriveContext('', '', 'scientific')", 'refermer le dataset referme le contexte Drive');

console.log(`${passed} vérifications OK — le dossier d’un dataset n’appartient qu’à lui`);
