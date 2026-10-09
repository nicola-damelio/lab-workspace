/* =========================================================================
   src/utils/driveTidy.js
   REMETTRE LE DRIVE D'ACCORD AVEC L'APPLICATION — ET LE RANGER.

   Le défaut rapporté, mot pour mot : « il risultato su google drive é stato che
   la cartella del progetto é stata correttamente creata ma dentro la cartella
   invece del nome dell'esperimento c'era una cartella chiamata instance1 che
   conteneva dentro un'altra cartella instance1 … Poi dopo un po di tempo sono
   comparse le cartelle giuste ma restano un sacco di cartelle inutili … non
   potresti fare una funzione che controlla la corrispondenza del google drive
   con l'organizzazione del programma e rimette in ordine? »

   LES DEUX TEMPS, dans cet ordre et jamais l'un sans l'autre :

     1. ON PUBLIE (voir driveStructure.publishDatasetStructure) — le plan pur du
        dataset (projects/<projet>/<expérience>/<instance>/<section>/…) est
        écrit : ce qui manque est créé, ce qui a changé est réécrit, et un objet
        RENOMMÉ est ADOPTÉ par son identifiant (`_meta.json` → `extra.id`) au
        lieu de recevoir un second dossier. C'est ce qui répare « les dossiers
        justes », et le pdb comme le style du viewer y retrouvent leur dossier.
     2. ON RANGE (`planTidy` ci-dessous) — le Drive est relu APRÈS la
        publication, puis comparé au plan. N'est mis à la CORBEILLE que ce dont
        la redondance est PROUVÉE :

          · un JUMEAU — deux dossiers du même nom sous le même parent : on garde
            celui que l'application utilise (son identifiant est dans le plan,
            sinon celui qui porte du contenu) et on range les autres. Si le
            perdant porte un fichier que le gardé N'A PAS, rien n'est rangé : on
            le DIT (fusionner deux contenus n'est pas un geste automatique) ;
          · un dossier VIDE que le plan ne connaît pas (le reste d'un renommage
            réparé, un dossier fabriqué puis abandonné) ;
          · le dossier d'un OBJET SUPPRIMÉ — sa description (`_meta.json`) porte
            l'identifiant d'un projet / d'une expérience / d'une instance qui
            n'existe plus dans le plan ;
          · rien d'autre. Un dossier inconnu QUI PORTE DES FICHIERS est signalé,
            jamais touché ; deux fichiers du même nom de tailles DIFFÉRENTES
            sont signalés, jamais touchés (on ne devine pas lequel est le bon).

   JAMAIS DE DESTRUCTION : tout passe par la CORBEILLE du Drive (30 jours pour
   revenir). Et le compte-rendu dit TOUJOURS ce qui a été rangé, ce qui a été
   laissé, et ce que l'application cherche en vain — un pdb « pointé » par la
   fiche de l'expérience mais ABSENT du Drive est nommé, lui aussi (c'est la
   réponse à « in nessuna delle sottocartelle c'era il pdb »).

   Le PLAN de rangement est PUR (`planTidy`) : il reçoit ce que le Drive porte
   (dossiers, fichiers, identités lués) et le plan du dépôt, et rend des
   DÉCISIONS. L'exécution ne fait qu'obéir. Vérifié hors navigateur par
   _drive_tidy_test.mjs.
   ========================================================================= */

import {
  META_FILE_NAME, createDriveStructure, datasetMirrorPlan, defaultDriveStructureIo
} from './driveStructure';

/** Ce que le rangement peut décider — chaque constat porte un identifiant
    stable (l'interface et les tests s'y accrochent) et une phrase lisible. */
export const TIDY_KINDS = {
  TWIN_FOLDER: 'twin-folder',                  // → corbeille
  EMPTY_FOLDER: 'empty-folder',                // → corbeille
  DELETED_OBJECT_FOLDER: 'deleted-object-folder', // → corbeille
  TWIN_FILE: 'twin-file',                      // → corbeille (tailles égales)
  ORPHAN_FOLDER: 'folder-outside-the-plan',    // constat, rien n'est touché
  TWIN_FILE_DIFFER: 'twin-files-differ',       // constat, rien n'est touché
  TWIN_FOLDER_MERGE: 'twin-folder-with-unique-files', // constat, rien n'est touché
  MISSING_POINTED_FILE: 'pointed-file-missing',// constat : l'application cherche un fichier que le Drive n'a plus
  UNREADABLE_FOLDER: 'folder-could-not-be-read' // constat : un dossier a refusé de se laisser lire
};

/** Ce qui va à la corbeille (les trois seuls cas — les JUMEAUX DE FICHIERS, eux,
    ne sont que SIGNALÉS : une liste de dossier ne porte pas l'heure de
    modification, donc « lequel est le plus récent » serait une devinette. Le
    rangement des fichiers se fait avec la sonde `_repair_drive_file_twins.mjs`,
    qui elle lit `modifiedTime`). */
export const TIDY_TRASH_KINDS = [
  TIDY_KINDS.TWIN_FOLDER, TIDY_KINDS.EMPTY_FOLDER, TIDY_KINDS.DELETED_OBJECT_FOLDER
];

const text = (v) => (v === undefined || v === null ? '' : String(v)).trim();
const asList = (v) => (Array.isArray(v) ? v : []);
/** La clé d'un chemin relatif au dossier du dataset ('' = le dataset lui-même).
    Accepte un TABLEAU de segments ou une chaîne `a/b/c` (les deux formes
    circulent : le plan porte des tableaux, un rapport ou un test une chaîne). PUR. */
export const pathKey = (path) => (Array.isArray(path)
  ? path
  : String(path === undefined || path === null ? '' : path).split('/')
).map((n) => text(n)).filter(Boolean).join('/');
const parentKeyOf = (key) => {
  const i = String(key || '').lastIndexOf('/');
  return i < 0 ? '' : String(key).slice(0, i);
};
const nameOfKey = (key) => {
  const s = String(key || '');
  const i = s.lastIndexOf('/');
  return i < 0 ? s : s.slice(i + 1);
};

/* ── 1. LE PLAN, INDEXÉ (pur) ─────────────────────────────────────────────── */

/**
 * Ce que le plan du dépôt attend, indexé par chemin : ses DOSSIERS (avec
 * l'identifiant de l'objet qu'ils portent, `extra.id`) et ses FICHIERS (nom
 * attendu dans chaque dossier). PUR.
 * @param {{folders?:Array<object>,files?:Array<object>}} plan
 */
export const planIndex = (plan) => {
  const folders = new Map();   // 'a/b' → { name, appId, path }
  const files = new Map();     // 'a/b' → Set(noms)
  asList(plan && plan.folders).forEach((entry) => {
    if (!entry || !Array.isArray(entry.path)) return;
    const key = pathKey(entry.path);
    folders.set(key, {
      key,
      path: entry.path.map((n) => text(n)),
      name: text(entry.name) || nameOfKey(key),
      appId: text(entry.extra && entry.extra.id)
    });
  });
  asList(plan && plan.files).forEach((entry) => {
    if (!entry) return;
    const key = pathKey(entry.path);
    if (!files.has(key)) files.set(key, new Set());
    files.get(key).add(text(entry.name));
  });
  return { folders, files };
};

/** `true` si un dossier du plan vit SOUS ce chemin (un dossier intermédiaire
    n'est donc jamais un orphelin). PUR. */
export const hasPlannedDescendant = (index, key) => {
  const prefix = key ? `${key}/` : '';
  for (const planned of (index && index.folders ? index.folders.keys() : [])) {
    if (planned === key) continue;
    if (prefix ? planned.startsWith(prefix) : !!planned) return true;
  }
  return false;
};

/** `true` si un dossier du plan est un FEUILLE (aucun dossier du plan sous lui) :
    c'est là que les PAGES déposent leurs propres dossiers (`Data/Structure`,
    `Bruker_1r`, `images`), qu'on ne signale donc jamais comme des inconnus. */
export const insidePlannedLeaf = (index, key) => {
  const parts = String(key || '').split('/').filter(Boolean);
  for (let i = parts.length; i > 0; i -= 1) {
    const prefix = parts.slice(0, i).join('/');
    if (index && index.folders && index.folders.has(prefix)) return !hasPlannedDescendant(index, prefix);
  }
  return false;
};

/** Les identifiants d'objets que le plan porte encore (une instance supprimée
    n'y est plus). PUR. */
export const plannedAppIds = (index) => new Set(
  [...(index && index.folders ? index.folders.values() : [])].map((f) => f.appId).filter(Boolean)
);

/**
 * LES FICHIERS QUE L'APPLICATION POINTE — les fiches `<expérience>_files.json`
 * du plan listent, par identifiant Drive, les fichiers qu'une page a déposés
 * (un `.pdb` chargé par son code, une trajectoire, un film…). Ces fichiers ne
 * sont pas des objets de l'application : le plan ne peut pas les recréer, mais
 * il SAIT lesquels devraient être là. PUR.
 * @returns {Array<{owner:string,id:string,name:string,kind:string,url:string}>}
 */
export const pointedFilesIn = (plan) => {
  const out = [];
  asList(plan && plan.files).forEach((entry) => {
    if (!entry || entry.kind !== 'pointers' || !text(entry.body)) return;
    let payload = null;
    try { payload = JSON.parse(String(entry.body)); } catch { return; }
    asList(payload && payload.files).forEach((p) => {
      if (!p || typeof p !== 'object') return;
      const id = text(p.id);
      const url = text(p.url);
      if (!id && !url) return;
      out.push({
        owner: `${pathKey(entry.path)}/${text(entry.name)}`,
        id,
        /* La fiche ne garde pas le NOM du fichier : elle garde le CHEMIN du
           champ qui l'a déposé (`pdb_fileUrl`, `structureDrive.id`…). On en
           tire un libellé lisible, et l'identifiant Drive reste dit à part —
           c'est lui qu'on donne à Google Drive pour le retrouver. */
        name: pointedLabelOf(p),
        kind: text(p.kind),
        url
      });
    });
  });
  return out;
};

/**
 * Le libellé d'un POINTEUR : la fiche garde le chemin du CONTENANT qui portait
 * l'identifiant (`structure`, `figure`…), jamais le nom du fichier (Google
 * Drive n'en donne pas). `''` quand le pointeur était à la racine de l'objet —
 * l'appelant dit alors seulement son identifiant. PUR.
 */
export const pointedLabelOf = (pointer) => {
  const raw = text(pointer && pointer.path).replace(/\[(\d+)\]/g, '').replace(/[._]?(url|link|id)$/i, '');
  const segs = raw.split('.').filter(Boolean);
  return segs.length ? segs[segs.length - 1] : '';
};

/**
 * Ce que l'application cherche et que le Drive n'a PLUS. PUR — `metas` est la
 * réponse du Drive pour chaque identifiant pointé (`{ trashed, name }`, ou
 * `null` quand le fichier n'existe plus du tout). Sans `metas`, rien n'est
 * affirmé : on ne prétend pas qu'un fichier manque sans l'avoir demandé.
 * @returns {Array<{kind:string,path:string,name:string,id:string,detail:string}>}
 */
export const missingPointedFiles = (plan, metas = null) => {
  if (!metas || typeof metas.get !== 'function') return [];
  const out = [];
  pointedFilesIn(plan).forEach((p) => {
    if (!p.id) return;                     // un pointeur par URL n'est pas vérifiable ici
    const meta = metas.get(p.id);
    if (meta && !meta.trashed) return;     // le fichier est là
    out.push({
      kind: TIDY_KINDS.MISSING_POINTED_FILE,
      path: p.owner,
      name: p.name,
      id: p.id,
      detail: meta
        ? `the Drive still has it but it is in the TRASH`
        : 'the Drive no longer has it'
    });
  });
  return out;
};

/* ── 2. LA DÉCISION (pure) : que ranger, que laisser ──────────────────────── */

/** Le nombre de fichiers qu'un dossier porte (compté par IDENTIFIANT, comme le
    sous-arbre ci-dessous : la description `_meta.json` ne compte pas). */
const subtreeOf = (folderNodes, fileNodes) => {
  /* ⚠ LES JUMEAUX PARTAGENT LEUR CHEMIN — deux dossiers `Test_84` sous le même
     projet ont la MÊME clé de chemin. Un sous-arbre calculé par préfixe de
     chemin les confondrait donc (et ferait croire qu'un jumeau vide contient ce
     qui est dans l'autre). Tout est donc compté PAR IDENTIFIANT, en descendant
     la chaîne des parents : chaque dossier ne voit que SES enfants. */
  const filesByParent = new Map();
  fileNodes.forEach((f) => {
    if (f.name === META_FILE_NAME) return;
    const key = text(f.parentId);
    if (!filesByParent.has(key)) filesByParent.set(key, []);
    filesByParent.get(key).push(f.name);
  });
  const foldersByParent = new Map();
  folderNodes.forEach((f) => {
    const key = text(f.parentId);
    if (!foldersByParent.has(key)) foldersByParent.set(key, []);
    foldersByParent.get(key).push(f.id);
  });
  const cache = new Map();
  const collect = (folderId, seen = new Set()) => {
    const id = text(folderId);
    if (!id) return { names: [], folders: 0 };
    if (cache.has(id)) return cache.get(id);
    if (seen.has(id)) return { names: [], folders: 0 };   // un Drive ne boucle pas, mais on ne parie pas
    seen.add(id);
    const names = (filesByParent.get(id) || []).slice();
    let folders = 0;
    (foldersByParent.get(id) || []).forEach((childId) => {
      const child = collect(childId, seen);
      names.push(...child.names);
      folders += 1 + child.folders;
    });
    const entry = { names, folders };
    cache.set(id, entry);
    return entry;
  };
  return {
    fileNames: (folderId) => new Set(collect(folderId).names),
    folderCount: (folderId) => collect(folderId).folders,
    size: (folderId) => {
      const entry = collect(folderId);
      return entry.names.length + entry.folders;
    }
  };
};

/**
 * LE PLAN DE RANGEMENT. PUR — aucune requête : il reçoit ce que le Drive porte
 * et le plan du dépôt, et rend des DÉCISIONS motivées.
 *
 * @param {{plan?:object,
 *          folders?:Array<{id:string,path:string|string[],name?:string,appId?:string,
 *                           fileNames?:string[],folderNames?:string[],hasMeta?:boolean}>,
 *          files?:Array<{id:string,path:string|string[],name:string,size?:number}>,
 *          metas?:Map<string,object|null>|null}} input
 * @returns {{ok:boolean,trash:Array<object>,warnings:Array<object>,keeps:Array<object>,
 *            missing:Array<object>,counts:object}}
 */
export const planTidy = ({ plan = null, folders = [], files = [], metas = null } = {}) => {
  const index = planIndex(plan);
  const ids = plannedAppIds(index);

  /* Chaque dossier lu, muni de sa clé de chemin, de son parent et de son nom. */
  const folderNodes = asList(folders).map((f) => ({
    id: text(f && f.id),
    parentId: text(f && f.parentId),
    key: pathKey(f && f.path),
    name: text(f && f.name) || nameOfKey(pathKey(f && f.path)),
    appId: text(f && f.appId),
    fileNames: asList(f && f.fileNames).map((n) => text(n)).filter(Boolean),
    folderNames: asList(f && f.folderNames).map((n) => text(n)).filter(Boolean),
    hasMeta: !!(f && f.hasMeta)
  })).filter((f) => f.id);
  const fileNodes = asList(files).map((f) => ({
    id: text(f && f.id),
    parentId: text(f && f.parentId),
    key: pathKey(f && f.path),
    name: text(f && f.name),
    size: Number(f && f.size)
  })).filter((f) => f.id && f.name);

  const trash = [];
  const warnings = [];
  const keeps = [];
  const orphans = [];
  const trashedIds = new Set();
  const subtree = subtreeOf(folderNodes, fileNodes);
  /** Les noms de fichiers emportés par un dossier rangé (le compte-rendu les dit). */
  const trashOf = (node, kind, reason) => ({
    id: node.id, kind, path: node.key, name: node.name, reason
  });

  /* ── 2a. LES JUMEAUX DE DOSSIERS — même parent, même nom. ──────────────────
     On GARDE un seul : celui que le plan désigne (l'identifiant de l'objet est
     dans sa description), sinon celui dont le chemin est exactement celui du
     plan, sinon celui dont le SOUS-ARBRE porte le plus de contenu (le dossier
     d'origine, celui où le travail a été fait).
     ⚠ Un jumeau qui porte, quelque part sous lui, un fichier que le gardé n'a
     PAS n'est pas rangé : fusionner deux contenus est une décision humaine (et
     l'ignorer, c'est perdre le seul exemplaire d'un pdb). */
  const byName = new Map();
  folderNodes.forEach((f) => {
    const key = `${parentKeyOf(f.key)}|${f.name}`;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(f);
  });
  for (const [, group] of byName) {
    if (group.length < 2) continue;
    const planned = index.folders.get(group[0].key) || null;
    /* LE GARDÉ : celui dont la description porte l'identifiant de l'objet
       (l'objet a été renommé), à défaut celui dont le chemin est celui du plan
       ET qui porte du contenu, à défaut le plus fourni. Le tri est STABLE :
       deux jumeaux vraiment identiques se départagent par l'ordre du Drive. */
    const score = (f) => (planned && planned.appId && f.appId === planned.appId ? 4 : 0)
      + (index.folders.has(f.key) ? 2 : 0)
      + (subtree.size(f.id) > 0 ? 1 : 0);
    const keeper = group.slice().sort((a, b) => score(b) - score(a))[0];
    const keptNames = subtree.fileNames(keeper ? keeper.id : '');
    group.filter((f) => f !== keeper).forEach((loser) => {
      const unique = [...subtree.fileNames(loser.id)].filter((n) => !keptNames.has(n));
      if (unique.length) {
        warnings.push({
          kind: TIDY_KINDS.TWIN_FOLDER_MERGE,
          path: loser.key,
          name: loser.name,
          id: loser.id,
          keepId: keeper ? keeper.id : '',
          detail: `${unique.length} file(s) exist ONLY in this copy (${unique.slice(0, 3).join(', ')})`
            + ' — nothing was touched: merging two folder contents is a manual decision'
        });
        return;
      }
      trash.push(trashOf(loser, TIDY_KINDS.TWIN_FOLDER,
        `a second Drive folder carries this name in the same parent (kept: ${keeper ? keeper.id : '—'})`));
      trashedIds.add(loser.id);
    });
  }

  /* ── 2b. LES DOSSIERS QUE LE PLAN NE CONNAÎT PAS ───────────────────────────
     Rien dedans (à AUCUNE profondeur) → corbeille (le reste d'un renommage, un
     dossier abandonné). Portant l'identifiant d'un objet SUPPRIMÉ → corbeille
     (l'application ne connaît plus cet objet). Contenant quelque chose et placé
     ailleurs que sous une FEUILLE du plan (là où les pages déposent leurs
     fichiers) → SIGNALÉ, jamais touché. */
  folderNodes.forEach((f) => {
    if (trashedIds.has(f.id)) return;
    if (index.folders.has(f.key)) { keeps.push({ kind: 'planned-folder', id: f.id, path: f.key }); return; }
    const size = subtree.size(f.id);
    /* « VIDE » = aucun FICHIER sous ce dossier, à aucune profondeur (les
       `_meta.json` ne comptent pas) : un dossier qui ne contient que des
       sous-dossiers vides est un reste de renommage, et ranger le plus HAUT
       emporte toute la branche d'un seul geste. */
    if (!subtree.fileNames(f.id).size) {
      trash.push(trashOf(f, TIDY_KINDS.EMPTY_FOLDER,
        'this folder is not part of the dataset tree any more and holds no file at all'));
      trashedIds.add(f.id);
      return;
    }
    if (f.appId && !ids.has(f.appId)) {
      trash.push(trashOf(f, TIDY_KINDS.DELETED_OBJECT_FOLDER,
        'the object this folder describes no longer exists in the app (its _meta.json id is gone)'));
      trashedIds.add(f.id);
      return;
    }
    if (insidePlannedLeaf(index, f.key)) { keeps.push({ kind: 'page-folder', id: f.id, path: f.key }); return; }
    orphans.push({
      kind: TIDY_KINDS.ORPHAN_FOLDER,
      path: f.key,
      name: f.name,
      id: f.id,
      detail: `outside the dataset tree, and it holds ${size} item(s) — nothing was touched`
    });
  });

  /* UNE BRANCHE INCONNUE EST UNE CONSTATATION, PAS UNE PAR NIVEAU : on ne garde
     que les dossiers hauts (un `1YCR/1YCR/Data/Structure` laissé derrière se dit
     en une ligne, pas en quatre). PUR. */
  orphans
    .filter((o) => !orphans.some((other) => other !== o && o.path.startsWith(`${other.path}/`)))
    .forEach((o) => warnings.push(o));

  /* ── 2c. LES FICHIERS JUMEAUX — même dossier, même nom ─────────────────────
     Ils sont SIGNALÉS, jamais rangés : une liste de dossier ne dit pas l'heure
     de modification, donc choisir « le plus récent » serait une devinette — et
     se tromper là, c'est perdre la seule bonne copie. Ce que le rapport dit
     permet de trancher à la main (ou avec _repair_drive_file_twins.mjs, qui
     lit `modifiedTime`). */
  const byFile = new Map();
  fileNodes.forEach((f) => {
    const key = `${f.key}|${f.name}`;
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(f);
  });
  for (const [, group] of byFile) {
    if (group.length < 2) continue;
    const sizes = new Set(group.map((f) => (Number.isFinite(f.size) ? f.size : -1)));
    warnings.push({
      kind: sizes.size > 1 ? TIDY_KINDS.TWIN_FILE_DIFFER : TIDY_KINDS.TWIN_FILE,
      path: `${group[0].key}/${group[0].name}`,
      name: group[0].name,
      ids: group.map((f) => f.id),
      detail: `${group.length} files share this name in the same folder (${group.map((f) => f.size).join(' · ')} bytes)`
        + (sizes.size > 1
          ? ' and they DIFFER — nothing was touched: which one is the real one is not a guess'
          : ' and they are identical in size — nothing was touched: removing the copy that is not the most recent one needs the Drive clock')
    });
  }

  /* ── 2d. UN DOSSIER RANGÉ EMPORTE SES ENFANTS ───────────────────────────────
     Ranger un enfant dont un ancêtre part déjà à la corbeille n'ajouterait rien
     (et ferait croire à deux gestes) : on ne garde que le plus HAUT. */
  const trashedFolderPaths = trash.map((t) => t.path);
  const isInsideTrashed = (key) => trashedFolderPaths.some(
    (p) => p && key !== p && key.startsWith(`${p}/`)
  );
  const final = trash.filter((t) => !isInsideTrashed(t.path));
  const missing = missingPointedFiles(plan, metas);
  return {
    ok: true,
    trash: final,
    warnings,
    keeps,
    missing,
    counts: {
      foldersRead: folderNodes.length,
      filesRead: fileNodes.length,
      trashFolders: final.length,
      twinFiles: warnings.filter((w) => w.kind === TIDY_KINDS.TWIN_FILE || w.kind === TIDY_KINDS.TWIN_FILE_DIFFER).length,
      twinFolders: final.filter((t) => t.kind === TIDY_KINDS.TWIN_FOLDER).length,
      emptyFolders: final.filter((t) => t.kind === TIDY_KINDS.EMPTY_FOLDER).length,
      deletedObjects: final.filter((t) => t.kind === TIDY_KINDS.DELETED_OBJECT_FOLDER).length,
      kept: keeps.length,
      warnings: warnings.length,
      missingFiles: missing.length,
      pointedFilesCounted: pointedFilesIn(plan).length
    }
  };
};

/* ── 3. LECTURE DE L'ARBRE, ET EXÉCUTION ──────────────────────────────────── */

/** La profondeur maximale lue (les niveaux d'une page : projet · expérience ·
    instance · section · sous-section) et le nombre de dossiers visités : un
    rangement ne part jamais en boucle sur un Drive inattendu. */
export const TIDY_MAX_DEPTH = 8;
export const TIDY_MAX_FOLDERS = 2000;

const isFolderNode = (n) => !!n && text(n.mimeType) === 'application/vnd.google-apps.folder';

/**
 * L'ARBRE DU DATASET, LU ENTIÈREMENT (dossiers + fichiers), avec l'identité que
 * chaque dossier porte dans son `_meta.json`. Un dossier qui refuse de se
 * laisser lire est CONSIGNÉ (`failures`) : un rangement qui tairait une panne
 * dirait « tout est en ordre » sur un dossier qu'il n'a pas vu.
 */
export const readTidyTree = async ({ io, rootId = '', maxDepth = TIDY_MAX_DEPTH, maxFolders = TIDY_MAX_FOLDERS } = {}) => {
  const folders = [];
  const files = [];
  const failures = [];
  const readMetaOf = typeof io.readMeta === 'function' ? io.readMeta : null;
  let visited = 0;
  let truncated = false;

  /* `walk` rend CE QU'IL A VU dans le dossier visité : c'est ainsi que chaque
     dossier reçoit ses PROPRES enfants (et non les frères de son parent). */
  const walk = async (parentId, path, depth) => {
    let children = [];
    try {
      children = asList(await io.list(parentId));
    } catch (err) {
      failures.push({ path: pathKey(path), id: text(parentId), error: text(err && err.message) || 'unreadable' });
      return { fileNames: [], folderNames: [] };
    }
    const fileNames = [];
    const folderNames = [];
    children.forEach((child) => {
      if (!child || !child.id) return;
      const name = text(child.name);
      if (isFolderNode(child)) { folderNames.push(name); return; }
      fileNames.push(name);
      files.push({
        id: text(child.id), parentId: text(parentId), path: path.slice(), name, size: Number(child.size)
      });
    });
    if (depth >= maxDepth && folderNames.length) truncated = true;
    for (const child of children) {
      if (!child || !child.id || !isFolderNode(child) || depth >= maxDepth) continue;
      if (visited >= maxFolders) { truncated = true; return { fileNames, folderNames }; }
      visited += 1;
      const name = text(child.name);
      const id = text(child.id);
      const childPath = [...path, name];
      const seen = await walk(id, childPath, depth + 1);
      let meta = null;
      if (readMetaOf) { try { meta = await readMetaOf(id); } catch { meta = null; } }
      folders.push({
        id,
        parentId: text(parentId),
        path: childPath,
        name,
        appId: text(meta && meta.extra && meta.extra.id),
        hasMeta: !!meta,
        fileNames: seen.fileNames,
        folderNames: seen.folderNames
      });
    }
    return { fileNames, folderNames };
  };

  await walk(rootId, [], 0);
  return { folders, files, failures, truncated, visited };
};

/** Les métadonnées des fichiers POINTÉS par le plan (existe ? à la corbeille ?).
    Rend une Map vide — donc aucune affirmation — sans `io.fileMeta`. */
export const readPointedMetas = async ({ io, plan = null } = {}) => {
  const metas = new Map();
  if (!io || typeof io.fileMeta !== 'function') return metas;
  for (const p of pointedFilesIn(plan)) {
    if (!p.id || metas.has(p.id)) continue;
    let meta = null;
    try { meta = await io.fileMeta(p.id); } catch { meta = null; }
    metas.set(p.id, meta && meta.id ? { trashed: !!meta.trashed, name: text(meta.name) } : null);
  }
  return metas;
};

/**
 * RANGER UN DATASET : on PUBLIE le plan (ce qui manque est créé, un objet
 * renommé est adopté sous son nouveau nom), puis on RELIT le Drive et on range
 * ce qui est en trop (voir planTidy). `dryRun` fait tout sauf écrire : c'est le
 * rapport d'abord, le geste ensuite — jamais l'inverse.
 *
 * @returns {{ok:boolean,reason:string,at:string,rootId:string,dryRun:boolean,
 *            dataset:object,published:object|null,decisions:object,trashed:object,
 *            failures:Array<object>,truncated:boolean,plan:object}}
 */
export const tidyDatasetStructure = async ({
  datasetId = '', datasetName = '', datasetFolder = '', data = null,
  io = null, rootId = '', dryRun = false, at = new Date().toISOString(), plan = null
} = {}) => {
  const mirrorPlan = plan || datasetMirrorPlan({ datasetId, datasetName, datasetFolder, data, at });
  const empty = (reason) => ({
    ok: false, reason, at, rootId: '', dryRun,
    dataset: { id: datasetId, name: datasetName, folder: mirrorPlan.datasetFolder },
    published: null,
    decisions: { ok: false, trash: [], warnings: [], missing: [], counts: {} },
    trashed: { folders: 0, files: 0, errors: [] },
    failures: [], truncated: false, plan: mirrorPlan
  });
  let drive = io;
  if (!drive) {
    if (typeof window === 'undefined') return empty('no-browser');
    drive = await defaultDriveStructureIo();
  }
  if (typeof drive.available === 'function' && !drive.available()) return empty('cloud-unavailable');
  let root = String(rootId || '');
  if (!root) {
    try { root = String(await drive.rootId() || ''); } catch { root = ''; }
  }
  if (!root) return empty('no-dataset-folder');

  /* Le même exécuteur que la publication : c'est lui qui adopte un dossier
     renommé par son identifiant (`readMeta`), et il sait relire une
     description — tout ce dont la lecture d'arbre a besoin. */
  const structure = createDriveStructure({ io: drive });
  const reader = {
    ...drive,
    readMeta: (id) => structure.readMeta(id)
  };

  /* 1° PUBLIER — écrire ce qui doit exister, adopter ce qui a été renommé. */
  let published = null;
  if (!dryRun) {
    try { published = await structure.publish(mirrorPlan, { rootId: root }); }
    catch { return { ...empty('publish-failed'), published: null, rootId: root }; }
  }

  /* 2° LIRE ET DÉCIDER — sur l'état d'APRÈS publication (sinon on rangerait un
     dossier que la publication vient d'adopter). */
  const tree = await readTidyTree({ io: reader, rootId: root });
  const metas = await readPointedMetas({ io: reader, plan: mirrorPlan });
  const decisions = planTidy({ plan: mirrorPlan, folders: tree.folders, files: tree.files, metas });

  /* 3° RANGER — du plus PROFOND au plus haut (un dossier rangé emporte ses
     enfants), et jamais de destruction : `trash` = la corbeille du Drive. */
  const trashed = { folders: 0, files: 0, errors: [] };
  if (!dryRun) {
    const ordered = decisions.trash.slice().sort(
      (a, b) => String(b.path).split('/').length - String(a.path).split('/').length
    );
    for (const t of ordered) {
      try {
        const done = await drive.trash(t.id);
        if (!done) throw new Error('the Drive refused to move it to the Trash');
        trashed.folders += 1;
      } catch (err) {
        trashed.errors.push({ id: t.id, path: t.path, kind: t.kind, message: text(err && err.message) || 'unknown error' });
      }
    }
  }

  const ok = (!published || published.ok !== false) && trashed.errors.length === 0 && tree.failures.length === 0;
  return {
    ok,
    reason: ok ? '' : (tree.failures.length ? 'unreadable-folder' : 'tidy-incomplete'),
    at,
    rootId: root,
    dryRun,
    dataset: { id: datasetId, name: datasetName, folder: mirrorPlan.datasetFolder },
    published,
    decisions,
    trashed,
    failures: tree.failures,
    truncated: tree.truncated,
    plan: mirrorPlan
  };
};

/**
 * RANGER UN ESPACE DE TRAVAIL ENTIER : un dataset après l'autre, par les
 * chemins NORMAUX — le dossier d'un dataset se retrouve par son NOM sous
 * « Lab Workspace » (aucun dossier n'est fabriqué : un rangement ne crée pas
 * l'objet qu'il range) et son contenu vient de `dataFor` (l'appelant fournit
 * l'état vivant du dataset ouvert, ou sa copie Drive).
 *
 * Un dataset sans contenu lisible ou sans dossier est SIGNALÉ, jamais deviné.
 *
 * @param {{datasets?:Array<{id:string,title?:string,folder?:string}>,
 *          dataFor?:Function, io?:object, workspaceFolderId?:string,
 *          dryRun?:boolean, at?:string}} options
 */
export const tidyWorkspaceStructure = async ({
  datasets = [], dataFor = null, io = null, workspaceFolderId = '',
  dryRun = false, at = new Date().toISOString()
} = {}) => {
  const summary = { ok: true, reason: '', at, dryRun, workspaceFolderId: '', datasets: [], lines: [] };
  let drive = io;
  if (!drive) {
    if (typeof window === 'undefined') return { ...summary, ok: false, reason: 'no-browser' };
    drive = await defaultDriveStructureIo();
  }
  if (typeof drive.available === 'function' && !drive.available()) return { ...summary, ok: false, reason: 'cloud-unavailable' };
  let workspace = String(workspaceFolderId || '');
  if (!workspace) {
    try { workspace = String(await drive.workspaceId() || ''); } catch { workspace = ''; }
  }
  summary.workspaceFolderId = workspace;
  if (!workspace) return { ...summary, ok: false, reason: 'no-workspace-folder' };
  if (typeof dataFor !== 'function') return { ...summary, ok: false, reason: 'no-content-source' };

  const results = [];
  for (const ds of asList(datasets)) {
    const id = text(ds && ds.id);
    if (!id) continue;
    const emptyResult = (reason, folder) => ({
      dataset: { id, name: text(ds && ds.title), folder: text(folder) },
      ok: false, reason, dryRun,
      decisions: { trash: [], warnings: [], missing: [], counts: {} },
      trashed: { folders: 0, files: 0, errors: [] },
      published: null, failures: [], truncated: false
    });
    const payload = await Promise.resolve(dataFor(ds)).catch(() => null);
    if (!payload || !payload.data) { results.push(emptyResult('no-content', '')); continue; }
    const folderSlug = text(payload.folder) || text(ds && ds.folder);
    const rootId = folderSlug
      ? await Promise.resolve(drive.findFolder(folderSlug, workspace)).catch(() => '')
      : '';
    /* AUCUN dossier n'est créé ici : un rangement ne fabrique pas l'objet qu'il
       range. Un dataset sans dossier se répare par « 🔄 Resync from Drive ». */
    if (!rootId) { results.push(emptyResult('no-dataset-folder', folderSlug)); continue; }
    results.push(await tidyDatasetStructure({
      datasetId: id,
      datasetName: text(payload.title) || text(ds && ds.title),
      datasetFolder: folderSlug,
      data: payload.data,
      io: drive,
      rootId,
      dryRun,
      at
    }));
  }
  const ok = results.every((r) => r.ok || r.reason === 'no-content');
  return {
    ...summary,
    ok,
    reason: ok ? '' : 'tidy-incomplete',
    datasets: results,
    lines: tidySummaryLines({ ...summary, ok, reason: ok ? '' : 'tidy-incomplete', datasets: results })
  };
};

/* ── 4. LE COMPTE-RENDU (pur) ─────────────────────────────────────────────── */

/** Le nom lisible d'un dataset dans un compte-rendu. PUR. */
const datasetNameOf = (report) => {
  const d = (report && report.dataset) || {};
  return text(d.name) || text(d.id) || 'this dataset';
};

/** La cause d'un échec, en clair. PUR. */
export const tidyReasonText = (reason) => {
  switch (text(reason)) {
    case 'cloud-unavailable': return 'The Drive is not connected — nothing was checked.';
    case 'no-browser': return 'The Drive can only be reached from the application.';
    case 'no-workspace-folder': return 'No « Lab Workspace » folder was found on the Drive.';
    case 'no-content-source': return 'No dataset content could be read on this PC.';
    case 'no-dataset-folder': return 'The dataset folder was not found on the Drive.';
    case 'publish-failed': return 'The tree of the dataset could not be written back to the Drive.';
    case 'unreadable-folder': return 'A folder refused to be listed: the Drive is only partly known.';
    case 'tidy-incomplete': return 'Some items could not be moved to the Trash.';
    default: return reason ? `Tidy did not complete (${reason}).` : 'Tidy did not complete.';
  }
};

/**
 * LE COMPTE-RENDU, EN PHRASES. PUR — l'interface ne fabrique aucun texte : elle
 * peint celui-ci (même règle que `resyncReportLines`).
 * @returns {string[]}
 */
export const tidySummaryLines = (summary) => {
  const lines = [];
  const s = summary && typeof summary === 'object' ? summary : {};
  if (s.reason) lines.push(`⚠ ${tidyReasonText(s.reason)}`);
  if (s.dryRun && asList(s.datasets).length) {
    lines.push('· Nothing has been touched yet: this is the CHECK. « Apply » moves these items to the Drive Trash (30 days to get them back).');
  }
  asList(s.datasets).forEach((report) => {
    const counts = (report.decisions && report.decisions.counts) || {};
    const name = datasetNameOf(report);
    if (report.reason === 'no-content') {
      lines.push(`⚠ ${name}: no content could be read (its copy on the Drive is missing or unreadable) — nothing was checked.`);
      return;
    }
    if (report.reason === 'no-dataset-folder') {
      lines.push(`⚠ ${name}: no folder carries it in the workspace on the Drive — nothing was tidied.`);
      return;
    }
    const trashed = report.trashed || { folders: 0, files: 0 };
    lines.push(s.dryRun
      ? `· ${name}: ${counts.trashFolders || 0} folder(s) can go to the Trash`
        + ` (${counts.foldersRead || 0} folders read, ${counts.kept || 0} part of the tree).`
      : `✓ ${name}: ${trashed.folders} folder(s) moved to the Trash`
        + ` (${counts.foldersRead || 0} folders read, ${counts.kept || 0} part of the tree).`);
    if (counts.twinFiles) {
      lines.push(`· ${counts.twinFiles} file name(s) exist in several copies in the same folder — left alone (see below).`);
    }
    const published = report.published;
    if (published && (published.folders || published.files || published.metas)) {
      lines.push(`· …after writing the tree back: ${published.folders} folder(s), ${published.metas} _meta.json and ${published.files} file(s) written (${published.skipped || 0} already up to date).`);
    }
    asList(report.decisions && report.decisions.missing).slice(0, 6).forEach((m) => {
      lines.push(missingPointerText(m));
    });
    asList(report.decisions && report.decisions.warnings).slice(0, 6).forEach((w) => {
      lines.push(`⚠ Left alone — ${w.path}: ${w.detail}`);
    });
    asList(report.failures).slice(0, 3).forEach((f) => {
      lines.push(`⚠ ${f.path || '(dataset root)'}: the Drive refused to list this folder (${f.error}) — it was not checked.`);
    });
    asList(report.trashed && report.trashed.errors).slice(0, 3).forEach((e) => {
      lines.push(`⚠ ${e.path}: could not be moved to the Trash (${e.message})`);
    });
  });
  if (!lines.length) lines.push('· Nothing to tidy: the Drive already matches the application.');
  return lines;
};

/** La phrase d'un fichier pointé que le Drive n'a plus — l'identifiant Drive
    est TOUJOURS dit (c'est lui qui permet de le retrouver ou de le recréer).
    PUR. */
export const missingPointerText = (m) => {
  const name = text(m && m.name);
  const id = text(m && m.id);
  const what = name && name !== id ? `« ${name} » (Drive id ${id})` : `the file ${id}`;
  return `⚠ The app is still pointing at ${what} and ${text(m && m.detail)}`
    + ' — it has to be uploaded again from its page: the Drive holds no copy of it any more.';
};

/** Le compte-rendu prêt à peindre : un titre + ses lignes. PUR. */
export const tidySummaryText = (summary) => {
  const s = summary && typeof summary === 'object' ? summary : {};
  if (s.error) return { headline: '⚠ The Drive could not be checked:', lines: [] };
  const counts = asList(s.datasets).reduce((acc, r) => {
    const c = (r.decisions && r.decisions.counts) || {};
    acc.trash += c.trashFolders || 0;
    acc.twinFiles += c.twinFiles || 0;
    acc.missing += c.missingFiles || 0;
    acc.failed += ((r.trashed && r.trashed.errors) ? r.trashed.errors.length : 0) + (r.failures ? r.failures.length : 0);
    return acc;
  }, { trash: 0, twinFiles: 0, missing: 0, failed: 0 });
  const many = asList(s.datasets).length;
  const headline = s.ok
    ? (s.dryRun
      ? `✓ Checked ${many} dataset(s) — ${counts.trash} folder(s) to tidy`
        + `${counts.missing ? `, ${counts.missing} file(s) the app cannot find` : ''}`
        + `${counts.twinFiles ? `, ${counts.twinFiles} duplicated file name(s)` : ''}`
      : `✓ Tidied ${many} dataset(s) — ${counts.trash} folder(s) moved to the Trash`
        + `${counts.failed ? `, ${counts.failed} left alone` : ''}`)
    : `⚠ ${tidyReasonText(s.reason)}`;
  return { headline, lines: asList(s.lines) };
};
