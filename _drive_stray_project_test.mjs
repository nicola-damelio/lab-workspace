/* =========================================================================
   _drive_stray_project_test.mjs — UN DOSSIER AU NOM D'UN PROJET NE SE POSE PAS
   À LA RACINE DU DATASET (signalé trois fois : « a directory named after a
   project is being created outside the Projects folder in Drive »).

   LA CAUSE, PAS LA SURFACE. Tout envoi passe par un SEUL entonnoir,
   `driveUpload.resolveDrivePathFromNames(names)` : il CRÉE chaque segment du
   chemin qu'on lui donne (`findOrCreateFolder`) et ne traite spécialement que
   le PREMIER — uniquement s'il est un conteneur canonique
   (`isCanonicalDatasetDir`). Les correctifs précédents canonisaient les
   CONSTRUCTEURS de chemins, un par un : chacun pouvait être juste pendant que
   l'entonnoir obéissait encore à un chemin explicite resté en forme
   historique, à un tableau assemblé à la main, ou à une file d'envois rejouée.
   D'où trois réparations sans effet.

   LA RÉPARATION. Le garde-fou est posé DANS l'entonnoir : si le premier
   segment est le nom d'un PROJET de ce dataset (registre du miroir partagé par
   `_workspace/state.json` + magasin du navigateur `labWorkspace_projects`), le
   chemin est ROUTÉ sous `projects/<projet>/…`. AUCUN appelant ne peut donc plus
   fabriquer le dossier fautif — y compris ceux qu'on n'a pas encore écrits.

   Vérifié sur le module réel (src/utils/driveStray.js) et sur le câblage réel
   de l'entonnoir (src/utils/driveUpload.js).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
  setItem: (k, v) => { store.set(String(k), String(v)); },
  removeItem: (k) => { store.delete(String(k)); }
};

const S = await import('./src/utils/driveStray.js');
const UPLOAD = readFileSync('./src/utils/driveUpload.js', 'utf8');

let passed = 0;
const eq = (actual, expected, what) => { assert.deepEqual(actual, expected, what); passed += 1; };
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => ok(src.includes(needle), what);
const gone = (src, needle, what) => ok(!src.includes(needle), what);

/* ── 1. LE CHEMIN FAUTIF EST ROUTÉ SOUS projects/ ───────────────────────── */
eq(S.routeProjectHeadUnderProjects(['CD_project', 'setup', 'data'], { projectSlugs: ['CD_project'] }).names,
  ['projects', 'CD_project', 'setup', 'data'],
  'un dossier au nom d’un projet passe SOUS projects/ (le chemin fautif du rapport)');
eq(S.routeProjectHeadUnderProjects(['CD_project', 'setup', 'data'], { projectSlugs: ['CD_project'] }).changed, true,
  '…et le geste est signalé (jamais silencieux)');
eq(S.routeProjectHeadUnderProjects(['projects', 'CD_project', 'setup'], { projectSlugs: ['CD_project'] }).changed, false,
  'un chemin DÉJÀ canonique n’est pas touché (aucun dossier en double)');
eq(S.routeProjectHeadUnderProjects(['publications', 'Nicola', 'own'], { projectSlugs: ['CD_project'] }).names,
  ['publications', 'Nicola', 'own'],
  'un premier segment qui n’est PAS un projet garde son chemin (publications, storage, library…)');
eq(S.routeProjectHeadUnderProjects(['CD_project'], { projectSlugs: ['CD_project'] }).changed, false,
  'un chemin d’un seul segment n’est pas réécrit (les constructeurs canoniques visent déjà projects/<projet>)');
eq(S.routeProjectHeadUnderProjects(['my project', 'Data'], { projectSlugs: ['my project'] }).names,
  ['projects', 'my_project', 'Data'],
  'le nom du dossier est slugé comme partout ailleurs (espaces → underscores)');
eq(S.routeProjectHeadUnderProjects(['cd_project', 'Setup'], { projectSlugs: ['CD_project'] }).names,
  ['projects', 'CD_project', 'Setup'],
  'la casse approchante vise le slug CANONIQUE du projet (jamais un jumeau minuscule)');
eq(S.routeProjectHeadUnderProjects(['CD_project', 'setup'], { projectSlugs: [] }).changed, false,
  'sans projet connu pour ce dataset, rien n’est deviné (aucune réécriture au hasard)');
ok(!S.routeProjectHeadUnderProjects(['.git'], { projectSlugs: ['CD_project'] }).changed,
  'un segment inutilisable ne fabrique pas de chemin');
eq(S.routeProjectHeadUnderProjects(['publications', 'Nicola', 'own'], { projectSlugs: ['publications'] }).names,
  ['publications', 'Nicola', 'own'],
  'un conteneur canonique GAGNE même si un projet porte son nom (les publications ne sont pas détournées)');
eq(S.routeProjectHeadUnderProjects(['storage', 'Box A', 'images'], { projectSlugs: ['storage'] }).names,
  ['storage', 'Box_A', 'images'], '…idem pour storage (et sa boîte garde son chemin)');

/* ── 2. LES PROJETS CONNUS : miroir partagé + magasin du navigateur ─────── */
const mirror = { projects: { 'id:ds1::CD_project': { folderId: 'F1' }, 'id:ds2::Autre': { folderId: 'F2' } } };
eq(S.knownProjectSlugs({ datasetId: 'ds1', mirror, rawProjects: '[]' }), ['CD_project'],
  'le registre du miroir donne les projets DE CE dataset (partagé : un projet vu sur un autre poste compte)');
eq(S.knownProjectSlugs({
  datasetId: 'ds1',
  mirror,
  rawProjects: JSON.stringify([
    { id: 'p1', name: 'Retinol study', datasetId: 'ds1' },
    { id: 'p2', name: 'Autre dataset', datasetId: 'ds2' }
  ])
}), ['CD_project', 'Retinol_study'],
  '…et le magasin du navigateur ajoute un projet dont le dossier n’a JAMAIS été touché (le cas du premier envoi)');
eq(S.knownProjectSlugs({ datasetId: 'ds1', mirror: { projects: {} }, rawProjects: 'pas du json' }), [],
  'un magasin illisible ne casse rien ([] — aucune exception)');
eq(S.knownProjectSlugs({ datasetId: '', mirror: { projects: {} }, rawProjects: '[{"id":"p1","name":"Nu"}]' }), ['Nu'],
  'hors dataset (explorateur), les projets non rattachés comptent aussi');

/* ── 3. LE CÂBLAGE : le garde-fou est DANS l'entonnoir ─────────────────── */
has(UPLOAD, "import { guardProjectHead } from './driveStray';", 'l’entonnoir importe le garde-fou');
has(UPLOAD, 'const routed = guardProjectHead(names || [], { datasetId: driveRootId, datasetName: driveRootName });',
  '…et il le consulte AVANT de créer le premier segment');
has(UPLOAD, 'const wanted = routed.names.map((n) => sanitizeSlug(n)).filter(Boolean);',
  '…c’est le chemin CORRIGÉ qui est créé');
gone(UPLOAD, 'const wanted = (names || []).map((n) => sanitizeSlug(n)).filter(Boolean);',
  'l’ancien entonnoir — qui créait le chemin tel quel — a disparu');
has(UPLOAD, 'is a PROJECT of this dataset', '…et un dossier rangé de force est journalisé');

console.log(`_drive_stray_project_test.mjs — ${passed} assertions OK (un dossier de projet vit DANS projects/)`);
