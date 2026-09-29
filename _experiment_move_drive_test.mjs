/* =========================================================================
   _experiment_move_drive_test.mjs — LE DOSSIER D'UNE EXPÉRIENCE MIGRE D'UN
   PROJET À L'AUTRE (sur le Drive : DÉPLACÉ, jamais copié).

   Demandé tel quel : « If an experiment is moved to another project, this must
   be reflected in the structure of the saved data on drive. This means its
   folder must migrate in the folder of the new project (moved, not copied). »

   Une expérience = un test = UN dossier Drive (`projects/<projet>/<test>`, voir
   canonicalExperimentPath) : le geste ⇄ « Move to project » de la page projet
   doit donc faire MIGRER ce dossier — le déplacer par son identifiant (côté
   Drive : `files.update` avec `addParents` + `removeParents`), pas le recopier
   sous le nouveau projet.

   Vérifié ici sur le module RÉEL (src/utils/driveUpload.js) branché sur un faux
   Drive qui tient les VRAIS parents de chaque nœud :
     1. le dossier de l'expérience quitte le projet quitté et arrive dans le
        projet visé (même identifiant, UN SEUL parent) — l'ancien chemin
        disparaît, le dossier vidé du projet quitté part à la corbeille, et son
        contenu (instances, sections, fichiers) suit intact ;
     2. si un dossier du MÊME nom est déjà dans le projet visé, le contenu est
        FUSIONNÉ dedans (aucun second dossier du même nom : deux dossiers
        frères éparpilleraient les fichiers de l'expérience) ;
     3. un homonyme N'EST PAS écrasé : il est laissé en place et signalé ;
     4. TOUT ce qui porte ce nom migre : le bac `projects/test`, l'ancien bac
        `projects/_unassigned`, l'héritage à la racine du dataset ;
     5. le dossier du projet visé n'est PAS semé quand il n'y a rien à ranger ;
     6. le registre des fichiers suit (ctx.project + chemin refait), et la copie
        d'un AUTRE projet resté lié ne bouge pas (many-to-many) ;
     7. sans Drive connecté, rien n'est touché — et les contrats de code qui
        empêchent la copie de revenir.
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
const has = (hay, needle, what) => {
  assert.ok(String(hay).includes(needle), `${what}\n  fragment absent : ${needle}`);
  passed += 1;
};

const UPLOAD = readFileSync('./src/utils/driveUpload.js', 'utf8').replace(/\r\n/g, '\n');
const FOLDER = 'application/vnd.google-apps.folder';

/* ── Le module RÉEL, branché sur un faux Drive ──────────────────────────────
   Le crochet des tests résout les imports SANS extension de src/ ; ici c'est le
   module RÉEL qu'on veut, donc `?mv-N` (le crochet ne remplace que le specifier
   exact `src/utils/driveUpload.js`), et chaque scénario reçoit SA propre
   instance : l'état du module (racine résolue, dossiers en vol) ne doit pas
   fuir d'un scénario à l'autre. */
register('./_esm_test_hook.mjs', import.meta.url);

/** Le localStorage du navigateur : le jeton, le dossier de dataset déjà connu
 *  (chemin rapide de `ensureDriveFolder`), le registre des fichiers. */
const makeStorage = ({ token = 'fake-token', rootId = 'DS', registry = null } = {}) => {
  const store = new Map();
  if (token) store.set('labDriveAccessToken', token);
  if (rootId) store.set('labDriveFolderId', rootId);
  if (registry) store.set('labDriveFileRegistry', JSON.stringify(registry));
  return {
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => { store.delete(String(k)); },
    clear: () => store.clear()
  };
};

/** Le module réel, une instance NEUVE par scénario. */
const loadModule = async (tag) => import(`./src/utils/driveUpload.js?mv-${tag}`);

/** Un faux Drive : chaque nœud garde ses VRAIS parents (c'est ce qui permet de
 *  distinguer « déplacé » de « copié »), les recherches par `q` sont
 *  interprétées, et tout est journalisé (créations, déplacements, corbeille). */
const makeDrive = () => {
  const nodes = new Map();
  let seq = 0;
  const log = [];
  const res = (data, status = 200) => ({
    ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data)
  });
  const add = (name, parents = [], mimeType = FOLDER) => {
    const id = `N${++seq}`;
    nodes.set(id, { id, name: String(name), parents: parents.map(String), mimeType, trashed: false });
    return id;
  };
  const node = (id) => nodes.get(String(id)) || null;
  const parseQ = (q) => {
    const m = q.match(/name='((?:[^'\\]|\\.)*)'/);
    const p = q.match(/'([^']+)' in parents/);
    return {
      hasName: Boolean(m),
      name: m ? m[1].replace(/\\'/g, "'") : '',
      parent: p ? p[1] : '',
      foldersOnly: /mimeType=/.test(q)
    };
  };
  const fetchLike = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = String(init.method || 'GET').toUpperCase();
    const bare = u.pathname === '/drive/v3/files';
    const body = init.body && !String(init.body).includes('multipart') ? JSON.parse(String(init.body)) : null;

    if (method === 'POST' && bare) {
      const made = add(body.name, body.parents || [], body.mimeType || 'application/octet-stream');
      log.push({ op: 'create', name: String(body.name), parent: String((body.parents || [])[0] || '') });
      return res({ id: made, name: body.name });
    }
    if (method === 'GET' && bare) {
      const { hasName, name, parent, foldersOnly } = parseQ(u.searchParams.get('q') || '');
      const files = [...nodes.values()]
        .filter((n) => !n.trashed
          && (!parent || n.parents.includes(parent))
          && (!hasName || n.name === name)
          && (!foldersOnly || n.mimeType === FOLDER))
        .map((n) => ({ id: n.id, name: n.name, mimeType: n.mimeType, createdTime: '' }));
      return res({ files });
    }
    const target = node(u.pathname.split('/').pop());
    if (!target) return res({ error: { message: 'File not found' } }, 404);
    if (method === 'GET') {
      return res({ id: target.id, name: target.name, trashed: target.trashed, parents: target.parents.slice() });
    }
    if (method === 'PATCH') {
      const addParent = u.searchParams.get('addParents') || '';
      const removeParents = u.searchParams.getAll('removeParents');
      if (addParent || removeParents.length) {
        log.push({ op: 'move', id: target.id, add: addParent, remove: removeParents.slice() });
        const kept = target.parents.filter((p) => !removeParents.includes(p));
        target.parents = [...new Set([...kept, ...(addParent ? [addParent] : [])])];
      } else if (body && body.trashed !== undefined) {
        target.trashed = Boolean(body.trashed);
        log.push({ op: target.trashed ? 'trash' : 'untrash', id: target.id });
      }
      if (body && body.name) target.name = String(body.name);
      return res({ id: target.id, name: target.name, trashed: target.trashed, parents: target.parents.slice() });
    }
    return res({ error: { message: `unhandled ${method}` } }, 500);
  };

  return {
    add, node, fetch: fetchLike, log,
    /** Le chemin LISIBLE d'un nœud, depuis le dossier du dataset. */
    path: (id) => {
      const names = [];
      let cur = node(id);
      while (cur && names.length < 12) {
        names.unshift(cur.name);
        cur = cur.parents.length ? node(cur.parents[0]) : null;
      }
      return names.join('/');
    },
    live: (id) => { const n = node(id); return Boolean(n) && !n.trashed; },
    named: (name, parent = '') => [...nodes.values()]
      .filter((n) => !n.trashed && n.name === name && (!parent || n.parents.includes(String(parent)))),
    childrenOf: (parent) => [...nodes.values()].filter((n) => !n.trashed && n.parents.includes(String(parent))),
    childNames: (parent) => [...nodes.values()]
      .filter((n) => !n.trashed && n.parents.includes(String(parent))).map((n) => n.name).sort(),
    ops: (op) => log.filter((e) => e.op === op),
    creates: () => log.filter((e) => e.op === 'create').map((e) => `${e.parent || '.'}/${e.name}`),
    moved: () => log.filter((e) => e.op === 'move')
  };
};

/** Un dataset neuf : `DS/projects/…` (le conteneur canonique) et ses projets. */
const makeDataset = (projectNames = []) => {
  const drive = makeDrive();
  const projects = drive.add('projects', ['DS']);
  const ids = { projects };
  for (const name of projectNames) ids[name] = drive.add(name, [projects]);
  return { drive, ids };
};

/* ══ 1. LE DOSSIER MIGRE : DÉPLACÉ, JAMAIS COPIÉ ═══════════════════════════ */
{
  const { drive, ids } = makeDataset(['p53H']);
  const exp = drive.add('NMR_p53H', [ids.p53H]);
  const instance = drive.add('Exp_7', [exp]);
  const data = drive.add('data', [instance]);
  drive.add('spectrum.csv', [data], 'text/csv');
  const reports = drive.add('Report', [exp]);
  drive.add('report.docx', [reports], 'application/msword');

  globalThis.localStorage = makeStorage({
    registry: {
      f1: {
        name: 'spectrum.csv',
        ctx: { test: 'NMR_p53H', project: 'p53H', instance: 'Exp_7', section: 'data' },
        path: [{ name: 'projects', id: ids.projects }, { name: 'p53H', id: ids.p53H },
          { name: 'NMR_p53H', id: exp }, { name: 'Exp_7', id: instance }, { name: 'data', id: data }]
      },
      f2: {
        name: 'report.docx',
        ctx: { test: 'NMR_p53H', project: '' },
        path: [{ name: 'projects', id: ids.projects }, { name: 'p53H', id: ids.p53H },
          { name: 'NMR_p53H', id: exp }, { name: 'Report', id: reports }]
      },
      f3: {
        name: 'other.csv',
        ctx: { test: 'NMR_p53H', project: 'Other' },
        path: [{ name: 'projects', id: ids.projects }, { name: 'Other', id: 'NZ' }, { name: 'NMR_p53H', id: 'NZ2' }]
      },
      f4: { name: 'gone.csv', deleted: true, ctx: { test: 'NMR_p53H', project: 'p53H' }, path: [] }
    }
  });
  globalThis.fetch = drive.fetch;
  const M = await loadModule('migrate');

  const rep = await M.moveTestFolderBetweenProjects({
    testName: 'NMR_p53H', fromProjectName: 'p53H', toProjectName: 'NADH'
  });
  const nadh = drive.named('NADH', ids.projects)[0];

  eq(rep, { folders: 1, merged: 0, registry: 2, kept: 0 },
    'un dossier DÉPLACÉ et deux entrées du registre réécrites (la copie d’un autre projet ne bouge pas)');
  ok(nadh, 'le dossier du projet visé est retrouvé ou créé');
  eq(drive.path(exp), 'projects/NADH/NMR_p53H',
    'le dossier de l’expérience est maintenant DANS le dossier du projet visé');
  eq(drive.node(exp).parents, [nadh.id],
    '…par DÉPLACEMENT : son seul parent est le projet visé (l’ancien parent a été retiré)');
  eq(drive.named('NMR_p53H').length, 1, '…et il n’en existe qu’UN (aucune copie laissée derrière)');
  eq(drive.moved(), [{ op: 'move', id: exp, add: nadh.id, remove: [ids.p53H] }],
    'le geste Drive est addParents + removeParents sur le MÊME identifiant de dossier');
  eq(drive.node(exp).id, exp, 'l’identifiant du dossier ne change pas (un déplacement, pas un nouvel envoi)');

  eq(drive.path(instance), 'projects/NADH/NMR_p53H/Exp_7',
    'les instances de condition suivent (déplacer le dossier les emporte)');
  eq(drive.path(data), 'projects/NADH/NMR_p53H/Exp_7/data', '…jusqu’aux sections');
  eq(drive.childNames(reports), ['report.docx'], '…et les fichiers restent dedans');
  eq(drive.childNames(ids.p53H), [], 'le dossier du projet quitté se vide');
  ok(drive.node(ids.p53H).trashed, '…et part à la corbeille : l’ancien chemin disparaît');
  eq(drive.path(ids.projects), 'projects', 'le conteneur projects reste intact');

  const reg = JSON.parse(globalThis.localStorage.getItem('labDriveFileRegistry'));
  eq(reg.f1.ctx.project, 'NADH', 'le registre suit : le fichier appartient au projet visé');
  eq(reg.f1.path.map((s) => s.name).join('/'), 'projects/NADH/NMR_p53H/Exp_7/data',
    '…et son chemin est refait sous le projet visé');
  eq([reg.f1.path[1].id, reg.f1.path[2].id], [nadh.id, exp],
    '…avec les identifiants RÉELS du projet visé et du dossier déplacé');
  eq(reg.f2.ctx.project, 'NADH', 'un fichier sans projet (bac) rejoint lui aussi le projet visé');
  eq(reg.f2.path.map((s) => s.name).join('/'), 'projects/NADH/NMR_p53H/Report', '…avec son chemin complet');
  eq(reg.f3.ctx.project, 'Other', 'la copie d’un AUTRE projet resté lié ne bouge pas (many-to-many)');
  eq(reg.f3.path.map((s) => s.name).join('/'), 'projects/Other/NMR_p53H', '…ni son chemin');
  eq(reg.f4.ctx.project, 'p53H', 'un fichier marqué supprimé n’est pas touché');
}

/* ══ 2. LE CONTENU EST FUSIONNÉ : AUCUN SECOND DOSSIER DU MÊME NOM ═════════ */
/*  L'expérience était DÉJÀ liée au projet visé (many-to-many) : son dossier du
    même nom y attend. Poser un second dossier frère éparpillerait ses fichiers
    (c'est le défaut des « jumeaux d'INSTANCE », voir DRIVE-MIRROR.md). */
{
  const { drive, ids } = makeDataset(['p53H', 'NADH']);
  const srcExp = drive.add('NMR_p53H', [ids.p53H]);
  const src7 = drive.add('Exp_7', [srcExp]);
  drive.add('spectrum.csv', [src7], 'text/csv');
  const src19 = drive.add('Exp_19', [srcExp]);
  drive.add('x.csv', [src19], 'text/csv');
  const keeper = drive.add('NMR_p53H', [ids.NADH]);
  const keeper7 = drive.add('Exp_7', [keeper]);
  drive.add('notes.txt', [keeper7], 'text/plain');

  globalThis.localStorage = makeStorage();
  globalThis.fetch = drive.fetch;
  const M = await loadModule('merge');

  const rep = await M.moveTestFolderBetweenProjects({
    testName: 'NMR_p53H', fromProjectName: 'p53H', toProjectName: 'NADH'
  });

  eq([rep.folders, rep.merged, rep.kept], [0, 1, 0],
    'le dossier est FUSIONNÉ (il n’est pas déplacé : son nom est déjà dans le projet visé)');
  eq(drive.named('NMR_p53H', ids.NADH).length, 1,
    'le projet visé ne porte toujours QU’UN dossier du nom de l’expérience');
  ok(drive.live(keeper), '…c’est le dossier déjà en place qui est gardé (même départage que findFolderByName)');
  ok(!drive.live(srcExp), 'le dossier venu du projet quitté, une fois vidé, part à la corbeille');
  eq(drive.childNames(keeper), ['Exp_19', 'Exp_7'], 'les instances des deux côtés sont réunies sous le dossier gardé');
  eq(drive.node(src19).parents, [keeper], 'l’instance qui n’existait que chez le projet quitté a été DÉPLACÉE');
  eq(drive.childNames(keeper7), ['notes.txt', 'spectrum.csv'],
    'les fichiers des deux instances de la même condition se retrouvent dans la MÊME instance');
  ok(!drive.live(src7), 'l’instance vidée par la fusion part à la corbeille');
  eq(drive.childNames(ids.p53H), [], 'le dossier du projet quitté se vide');
  ok(drive.node(ids.p53H).trashed, '…et part à la corbeille');
  eq(drive.creates(), [], 'aucun dossier créé (le projet visé et son dossier d’expérience existaient déjà)');
}

/* ══ 3. UN HOMONYME N’EST JAMAIS ÉCRASÉ ════════════════════════════════════ */
/*  Même nom de fichier des deux côtés : on ne peut pas deviner lequel est « le
    bon ». Le fichier gardé est celui du projet visé, l'autre reste où il est et
    le dossier qui le porte est SIGNALÉ (report.kept) — la politique de
    `_repair_drive_twins.mjs`. Rien n'est perdu, rien n'est écrasé. */
{
  const { drive, ids } = makeDataset(['p53H', 'NADH']);
  const srcExp = drive.add('NMR_p53H', [ids.p53H]);
  const src7 = drive.add('Exp_7', [srcExp]);
  const srcFile = drive.add('spectrum.csv', [src7], 'text/csv');
  const keeper = drive.add('NMR_p53H', [ids.NADH]);
  const keeper7 = drive.add('Exp_7', [keeper]);
  const keeperFile = drive.add('spectrum.csv', [keeper7], 'text/csv');

  globalThis.localStorage = makeStorage();
  globalThis.fetch = drive.fetch;
  const M = await loadModule('homonym');

  const rep = await M.moveTestFolderBetweenProjects({
    testName: 'NMR_p53H', fromProjectName: 'p53H', toProjectName: 'NADH'
  });

  eq([rep.merged, rep.kept], [1, 1],
    'l’homonyme est SIGNALÉ : le dossier d’où il vient n’est pas vide, donc pas rangé à la corbeille');
  ok(drive.live(srcFile) && drive.live(keeperFile), 'les DEUX fichiers du même nom survivent — rien n’est écrasé');
  eq(drive.path(keeperFile), 'projects/NADH/NMR_p53H/Exp_7/spectrum.csv', 'celui du projet visé n’a pas bougé');
  eq(drive.path(srcFile), 'projects/p53H/NMR_p53H/Exp_7/spectrum.csv',
    '…et l’autre est resté où il était (c’est _repair_drive_twins.mjs qui départage les homonymes)');
  eq(drive.childNames(src7), ['spectrum.csv'], '…avec son instance, conservée parce qu’elle n’est pas vide');
}

/* ══ 4. TOUT CE QUI PORTE CE NOM MIGRE (bac, ancien bac, racine) ═══════════ */
/*  Le dossier d'une expérience peut traîner à plusieurs endroits : les anciens
    défauts du programme l'ont laissé dans le bac `projects/test`, dans l'ancien
    bac `projects/_unassigned`, ou à la racine du dataset. S'il en restait un
    derrière, `findFolderByName` continuerait de le rendre : l'expérience
    vivrait à DEUX endroits. */
{
  const { drive, ids } = makeDataset(['p53H']);
  const inProject = drive.add('NMR_p53H', [ids.p53H]);
  drive.add('Exp_1', [inProject]);
  const bucket = drive.add('test', [ids.projects]);
  const inBucket = drive.add('NMR_p53H', [bucket]);
  drive.add('Exp_2', [inBucket]);
  const legacyBucket = drive.add('_unassigned', [ids.projects]);
  const inLegacy = drive.add('NMR_p53H', [legacyBucket]);
  drive.add('Exp_3', [inLegacy]);
  const atRoot = drive.add('NMR_p53H', ['DS']);
  drive.add('Exp_4', [atRoot]);
  const nadh = drive.add('NADH', [ids.projects]);

  globalThis.localStorage = makeStorage();
  globalThis.fetch = drive.fetch;
  const M = await loadModule('sweep');

  const rep = await M.moveTestFolderBetweenProjects({
    testName: 'NMR_p53H', fromProjectName: 'p53H', toProjectName: 'NADH'
  });

  eq([rep.folders, rep.merged], [1, 3],
    'le dossier du projet quitté est DÉPLACÉ, les trois copies restées ailleurs sont FUSIONNÉES dedans');
  eq(drive.named('NMR_p53H').length, 1, 'il ne reste QU’UN dossier portant le nom de l’expérience sur tout le Drive');
  const survivor = drive.named('NMR_p53H', nadh)[0];
  eq(survivor.id, inProject, 'c’est le dossier du projet quitté qui devient celui du projet visé (même identifiant)');
  eq(drive.childNames(survivor.id), ['Exp_1', 'Exp_2', 'Exp_3', 'Exp_4'], 'les quatre instances sont réunies');
  ok(drive.node(bucket).trashed && drive.node(legacyBucket).trashed && drive.node(ids.p53H).trashed,
    'les conteneurs vidés (bac, ancien bac, projet quitté) partent à la corbeille');
  eq(drive.path(ids.projects), 'projects', 'le conteneur projects reste');
  eq(drive.creates(), [], 'aucun dossier créé (tout existait déjà)');
}

/* ══ 5. RIEN À DÉPLACER : ON NE SÈME RIEN DANS LE PROJET VISÉ ══════════════ */
{
  const { drive, ids } = makeDataset(['p53H']);

  globalThis.localStorage = makeStorage();
  globalThis.fetch = drive.fetch;
  const M = await loadModule('nothing');

  const rep = await M.moveTestFolderBetweenProjects({
    testName: 'NMR_p53H', fromProjectName: 'p53H', toProjectName: 'NADH'
  });

  eq(rep, { folders: 0, merged: 0, registry: 0, kept: 0 }, 'aucun dossier d’expérience sur le Drive → rien à faire');
  eq(drive.creates(), [], '…et surtout aucun dossier n’est SEMÉ dans le projet visé');
  eq(drive.log, [], 'aucune écriture du tout (que des lectures)');
  eq(drive.named('NADH').length, 0, 'le projet visé n’apparaît pas sur le Drive avant sa première vraie expérience');
}

/* ══ 6. SANS DRIVE CONNECTÉ : RIEN N’EST TOUCHÉ ════════════════════════════ */
/*  Le déplacement des DONNÉES a déjà eu lieu (le magasin est écrit) : le geste
    Drive est « au mieux ». Il ne doit surtout pas écrire à moitié. */
{
  const { drive, ids } = makeDataset(['p53H']);
  const exp = drive.add('NMR_p53H', [ids.p53H]);

  globalThis.localStorage = makeStorage({ token: '' });
  globalThis.fetch = drive.fetch;
  const M = await loadModule('offline');

  const rep = await M.moveTestFolderBetweenProjects({
    testName: 'NMR_p53H', fromProjectName: 'p53H', toProjectName: 'NADH'
  });

  eq(rep, { folders: 0, merged: 0, registry: 0, kept: 0 }, 'sans Drive connecté, le geste ne fait rien');
  eq(drive.node(exp).parents, [ids.p53H], '…le dossier ne bouge pas d’un pouce');
  eq(drive.log, [], 'aucune écriture tentée sur le Drive');
}

/* ══ 7. LES GARDE-FOUS ═════════════════════════════════════════════════════ */
{
  const { drive, ids } = makeDataset(['p53H', 'NADH']);
  const exp = drive.add('NMR_p53H', [ids.p53H]);

  globalThis.localStorage = makeStorage();
  globalThis.fetch = drive.fetch;
  const M = await loadModule('guards');
  const zero = { folders: 0, merged: 0, registry: 0, kept: 0 };

  eq(await M.moveTestFolderBetweenProjects({ testName: 'NMR_p53H', fromProjectName: 'p53H', toProjectName: 'p53H' }),
    zero, 'projet de départ = projet visé → rien à faire');
  eq(await M.moveTestFolderBetweenProjects({ testName: '', fromProjectName: 'p53H', toProjectName: 'NADH' }),
    zero, 'sans nom d’expérience → rien à faire');
  eq(await M.moveTestFolderBetweenProjects({ testName: 'NMR_p53H', fromProjectName: 'p53H' }),
    zero, 'sans projet visé → rien à faire');
  eq(drive.log, [], 'aucun de ces appels n’a écrit sur le Drive');
  eq(drive.node(exp).parents, [ids.p53H], 'le dossier de l’expérience n’a pas bougé');
}

/* ══ 8. LES CONTRATS DE CODE (empêcher la copie de revenir) ═══════════════ */
has(UPLOAD, "params.set('addParents', newParentId);",
  'un déplacement Drive est un addParents + removeParents (le seul chemin)');
ok(!/\/drive\/v3\/files\/[^'`"]*\/copy/.test(UPLOAD),
  'aucun appel `files.copy` dans le module : le dossier n’est jamais recopié');
has(UPLOAD, 'export const moveTestFolderBetweenProjects = async ({ testName, fromProjectName, toProjectName }) => {',
  'le geste est exporté (c’est lui que la page projet appelle)');
has(UPLOAD, 'const toFolderId = await findOrCreateFolder(toSlug, projectsId);',
  'le dossier du projet visé est RETROUVÉ ou créé — jamais recopié');
has(UPLOAD, 'await moveDriveFile(src.id, toFolderId); // DÉPLACÉ (addParents + removeParents)',
  'le dossier de l’expérience est déplacé PAR SON IDENTIFIANT');
has(UPLOAD, 'if (owner && sanitizeSlug(owner) !== fromSlug) continue;',
  'la copie d’un projet resté lié n’est pas réécrite (many-to-many)');

console.log(`_experiment_move_drive_test.mjs — ${passed} assertions OK (le dossier d'une expérience MIGRE sous le projet visé)`);

