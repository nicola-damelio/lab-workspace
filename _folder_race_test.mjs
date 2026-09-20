/* =========================================================================
   _folder_race_test.mjs — LES DOSSIERS JUMEAUX D'UNE INSTANCE.

   Constaté sur le Drive réel le 20/09/2026 (expérience NMR du projet p53H) :
       projects/p53H/NMR_p53H/Exp_7/    ET  projects/p53H/NMR_p53H/Exp_7/
       projects/p53H/NMR_p53H/Exp_19/   ET  projects/p53H/NMR_p53H/Exp_19/
       …/Exp_19/data/Structure/         ET  …/Exp_19/data/Structure/
   Dates de création à 73 ms, 221 ms et 245 ms d'écart : DEUX chaînes de
   dossiers avançaient en même temps sur le même chemin (l'import Bruker archive
   les fichiers bruts pendant que la copie de référence du spectre part — voir
   NMRSections.jsx). `findOrCreateFolder` faisait « chercher puis créer » : les
   deux ont donc cherché AVANT que l'un ait créé.

   Vérifié ici :
     1. la logique PURE (folderRace.js) : une seule opération en vol par
        (parent, nom), un échec n'est pas mémorisé, deux clés différentes ne se
        gênent pas ;
     2. le GESTE RÉEL, sur le module driveUpload.js (jeton + fetch bouchonnés) :
        deux findOrCreateFolder simultanés → UNE SEULE création sur le Drive ;
        une chaîne d'expérience entière (projects/<projet>/<expérience>/
        <instance>/data/Bruker_1r) résolue deux fois en parallèle → aucun
        dossier en double ;
     3. le départage des jumeaux DÉJÀ présents : celui qui porte du contenu est
        rendu, même s'il est plus récent (l'ordre du Drive n'est pas garanti) ;
     4. les contrats de code qui empêchent le défaut de revenir.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => ok(src.includes(needle), what);

const FOLDER = 'application/vnd.google-apps.folder';

/* ── 0. Le module RÉEL, branché sur un faux Drive ────────────────────────────
   Le crochet des tests remplace driveUpload.js par un bouchon pour les modules
   de src/ : ici c'est le module RÉEL qu'on veut (`?race-…` le contourne, et
   chaque scénario reçoit SA propre instance — l'état du module (registre des
   dossiers, opérations en vol) ne doit pas fuir d'un scénario à l'autre). */
register('./_esm_test_hook.mjs', import.meta.url);

globalThis.localStorage = (() => {
  const store = new Map([['labDriveAccessToken', 'fake-token']]);
  return {
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => { store.delete(String(k)); },
    clear: () => store.clear()
  };
})();

const RACE = await import('./src/utils/folderRace.js');

/* ── 1. La logique PURE ──────────────────────────────────────────────────── */

/* La clé : le PARENT et le NOM. Deux dossiers du même nom sous des parents
   différents sont deux dossiers différents — et le séparateur évite de
   confondre (« a » sous « bc » avec « ab » sous « c »). */
ok(RACE.folderCreateKey('Exp_7', 'P1') !== RACE.folderCreateKey('Exp_7', 'P2'),
  'deux parents différents = deux clés différentes');
ok(RACE.folderCreateKey('Exp_7', 'P1') !== RACE.folderCreateKey('Exp_7', 'P1 '),
  'le nom compte (aucune normalisation silencieuse dans la clé)');
ok(RACE.folderCreateKey('a', 'bc') !== RACE.folderCreateKey('ab', 'c'),
  'la clé ne mélange pas parent et nom');
eq(RACE.folderCreateKey('Exp_7', 'P1'), RACE.folderCreateKey('Exp_7', 'P1'),
  'la même paire (parent, nom) donne toujours la même clé');

/* Une seule opération en vol : les deux appelants PARTAGENT la promesse. */
let workCalls = 0;
let releaseFn = () => {};
const store = new Map();
const deferred = () => {
  workCalls += 1;
  return new Promise((r) => { releaseFn = () => r('ID-1'); });
};
const first = RACE.oncePerFolder(store, 'k', deferred);
const second = RACE.oncePerFolder(store, 'k', deferred);
eq(workCalls, 1, 'deux demandes identiques en vol ne font qu’UN travail');
eq(RACE.inFlightCount(store), 1, '…et la clé est retenue pendant le vol');
releaseFn();
eq(await first, 'ID-1', 'le premier appelant reçoit le dossier créé');
eq(await second, 'ID-1', 'le second reçoit le MÊME dossier');
eq(RACE.inFlightCount(store), 0, 'la clé est libérée dès que le travail est fini');

/* Une clé DIFFÉRENTE ne se gêne pas (deux dossiers différents = deux travaux). */
let sameKeyCalls = 0;
let otherKeyCalls = 0;
await Promise.all([
  RACE.oncePerFolder(store, 'k', async () => { sameKeyCalls += 1; return 'ID-2'; }),
  RACE.oncePerFolder(store, 'autre', async () => { otherKeyCalls += 1; return 'ID-3'; })
]);
eq([sameKeyCalls, otherKeyCalls], [1, 1],
  'un dossier différent n’attend pas le premier (chacun travaille une fois)');

/* Après coup, un nouvel appel refait le travail : le magasin retient les
   opérations EN VOL, il n'est pas une mémoire (le dossier créé, lui, sera
   retrouvé par la RECHERCHE — c'est elle qui évite la seconde création). */
eq(await RACE.oncePerFolder(store, 'k', async () => { workCalls += 1; return 'ID-4'; }), 'ID-4',
  'un appel APRÈS la fin refait la recherche (le magasin ne ment pas)');
eq(workCalls, 2, '…donc le travail a bien tourné deux fois au total');

/* Un ÉCHEC libère la clé : le prochain appel doit pouvoir réessayer. */
let attempts = 0;
const flaky = async () => {
  attempts += 1;
  if (attempts === 1) throw new Error('Drive muet');
  return 'ID-5';
};
const failStore = new Map();
await assert.rejects(() => RACE.oncePerFolder(failStore, 'k', flaky), /Drive muet/);
eq(RACE.inFlightCount(failStore), 0, 'un échec ne laisse pas la clé occupée');
eq(await RACE.oncePerFolder(failStore, 'k', flaky), 'ID-5',
  '…donc le prochain appel réessaie pour de vrai');

/* ── 2. Le faux Drive ────────────────────────────────────────────────────────
   Un Drive minimal mais fidèle : dossiers par (parent, nom), latence réseau
   (15 ms — c'est elle qui ouvre la fenêtre « chercher puis créer »), et surtout
   un JOURNAL des créations par (parent, nom) : c'est lui qui dit si un jumeau
   est né. */
const makeDrive = (latency = 15) => {
  const folders = new Map();   // id -> { id, name, parent, createdTime, trashed }
  const creates = [];          // { name, parent, id } dans l'ordre d'arrivée
  let seq = 0;
  const mkId = (p) => `${p}${++seq}`;
  const wait = () => (latency ? new Promise((r) => setTimeout(r, latency)) : Promise.resolve());
  const res = (data, status = 200) => ({
    ok: status < 400, status,
    json: async () => data, text: async () => JSON.stringify(data)
  });
  const stamp = () => new Date(Date.UTC(2026, 8, 20, 17, 0, 0) + seq * 1000).toISOString();

  const postFolder = (name, parent = '') => {
    const id = mkId('F');
    folders.set(id, { id, name: String(name), parent: String(parent || ''), createdTime: stamp(), trashed: false });
    creates.push({ name: String(name), parent: String(parent || ''), id });
    return id;
  };

  const childrenOf = (parentId) => [...folders.values()]
    .filter((f) => f.parent === parentId && !f.trashed)
    .map((f) => ({ id: f.id, name: f.name, mimeType: FOLDER, createdTime: f.createdTime }));

  const fetchLike = async (url, init = {}) => {
    await wait();
    const u = new URL(String(url));
    const method = String(init.method || 'GET').toUpperCase();
    const q = u.searchParams.get('q') || '';

    if (method === 'POST') {
      const body = init.body && !String(init.body).includes('multipart')
        ? JSON.parse(String(init.body)) : null;
      if (body && body.mimeType === FOLDER) {
        const id = postFolder(body.name, (body.parents || [])[0] || '');
        return res({ id, name: body.name });
      }
      return res({ id: mkId('X'), name: (body && body.name) || 'file' });
    }
    if (method === 'PATCH') return res({ id: 'PATCHED' });

    const byId = /\/drive\/v3\/files\/([^/?]+)/.exec(u.pathname);
    if (byId) {
      const node = folders.get(decodeURIComponent(byId[1])) || null;
      if (!node) return res({ error: { message: 'not found' } }, 404);
      return res({ id: node.id, name: node.name, trashed: node.trashed, parents: node.parent ? [node.parent] : [] });
    }
    const wanted = (/name='((?:[^'\\]|\\.)*)'/.exec(q) || [])[1];
    const name = wanted ? wanted.replace(/\\'/g, "'") : '';
    const parent = (/'(?:([A-Za-z0-9_-]+))' in parents/.exec(q) || [])[1] || '';
    const rootOnly = /'root' in parents/.test(q);
    const folderOnly = q.includes(`mimeType='${FOLDER}'`);
    let out = rootOnly
      ? [...folders.values()].filter((f) => !f.parent && !f.trashed)
      : (parent ? childrenOf(parent) : [...folders.values()].filter((f) => !f.trashed));
    if (name) out = out.filter((n) => n.name === name);
    if (folderOnly) out = out.filter((n) => n.mimeType === FOLDER);
    return res({ files: out });
  };

  return {
    fetch: fetchLike,
    postFolder,
    /** Combien de fois ce (parent, nom) a été CRÉÉ sur ce Drive. */
    count: (name, parent) => creates.filter((c) => c.name === name && c.parent === parent).length,
    /** Les (parent, nom) créés PLUS D'UNE FOIS : les jumeaux. */
    duplicates: () => {
      const seen = new Map();
      creates.forEach((c) => {
        const k = `${c.parent || '.'}/${c.name}`;
        seen.set(k, (seen.get(k) || 0) + 1);
      });
      return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    },
    totalCreates: () => creates.length,
    foldersNamed: (name, parent) => [...folders.values()].filter((f) => f.name === name && f.parent === parent)
  };
};

/* ── 3. Le GESTE RÉEL : chercher-puis-créer en parallèle ─────────────────── */

/* 3a. TÉMOIN — l'ancienne règle, reproduite à la main : deux recherches faites
   avant la moindre création ne voient rien, donc DEUX dossiers naissent. C'est
   exactement le défaut constaté (les deux jumeaux d'`Exp_7` sont à 221 ms). */
const witness = makeDrive();
globalThis.fetch = witness.fetch;
const W = await import('./src/utils/driveUpload.js?race-witness');
const both = await Promise.all([
  W.listFoldersByName('Exp_7', 'PARENT'),
  W.listFoldersByName('Exp_7', 'PARENT')
]);
eq(both.map((g) => g.length), [0, 0],
  'témoin : les deux recherches faites AVANT la création ne voient rien');
await Promise.all([
  Promise.resolve().then(() => witness.postFolder('Exp_7', 'PARENT')),
  Promise.resolve().then(() => witness.postFolder('Exp_7', 'PARENT'))
]);
eq(witness.count('Exp_7', 'PARENT'), 2,
  'témoin : « chercher puis créer » deux fois en parallèle = DEUX dossiers (le défaut)');

/* 3b. Le correctif : deux appels simultanés sur le même dossier. */
const race = makeDrive();
globalThis.fetch = race.fetch;
const R = await import('./src/utils/driveUpload.js?race-same');
const [idA, idB] = await Promise.all([
  R.findOrCreateFolder('Exp_7', 'PARENT'),
  R.findOrCreateFolder('Exp_7', 'PARENT')
]);
eq(idA, idB, 'deux appels simultanés rendent le MÊME dossier');
eq(race.count('Exp_7', 'PARENT'), 1, '…et le Drive n’a reçu QU’UNE création (aucun jumeau)');
eq(race.duplicates(), [], 'aucun (parent, nom) créé deux fois');
const idC = await R.findOrCreateFolder('Exp_7', 'PARENT');
eq(idC, idA, 'un appel SUIVANT retrouve le dossier existant');
eq(race.count('Exp_7', 'PARENT'), 1, '…sans en créer un autre');

/* Un nom identique sous un AUTRE parent est un autre dossier (aucune confusion
   entre « le dossier Exp_7 de l'expérience A » et celui de l'expérience B). */
const idD = await R.findOrCreateFolder('Exp_7', 'AUTRE');
ok(idD !== idA, 'un même nom sous un autre parent est bien un autre dossier');
eq(race.count('Exp_7', 'AUTRE'), 1, '…créé une seule fois');

/* 3c. La CHAÎNE ENTIÈRE, deux fois en parallèle — ce que fait le NMR : l'import
   des fichiers bruts pendant que la copie de référence du spectre part. */
const chain = makeDrive();
globalThis.fetch = chain.fetch;
const C = await import('./src/utils/driveUpload.js?race-chain');
const CHAIN_NAMES = ['projects', 'p53H', 'NMR_p53H', 'Exp_19', 'data', 'Bruker_1r'];
const [c1, c2] = await Promise.all([
  C.resolveDrivePathFromNames(CHAIN_NAMES),
  C.resolveDrivePathFromNames(CHAIN_NAMES.slice())
]);
eq(c1.leafId, c2.leafId, 'les deux chaînes aboutissent au MÊME dossier');
eq(chain.duplicates(), [],
  'aucun dossier en double sur toute la chaîne (projects/<projet>/<expérience>/<instance>/data/Bruker_1r)');
eq(chain.foldersNamed('Exp_19', c1.path[2].id).length, 1, 'l’instance n’existe qu’UNE fois sous l’expérience');
eq(c1.path.map((p) => p.name).join('/'), CHAIN_NAMES.join('/'), 'le chemin canonique annoncé est celui résolu');

/* ── 4. Les jumeaux DÉJÀ présents : celui qui porte du contenu gagne ─────── */

const twins = makeDrive(0);
globalThis.fetch = twins.fetch;
const T = await import('./src/utils/driveUpload.js?race-twins');
/* Le cas réel : le jumeau ANCIEN est vide, le RÉCENT porte du contenu (et
   l'ordre rendu par le Drive n'est pas garanti — ici l'ancien arrive en tête). */
const olderEmpty = twins.postFolder('Exp_19', 'PARENT');
const newerFull = twins.postFolder('Exp_19', 'PARENT');
twins.postFolder('data', newerFull);
const picked = await T.findOrCreateFolder('Exp_19', 'PARENT');
eq(picked, newerFull,
  'entre deux jumeaux, celui qui PORTE du contenu est rendu (même s’il est plus récent)');
ok(picked !== olderEmpty, '…et surtout PAS le jumeau vide (que le Drive rendait en premier)');
eq(twins.count('Exp_19', 'PARENT'), 2, '…et aucun troisième dossier n’est créé');
eq(await T.findFolderByName('Exp_19', 'PARENT'), newerFull,
  'la LECTURE vise le même dossier (plus « le premier du nom »)');

/* À CONTENU ÉGAL, l'ANCIEN reste : c'est l'arborescence d'origine (les deux
   jumeaux d'`Exp_7` sur le Drive réel portaient chacun un `data` vide). */
const o2 = twins.postFolder('Exp_7', 'PARENT');
const n2 = twins.postFolder('Exp_7', 'PARENT');
twins.postFolder('data', o2);
twins.postFolder('data', n2);
eq(await T.findOrCreateFolder('Exp_7', 'PARENT'), o2,
  'à contenu égal, le PLUS ANCIEN est retenu (l’arborescence d’origine)');
ok(o2 !== n2, 'témoin : les deux jumeaux sont bien deux dossiers distincts');

/* ── 5. Les contrats de code (le défaut ne peut pas revenir) ─────────────── */

/* Les sources sont lues avec les fins de ligne NORMALISÉES : les motifs de
   contrat ci-dessous traversent plusieurs lignes (même convention que les autres
   suites du dépôt). */
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const UPLOAD = read('src/utils/driveUpload.js');
const RACESRC = read('src/utils/folderRace.js');
const NMR = read('src/components/NMRSections.jsx');

has(RACESRC, 'export const oncePerFolder = (store, key, work) => {',
  'folderRace expose l’opération unique par dossier');
has(RACESRC, 'store.delete(key)', '…un échec libère la clé (le prochain appel réessaie)');
has(RACESRC, 'Exp_7', '…et la raison (les jumeaux d’instance du NMR) est écrite dans le module');
has(RACESRC, 'projects/p53H/NMR_p53H/Exp_7/', '…avec le chemin réel constaté sur le Drive');

has(UPLOAD, "import { oncePerFolder, folderCreateKey } from './folderRace';",
  'driveUpload branche le module des créations uniques');
has(UPLOAD, 'const folderCreations = new Map();', '…sur UN magasin de créations en vol');
has(UPLOAD, 'export const findOrCreateFolder = async (name, parentId) => oncePerFolder(',
  'findOrCreateFolder passe par une création unique');
has(UPLOAD, 'folderCreateKey(name, parentId),\n  async () => {\n    const all = await listFoldersByName(name, parentId);',
  '…et c’est la RECHERCHE **ET** LA CRÉATION qui sont uniques (sinon la fenêtre chercher/créer reste ouverte)');
has(UPLOAD, "oncePerFolder(folderCreations, folderCreateKey('Lab Workspace', 'root')",
  'la racine « Lab Workspace » passe par là aussi (deux envois simultanés en fabriquaient deux)');
has(UPLOAD, 'const canonicalTwinOf = async (folders) => {',
  'un jumeau DÉJÀ présent est départagé par son contenu (datasetDirTwins.pickCanonicalFolder)');
ok(!/return String\(all\[0\]\.id\)/.test(UPLOAD),
  'plus aucun « premier du nom » pris pour l’identité d’un dossier');

/* Le NMR est la raison d'être du correctif : deux chaînes vers LE MÊME dossier.
   Ces contrats disent pourquoi — si l'archivage devient séquentiel, la note
   reste juste (la création unique protège tous les modules). */
has(NMR, 'void (async () => {', 'l’import NMR lance l’archivage du spectre SANS l’attendre');
has(NMR, 'canonicalExperimentPath({ ...driveCtx, instance: instanceForFile })',
  '…vers le dossier canonique de l’instance (celui des fichiers bruts)');
has(NMR, "subsection: 'Bruker 1r'", '…la même sous-section que l’import Bruker');

console.log(`_folder_race_test: ${passed} passed`);
