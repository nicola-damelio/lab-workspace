/* =========================================================================
   _drive_tidy_test.mjs — « RIMETTE IN ORDINE » LE DRIVE.

   La demande, mot pour mot : « … sono comparse le cartelle giuste ma restano un
   sacco di cartelle inutili (anche se il pdb non c'era). non potresti fare una
   funzione che controlla la corrispondenza del google drive con l'organizzazione
   del programma e rimette in ordine? »

   Vérifié ici :

     A. LA DÉCISION, pure (src/utils/driveTidy.js) : jumeaux de dossiers (garde
        celui du plan, sinon le plus fourni ; ne touche jamais un jumeau qui
        cache un fichier unique), restes VIDES, dossiers d'objets SUPPRIMÉS,
        dossiers des pages (sous une feuille du plan) laissés tranquilles,
        dossiers inconnus AVEC du contenu seulement signalés, fichiers jumeaux
        jamais rangés (l'heure de modification n'est pas dans la liste) ;
     B. CE QUE L'APPLICATION CHERCHE : les `.pdb` pointés par une fiche
        (`<expérience>_files.json`) qui ne sont plus sur le Drive — la réponse à
        « nessuna delle sottocartelle c'era il pdb » ;
     C. L'EXÉCUTEUR, sur un faux Drive : le scénario rapporté (un dossier
        d'expérience resté au nom de l'instance, contenant `1YCR/1YCR` avec son
        pdb) — la publication ADOPTE/RENOMME, puis le rangement met à la
        corbeille ce qui est PROUVÉ en trop, et le compte-rendu le dit ;
     D. LES CONTRATS : le panneau des Réglages, le geste d'App.jsx, et la
        corbeille (jamais de destruction).
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

register('./_esm_test_hook.mjs', import.meta.url);

const T = await import('./src/utils/driveTidy.js');
const S = await import('./src/utils/driveStructure.js');
const {
  TIDY_KINDS, planTidy, planIndex, pointedFilesIn, missingPointedFiles,
  tidySummaryLines, tidySummaryText, tidyDatasetStructure
} = T;

/* ── A. LA DÉCISION, PURE ────────────────────────────────────────────────── */

/* Le plan du dépôt, tel que driveStructure le fabrique : `projects`, le projet,
   l'expérience (id de l'objet), l'instance. */
const PLAN = S.datasetMirrorPlan({
  datasetId: 'ds1',
  datasetName: 'GEC-UPJV-projects',
  data: {
    projects: [{ id: 'p1', name: 'NATURAL_ARSENAL' }],
    tests: [{
      id: 't1', name: 'interaction_pdbs', projectNames: ['NATURAL_ARSENAL'],
      instanceName: '1YCR', project: 'NATURAL_ARSENAL'
    }]
  }
});
const EXP = 'projects/NATURAL_ARSENAL/interaction_pdbs';
const INS = `${EXP}/1YCR`;
const idx = planIndex(PLAN);
ok(idx.folders.has('projects') && idx.folders.has('projects/NATURAL_ARSENAL') && idx.folders.has(EXP) && idx.folders.has(INS),
  'le plan connaît le conteneur, le projet, l’expérience et l’instance');

/* Un dossier lu par l'exécuteur. `parent` = l'IDENTIFIANT du dossier parent : le
   sous-arbre se compte par identifiant, parce que deux jumeaux partagent leur
   chemin (voir subtreeOf). */
const folder = (id, path, { parent = '', appId = '', files = [], folders = [] } = {}) =>
  ({ id, parentId: parent, path, name: path.split('/').pop(), appId, fileNames: files, folderNames: folders, hasMeta: !!appId });
const file = (id, path, name, size = 10, parent = '') => ({ id, parentId: parent, path, name, size });

/* a) Un dossier du plan n'est jamais touché. */
const clean = planTidy({ plan: PLAN, folders: [folder('F1', EXP), folder('F2', INS)], files: [] });
eq(clean.trash, [], 'un dossier du plan ne va jamais à la corbeille');
eq(clean.counts.kept, 2, '…et les deux sont comptés comme gardés');

/* b) DOSSIERS JUMEAUX : celui que le plan désigne (son identifiant) gagne, même
   s'il porte moins de contenu ; l'autre part à la corbeille. */
const twins = planTidy({
  plan: PLAN,
  folders: [
    folder('F_NEW', INS, { parent: 'F_EXP', appId: 't1' }),
    folder('F_OLD', INS, { parent: 'F_EXP' })
  ],
  files: [file('pdb1', INS, '1YCR.pdb', 5928759, 'F_NEW'), file('pdb2', INS, '1YCR.pdb', 5928759, 'F_OLD')]
});
eq(twins.trash.map((t) => t.id), ['F_OLD'], 'deux dossiers du même nom : celui du plan est gardé, l’autre est rangé');
eq(twins.trash[0].kind, TIDY_KINDS.TWIN_FOLDER, '…comme DOUBLON de dossier');
eq(twins.warnings.map((w) => w.kind), [TIDY_KINDS.TWIN_FILE],
  '…et rien d’autre n’est signalé (le doublon de FICHIERS, lui, est signalé mais jamais rangé)');

/* c) …MAIS un jumeau qui cache un fichier que l'autre n'a PAS n'est pas rangé :
   le pdb d'un dossier resté derrière est un contenu, pas un doublon. */
const guarded = planTidy({
  plan: PLAN,
  folders: [
    folder('F_NEW', INS, { parent: 'F_EXP', appId: 't1' }),
    folder('F_OLD', INS, { parent: 'F_EXP' }),
    folder('F_DATA', `${INS}/Data`, { parent: 'F_OLD' }),
    folder('F_STRUCT', `${INS}/Data/Structure`, { parent: 'F_DATA' })
  ],
  files: [file('pdb', `${INS}/Data/Structure`, '1YCR.pdb', 5928759, 'F_STRUCT')]
});
eq(guarded.trash, [], 'un jumeau qui porte un fichier unique n’est JAMAIS rangé');
eq(guarded.warnings.map((w) => w.kind), [TIDY_KINDS.TWIN_FOLDER_MERGE],
  '…il est SIGNALÉ (fusionner deux contenus est une décision humaine)');
has(guarded.warnings[0].detail, '1YCR.pdb', '…et le fichier qui bloque est nommé');

/* d) Un reste VIDE (aucun fichier à aucune profondeur) part à la corbeille ;
   un dossier qui ne porte QUE sa description aussi. */
const empties = planTidy({
  plan: PLAN,
  folders: [
    folder('F_E1', 'projects/NATURAL_ARSENAL/instance1', { parent: 'F_PRJ' }),
    folder('F_E2', 'projects/NATURAL_ARSENAL/2YCR', { parent: 'F_PRJ', appId: 't1' })
  ],
  files: [file('meta', 'projects/NATURAL_ARSENAL/2YCR', '_meta.json', 10, 'F_E2')]
});
eq(empties.trash.map((t) => [t.id, t.kind]),
  [['F_E1', TIDY_KINDS.EMPTY_FOLDER], ['F_E2', TIDY_KINDS.EMPTY_FOLDER]],
  'un dossier hors plan sans AUCUN contenu va à la corbeille (sa description ne compte pas)');

/* e) Un dossier d'objet SUPPRIMÉ (identifiant qui n'est plus dans le plan) part
   à la corbeille, même s'il porte des fichiers. */
const deleted = planTidy({
  plan: PLAN,
  folders: [folder('F_DEL', `${EXP}/instance2`, { parent: 'F_EXP', appId: 't99' })],
  files: [file('sp', `${EXP}/instance2`, 'spectrum.json', 20, 'F_DEL')]
});
eq(deleted.trash.map((t) => [t.id, t.kind]), [['F_DEL', TIDY_KINDS.DELETED_OBJECT_FOLDER]],
  'le dossier d’une instance supprimée est rangé (l’application ne la connaît plus)');

/* f) Les dossiers d'une PAGE (sous une FEUILLE du plan : `Data/Structure`,
   `Bruker_1r`…) sont laissés tranquilles, sans bruit. */
const pageFolders = planTidy({
  plan: PLAN,
  folders: [
    folder('F_DATA', `${INS}/Data`, { parent: 'F_INS' }),
    folder('F_STRUCT', `${INS}/Data/Structure`, { parent: 'F_DATA' })
  ],
  files: [file('pdb', `${INS}/Data/Structure`, '1YCR.pdb', 100, 'F_STRUCT')]
});
eq([pageFolders.trash, pageFolders.warnings], [[], []],
  'un dossier de page (sous une feuille du plan) n’est ni rangé ni signalé');

/* g) Un dossier INCONNU avec du contenu, ailleurs, est signalé et JAMAIS rangé. */
const orphan = planTidy({
  plan: PLAN,
  folders: [folder('F_X', 'projects/NATURAL_ARSENAL/1YCR', { parent: 'F_PRJ' })],
  files: [file('n', 'projects/NATURAL_ARSENAL/1YCR', 'note.txt', 30, 'F_X')]
});
eq(orphan.trash, [], 'un dossier inconnu qui porte un fichier n’est jamais rangé');
eq(orphan.warnings.map((w) => w.kind), [TIDY_KINDS.ORPHAN_FOLDER], '…il est signalé comme hors de l’arborescence');
eq(orphan.warnings[0].path, 'projects/NATURAL_ARSENAL/1YCR', '…avec son chemin');

/* h) FICHIERS JUMEAUX : jamais rangés (la liste ne porte pas l'heure de
   modification), signalés avec leurs tailles. */
const fileTwins = planTidy({
  plan: PLAN,
  folders: [folder('F2', INS, { parent: 'F_EXP' })],
  files: [
    file('a', INS, '1YCR.pdb', 5928759, 'F2'), file('b', INS, '1YCR.pdb', 5928759, 'F2'),
    file('c', INS, '2.pdb', 10, 'F2'), file('d', INS, '2.pdb', 20, 'F2')
  ]
});
eq(fileTwins.trash, [], 'aucun fichier n’est rangé par le rangement des dossiers');
eq(fileTwins.warnings.filter((w) => w.kind === TIDY_KINDS.TWIN_FILE).length, 1, 'deux copies identiques sont signalées');
eq(fileTwins.warnings.filter((w) => w.kind === TIDY_KINDS.TWIN_FILE_DIFFER).length, 1, '…et deux copies qui DIFFÈRENT aussi');
eq(fileTwins.counts.twinFiles, 2, 'le compte des fichiers en double est là');

/* i) Un dossier rangé emporte ses enfants : on ne liste pas deux fois. */
const nested = planTidy({
  plan: PLAN,
  folders: [
    folder('F_Y', 'projects/NATURAL_ARSENAL/vide', { parent: 'F_PRJ' }),
    folder('F_Z', 'projects/NATURAL_ARSENAL/vide/dedans', { parent: 'F_Y' })
  ],
  files: []
});
eq(nested.trash.map((t) => t.id), ['F_Y'], 'un seul geste suffit : le dossier du haut emporte celui du bas');

/* ── B. CE QUE L'APPLICATION CHERCHE (les `.pdb` pointés) ────────────────── */

/* Un identifiant Drive a la forme que la recherche de pointeurs reconnaît
   (`/^[\w-]{10,}$/`) : on en prend un vrai. */
const PDB_ID = '1YCRpdb1234567890abcdef';

const PLAN_WITH_POINTERS = S.datasetMirrorPlan({
  datasetId: 'ds1',
  datasetName: 'GEC-UPJV-projects',
  data: {
    projects: [{ id: 'p1', name: 'NATURAL_ARSENAL' }],
    tests: [{
      id: 't1', name: 'interaction_pdbs', projectNames: ['NATURAL_ARSENAL'],
      instanceName: '1YCR', project: 'NATURAL_ARSENAL',
      /* Ce qu'une page laisse derrière elle : l'identifiant Drive du `.pdb`
         qu'elle a déposé — c'est la forme que la fiche de l'expérience garde
         (voir driveStructure.drivePointersIn : une clé qui dit « fichier » ET
         finit par `Id`). C'est par LÀ qu'on peut dire « l'application le
         cherche encore, le Drive ne l'a plus ». */
      pdbFileId: PDB_ID,
      /* Un pointeur IMBRIQUÉ : le plan retient le chemin du contenant
         (`structure`), c'est ce que le compte-rendu affichera. */
      structure: { pdbFileId: 'NestedPdbId1234567890ab' }
    }]
  }
});
const pointed = pointedFilesIn(PLAN_WITH_POINTERS);
eq(pointed.length, 2, 'la fiche de l’expérience nomme les fichiers qu’une page a déposés');
eq(pointed[0].id, PDB_ID, '…avec leur identifiant Drive');
eq(pointed[0].name, '', 'à la racine de l’objet, la fiche ne retient aucun chemin (donc aucun libellé)');
eq(pointed[1].name, 'structure', '…et un pointeur imbriqué retient le chemin de son contenant');

/* Les réponses du Drive pour les DEUX pointeurs : le premier est là (ou non),
   le second est toujours là — le fichier testé est le premier. */
const NESTED_ID = 'NestedPdbId1234567890ab';
const metasOf = (first) => new Map([
  [PDB_ID, first],
  [NESTED_ID, { trashed: false, name: 'nested.pdb' }]
]);

eq(missingPointedFiles(PLAN_WITH_POINTERS, null), [],
  'sans réponse du Drive, on n’affirme RIEN (on ne prétend pas qu’un fichier manque)');
eq(missingPointedFiles(PLAN_WITH_POINTERS, metasOf({ trashed: false, name: '1YCR.pdb' })), [],
  'un fichier toujours là n’est pas signalé');
const gone = missingPointedFiles(PLAN_WITH_POINTERS, metasOf(null));
eq(gone.length, 1, 'un fichier que le Drive n’a PLUS est signalé');
has(gone[0].detail, 'no longer has', '…et la raison est dite');
const inTrash = missingPointedFiles(PLAN_WITH_POINTERS, metasOf({ trashed: true, name: '1YCR.pdb' }));
has(inTrash[0].detail, 'TRASH', 'un fichier à la corbeille est signalé COMME TEL (il est récupérable)');
has(T.missingPointerText(gone[0]), PDB_ID, 'la phrase du compte-rendu dit TOUJOURS l’identifiant Drive');
has(T.missingPointerText({ name: 'structure', id: 'X1234567890', detail: 'the Drive no longer has it' }), '« structure »',
  '…et le libellé du contenant quand la fiche en a retenu un');

/* ── C. L'EXÉCUTEUR, SUR UN FAUX DRIVE ───────────────────────────────────── */

const FOLDER = 'application/vnd.google-apps.folder';
/** Un faux Drive : des nœuds, leurs enfants, et un journal des gestes. */
const makeDrive = () => {
  const nodes = new Map();
  const log = [];
  let seq = 0;
  const put = ({ id = '', name, parent = '', mimeType = 'application/json', text = '', size = 0, trashed = false }) => {
    const nid = id || `N${++seq}`;
    nodes.set(nid, { id: nid, name, parent, mimeType, text, size, trashed });
    log.push({ op: 'create', id: nid, name, parent });
    return nid;
  };
  const drive = {
    put,
    folder: (name, parent = '') => put({ name, parent, mimeType: FOLDER }),
    file: (name, parent, { size = 10 } = {}) => put({ name, parent, size }),
    meta: (folderId, { type = 'instance', appId = '', name = '' } = {}) => put({
      name: '_meta.json',
      parent: folderId,
      size: 10,
      text: JSON.stringify({
        kind: 'lab-workspace/folder', id: folderId, type,
        name: name || (nodes.get(folderId) || {}).name || '',
        extra: appId ? { id: appId } : {}
      })
    }),
    node: (id) => nodes.get(id) || null,
    childrenOf: (parent) => [...nodes.values()].filter((n) => n.parent === parent && !n.trashed),
    inTrash: (id) => !!((nodes.get(id) || {}).trashed),
    rename: (id, name) => {
      const n = nodes.get(id);
      if (!n) return false;
      n.name = name;
      log.push({ op: 'rename', id, name });
      return true;
    },
    trash: (id) => {
      const n = nodes.get(id);
      if (!n) return false;
      n.trashed = true;
      /* Comme le vrai Drive : ranger un dossier emporte ce qu'il contient. */
      const stack = [id];
      while (stack.length) {
        const parent = stack.pop();
        [...nodes.values()].filter((x) => x.parent === parent).forEach((x) => {
          x.trashed = true;
          stack.push(x.id);
        });
      }
      log.push({ op: 'trash', id, name: n.name });
      return true;
    },
    /* `p` est relatif au DOSSIER DU DATASET : la marche part de la racine. */
    byPath: (p, rootId = 'dsRoot') => {
      let parent = rootId;
      let node = null;
      for (const seg of String(p).split('/').filter(Boolean)) {
        node = drive.childrenOf(parent).find((x) => x.name === seg) || null;
        if (!node) return null;
        parent = node.id;
      }
      return node;
    },
    idOf: (p) => ((drive.byPath(p) || {}).id || ''),
    creations: (name) => log.filter((e) => e.op === 'create' && e.name === name).length,
    renamesOf: (id) => log.filter((e) => e.op === 'rename' && e.id === id).map((e) => e.name),
    trashes: () => log.filter((e) => e.op === 'trash')
  };
  return drive;
};

/** L'adaptateur que `tidyDatasetStructure` attend (les mêmes gestes que
    driveStructure, plus la corbeille et les métadonnées d'un fichier). */
const ioOf = (drive) => ({
  available: () => true,
  workspaceId: async () => 'ws',
  rootId: async () => 'dsRoot',
  ensureFolder: async (name, parent) => {
    const found = drive.childrenOf(parent).find((n) => n.name === name && n.mimeType === FOLDER);
    return found ? found.id : drive.folder(name, parent);
  },
  findFolder: async (name, parent) => {
    const found = drive.childrenOf(parent).find((n) => n.name === name && n.mimeType === FOLDER);
    return found ? found.id : '';
  },
  findFile: async (name, parent) => {
    const found = drive.childrenOf(parent).find((n) => n.name === name && n.mimeType !== FOLDER);
    return found ? found.id : '';
  },
  list: async (parent) => drive.childrenOf(parent)
    .map((n) => ({ id: n.id, name: n.name, mimeType: n.mimeType, size: n.size })),
  listDetailed: async (parent) => ({
    files: drive.childrenOf(parent).map((n) => ({ id: n.id, name: n.name, mimeType: n.mimeType, size: n.size })),
    pages: 1, truncated: false, errors: 0
  }),
  upload: async ({ name, mimeType = 'application/json', body = '', folderId }) => {
    const existing = drive.childrenOf(folderId).find((n) => n.name === name && n.mimeType !== FOLDER);
    if (existing) { existing.text = String(body); return existing.id; }
    return drive.put({ name, parent: folderId, mimeType, text: String(body), size: String(body).length });
  },
  downloadText: async (id) => ((drive.node(id) || {}).text || ''),
  rename: async (id, name) => drive.rename(id, name),
  move: async (id, parent) => {
    const n = drive.node(id);
    if (!n) return false;
    n.parent = parent;
    return true;
  },
  trash: async (id) => drive.trash(id),
  fileMeta: async (id) => {
    const n = drive.node(id);
    return n ? { id: n.id, name: n.name, trashed: !!n.trashed } : null;
  }
});

/* LE SCÉNARIO RAPPORTÉ, sur ce faux Drive :
     ws/GEC-UPJV-projects/projects/NATURAL_ARSENAL/
       1YCR                 ← le dossier de l'ÉXPÉRIENCE, resté au nom de l'instance
         └ 1YCR             ← l'instance (son pdb est DANS Data/Structure)
       cartella_vuota       ← un reste vide, hors du plan
       Spazzatura/note.txt  ← un dossier inconnu AVEC un fichier (jamais touché)
   Le dossier du projet, lui, est correct — comme dans le rapport. */
const DATA = {
  projects: [{ id: 'p1', name: 'NATURAL_ARSENAL' }],
  tests: [{
    id: 't1', name: 'interaction_pdbs', projectNames: ['NATURAL_ARSENAL'],
    instanceName: '1YCR', project: 'NATURAL_ARSENAL',
    pdbFileId: PDB_ID
  }]
};
const build = () => {
  const drive = makeDrive();
  drive.put({ id: 'dsRoot', name: 'GEC-UPJV-projects', mimeType: FOLDER });
  const projects = drive.folder('projects', 'dsRoot');
  const projeto = drive.folder('NATURAL_ARSENAL', projects);
  const wrong = drive.folder('1YCR', projeto);            // dossier d'expérience au mauvais nom
  drive.meta(wrong, { type: 'experiment' });
  const instance = drive.folder('1YCR', wrong);           // l'instance
  drive.meta(instance, { type: 'instance', appId: 't1' });
  const data = drive.folder('Data', instance);
  const structure = drive.folder('Structure', data);
  const pdb = drive.put({ id: PDB_ID, name: '1YCR.pdb', parent: structure, size: 5928759 });
  drive.folder('cartella_vuota', projeto);                // reste vide
  const trash = drive.folder('Spazzatura', projeto);
  drive.file('note.txt', trash);                          // inconnu AVEC un fichier
  return { drive, ids: { projeto, wrong, instance, structure, pdb, trash } };
};

/* 1° LE CONTRÔLE (lecture seule) — rien n'est écrit, rien n'est rangé, mais le
   rapport dit déjà ce qui POURRA l'être. */
const dry = build();
const dryOut = await tidyDatasetStructure({
  datasetId: 'ds1', datasetName: 'GEC-UPJV-projects', data: DATA,
  io: ioOf(dry.drive), rootId: 'dsRoot', dryRun: true
});
eq(dryOut.dryRun, true, 'le contrôle se dit « contrôle »');
eq(dryOut.published, null, '…et n’écrit rien');
eq(dry.drive.trashes(), [], '…ni ne range quoi que ce soit');
eq(dry.drive.byPath('projects/NATURAL_ARSENAL/interaction_pdbs'), null,
  '…et ne fabrique pas non plus l’arborescence (c’est le geste d’après qui l’écrit)');
eq(dryOut.decisions.trash.map((t) => t.name), ['cartella_vuota'],
  'le contrôle voit le reste vide, et lui seul');
ok(dryOut.decisions.warnings.some((w) => w.kind === TIDY_KINDS.ORPHAN_FOLDER && w.path === 'projects/NATURAL_ARSENAL/1YCR'),
  '…et signale le dossier d’expérience resté au mauvais nom (hors de l’arborescence)');
ok(dryOut.decisions.warnings.some((w) => w.path === 'projects/NATURAL_ARSENAL/Spazzatura'),
  '…ainsi que le dossier inconnu qui porte un fichier');
eq(dryOut.decisions.warnings.filter((w) => w.kind === TIDY_KINDS.ORPHAN_FOLDER).map((w) => w.path),
  ['projects/NATURAL_ARSENAL/1YCR', 'projects/NATURAL_ARSENAL/Spazzatura'],
  'une branche inconnue est UNE constatation, pas une par niveau (le pdb caché dessous compris)');
eq(dryOut.decisions.missing, [], 'les fichiers pointés sont là : rien à signaler');
eq(dry.drive.inTrash(dry.ids.pdb), false, 'un contrôle ne touche à AUCUN fichier');

/* 2° LE GESTE — publier l’arborescence PUIS ranger. */
const live = build();
const out = await tidyDatasetStructure({
  datasetId: 'ds1', datasetName: 'GEC-UPJV-projects', data: DATA,
  io: ioOf(live.drive), rootId: 'dsRoot'
});
eq(out.ok, true, 'le rangement se termine sans erreur');
eq(out.published.ok, true, 'la publication de l’arborescence a réussi');
ok(out.published.folders >= 2, '…et elle a bien créé ce qui manquait');
ok(!!live.drive.byPath(INS), 'l’arborescence décrite par l’application existe maintenant');
ok(!!live.drive.byPath(`${INS}/_meta.json`), '…avec la description de ses dossiers');
eq(live.drive.trashes().map((t) => t.name), ['cartella_vuota'], 'le reste vide est parti à la CORBEILLE');
eq(live.drive.inTrash(live.ids.wrong), false,
  '⚠ le dossier resté au mauvais nom n’est PAS rangé : il porte le seul exemplaire du pdb');
eq(live.drive.inTrash(live.ids.pdb), false, '…et le pdb est toujours là (la corbeille l’aurait emporté)');
ok(out.decisions.warnings.some((w) => w.path === 'projects/NATURAL_ARSENAL/1YCR'),
  '…ce qui est DIT : le dossier laissé tranquille est nommé dans le compte-rendu');
ok(tidySummaryLines({ ...out, dryRun: false, datasets: [out] }).some((l) => l.includes('1YCR')),
  '…et il arrive à l’écran');

/* 3° LE JUMEAU VRAIMENT IDENTIQUE — le cas où ranger est sûr : deux dossiers
   `Test_84` sous le projet, portant LE MÊME pdb. L'un part à la corbeille,
   l'autre garde la structure (et le compte-rendu dit lequel). */
const twinDrive = makeDrive();
twinDrive.put({ id: 'dsRoot', name: 'GEC-UPJV-projects', mimeType: FOLDER });
const tProjects = twinDrive.folder('projects', 'dsRoot');
const tProject = twinDrive.folder('NATURAL_ARSENAL', tProjects);
const tKeep = twinDrive.folder('Test_84', tProject);
twinDrive.meta(tKeep, { type: 'experiment', appId: 't1' });
const tKeepInst = twinDrive.folder('instance1', tKeep);
twinDrive.meta(tKeepInst, { type: 'instance' });
const tKeepPdb = twinDrive.put({ id: 'PDB_KEEP', name: 'cluster_1_model_1.pdb', parent: tKeepInst, size: 5928759 });
const tJunk = twinDrive.folder('Test_84', tProject);
const tJunkInst = twinDrive.folder('instance1', tJunk);
const tJunkPdb = twinDrive.put({ id: 'PDB_JUNK', name: 'cluster_1_model_1.pdb', parent: tJunkInst, size: 5928759 });
const twinOut = await tidyDatasetStructure({
  datasetId: 'ds1', datasetName: 'GEC-UPJV-projects',
  data: {
    projects: [{ id: 'p1', name: 'NATURAL_ARSENAL' }],
    tests: [{ id: 't1', name: 'Test_84', projectNames: ['NATURAL_ARSENAL'], instanceName: 'instance1', project: 'NATURAL_ARSENAL' }]
  },
  io: ioOf(twinDrive), rootId: 'dsRoot'
});
eq(twinOut.ok, true, 'le rangement d’un jumeau identique se termine sans erreur');
eq(twinDrive.trashes().map((t) => t.name), ['Test_84'], 'UN SEUL dossier part à la corbeille');
eq(twinDrive.inTrash(tKeep), false, '…et c’est celui que le plan désigne qui RESTE');
eq(twinDrive.inTrash(tKeepPdb), false, 'le pdb du dossier gardé est intact');
eq(twinDrive.inTrash(tJunkPdb), true, '…celui du jumeau part avec lui (même nom, même taille : un doublon prouvé)');
has(tidySummaryLines({ datasets: [twinOut], dryRun: false, ok: true }).join('\n'), 'moved to the Trash',
  'le compte-rendu dit ce qui a été rangé');

/* 4° CE QUE L'APPLICATION CHERCHE EN VAIN — le pdb pointé n'est plus sur le
   Drive : c'est DIT (avec son identifiant Drive), jamais passé sous silence. */
const lost = build();
lost.drive.trash(lost.ids.pdb);
const lostOut = await tidyDatasetStructure({
  datasetId: 'ds1', datasetName: 'GEC-UPJV-projects', data: DATA,
  io: ioOf(lost.drive), rootId: 'dsRoot', dryRun: true
});
eq(lostOut.decisions.missing.map((m) => [m.name, m.id]), [['', PDB_ID]],
  'un fichier pointé que le Drive n’a plus est signalé, avec son identifiant Drive');
ok(tidySummaryLines({ datasets: [lostOut], dryRun: true, ok: true }).some((l) => l.includes(PDB_ID)),
  '…et le compte-rendu à l’écran le nomme');
has(tidySummaryText({ ok: true, dryRun: true, datasets: [dryOut] }).headline, 'to tidy',
  'le titre du compte-rendu dit combien de dossiers sont à ranger');
has(tidySummaryText({ ok: false, reason: 'cloud-unavailable', datasets: [] }).headline, 'not connected',
  '…et un Drive injoignable se dit, au lieu d’un faux « tout est en ordre »');

/* ── D. LES CONTRATS ─────────────────────────────────────────────────────── */

const TIDY_SRC = readFileSync('./src/utils/driveTidy.js', 'utf8').replace(/\r\n/g, '\n');
const PANEL_SRC = readFileSync('./src/components/DriveTidyPanel.jsx', 'utf8').replace(/\r\n/g, '\n');
const SETTINGS_SRC = readFileSync('./src/components/AppModules/settingsModule.jsx', 'utf8').replace(/\r\n/g, '\n');
const APP_SRC = readFileSync('./src/App.jsx', 'utf8').replace(/\r\n/g, '\n');

/* Le GESTE : publier d'abord (adopter ce qui a été renommé), ranger ensuite. */
ok(TIDY_SRC.indexOf('structure.publish(mirrorPlan, { rootId: root })') < TIDY_SRC.indexOf('planTidy({ plan: mirrorPlan'),
  'le rangement PUBLIE le plan AVANT de relire l’arbre (sinon il rangerait un dossier que la publication adopte)');
has(TIDY_SRC, 'await drive.trash(t.id)', 'ranger = mettre à la CORBEILLE (jamais de destruction)');
ok(!/driveFetch|delete\(/.test(TIDY_SRC), '…et rien n’appelle une suppression définitive');

/* ⚠ LE RANGEMENT NE DÉCIDE JAMAIS SANS PREUVE : deux règles de prudence. */
has(TIDY_SRC, 'if (unique.length) {', 'un jumeau qui porte un fichier unique n’est pas rangé');
has(TIDY_SRC, 'which one is the real one is not a guess',
  'deux fichiers qui DIFFÈRENT ne sont jamais rangés (le rapport le dit)');
has(TIDY_SRC, 'removing the copy that is not the most recent one needs the Drive clock',
  '…pas même deux copies identiques (la liste ne porte pas l’heure de modification)');

/* Le PANNEAU : un contrôle d'abord, un geste ensuite, jamais l'inverse. */
has(PANEL_SRC, '🔍 Check the Drive', 'le panneau commence par un contrôle');
has(PANEL_SRC, '🧹 Apply', '…et propose le geste après');
has(PANEL_SRC, 'disabled={off || !checked}',
  '…lequel reste inerte tant qu’aucun contrôle n’a été fait (on ne range pas à l’aveugle)');
has(PANEL_SRC, '{view.headline}', 'le titre affiché vient du module pur');
has(PANEL_SRC, 'tidySummaryText', '…comme les lignes (le panneau ne fabrique aucun texte)');
has(PANEL_SRC, 'typeof onTidy !== \'function\'', 'le panneau se désactive si le geste n’est pas branché');

/* Le BRANCHEMENT : Réglages → le panneau reçoit le geste d'App.jsx. */
has(SETTINGS_SRC, "import { DriveTidyPanel } from '../DriveTidyPanel'", 'les Réglages importent le panneau');
has(SETTINGS_SRC, '<DriveTidyPanel onTidy={onTidyDrive} />', '…et le montent avec le geste reçu d’App.jsx');
has(SETTINGS_SRC, 'onTidyDrive = null', 'la prop a une valeur par défaut (le panneau ne casse pas sans Drive)');
has(APP_SRC, "import { tidyWorkspaceStructure } from './utils/driveTidy'", 'App.jsx importe le geste');
has(APP_SRC, 'onTidyDrive={tidyWorkspaceFromDrive}', '…et le branche sur les Réglages');
has(APP_SRC, 'return tidyWorkspaceStructure({ datasets, dataFor, dryRun });',
  'le geste reçoit les datasets et leur contenu, rien d’autre (la décision vit dans le module)');
has(APP_SRC, 'const copy = await readDatasetCopy(ds.id).catch(() => null);',
  'le contenu d’un dataset fermé passe par sa copie Drive relue');
has(APP_SRC, 'const data = parsePayload(copy);',
  '…et par le décodeur unique du programme (la charge est compressée)');

console.log(`\n${passed} vérifications passées — rangement du Drive : on publie, puis on range PROUVÉ.\n`);
