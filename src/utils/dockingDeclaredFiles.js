/* =========================================================================
   src/utils/dockingDeclaredFiles.js
   LE DATASET PORTE LE LIEN DE CHAQUE FICHIER DU DOCKING : LA PAGE S'EN SERT
   POUR RETROUVER LA STRUCTURE QU'ELLE DOIT MONTRER.

   LE DÉFAUT RÉPARÉ ICI, dit par le rapport : « some docking tests do not load
   automatically the structure they are supposed to load. »

   Pourquoi la structure attendue pouvait ne PAS arriver : les textes PDB d'un
   docking (structures `8_seletopclusts`, molécules de `raw_input.toml`) vivent
   dans la base LOCALE du navigateur (IndexedDB → localStorage). Le dataset,
   lui, ne garde que des MÉTADONNÉES — le NOM et le LIEN de chaque fichier
   (`dockingStructures: [{ name, driveUrl }]`, `dockingMolecules: [{…}]`).
   Sur un autre poste, la page comptait donc sur l'archive de restauration
   (`<instance>_docking_restore.json.gz`, `utils/driveRestore.js`) — qui
   n'existe QUE depuis qu'un poste a importé le dossier de calcul. Un dataset
   plus ancien (importé avant cette mécanique, ou dont l'archive n'a jamais été
   écrite) n'en a AUCUNE : la restauration ne trouvait rien et la page restait
   sans la structure qu'elle devait montrer — alors que le LIEN du fichier
   était, lui, sous ses yeux, dans le dataset.

   D'où ce repli : quand l'archive est absente (ou vide), les fichiers DÉCLARÉS
   par le dataset sont téléchargés un à un par leur propre lien et remis dans la
   base du navigateur, exactement là où la restauration archive les mettrait.
   Rien n'est inventé, rien n'est deviné : on lit ce que le dataset nomme.

   TOUT EST PUR ici : le téléchargement lui-même est INJECTÉ (`fetchText`), ce
   qui rend la règle vérifiable sans réseau (_docking_virgin_page_test.mjs).
   ========================================================================= */

/** La clé qui décide si deux noms désignent LE MÊME fichier : dossier, `.gz` et
 *  extension retirés, minuscules. Le dossier de calcul nomme tantôt
 *  `cluster_1_model_1.pdb`, tantôt `cluster_1_model_1.pdb.gz`, tantôt avec son
 *  arborescence (`8_seletopclusts/cluster_1_model_1.pdb`) : ce sont les mêmes
 *  octets, donc le même PDB — sans cette clé, la restauration re-téléchargerait
 *  un fichier déjà présent et l'écran montrerait deux fois la même structure. */
export const structureNameKey = (name = '') => String(name || '')
  .split(/[\\/]/)
  .pop()
  .replace(/\.gz$/i, '')
  .replace(/\.(pdb|ent|cif|mmcif|mol2|sdf)$/i, '')
  .trim()
  .toLowerCase();

/** LES FORMATS DE RÉCEPTEUR QUE CETTE PAGE SAIT OUVRIR — la liste EXACTE des
 *  extensions que `structureNameKey` (juste au-dessus) reconnaît comme un
 *  fichier de structure. Sert au geste de lecture du dossier de l'expérience
 *  (📂 Topology from Drive folder, DockingSections.jsx) : la liste proposée ne
 *  contient donc que des fichiers que le viewer 3D sait charger. */
export const DOCKING_TOPOLOGY_EXTS = ['pdb', 'ent', 'cif', 'mmcif', 'mol2', 'sdf'];

/** L'EXTENSION QUE LE VIEWER 3D REÇOIT pour un fichier choisi dans le dossier.
 *  Les alias du PDB sont ramenés au nom que le composeur lit sûr — `.ent` EST du
 *  PDB, `.mmcif` EST du CIF — et tout le reste (dont un nom sans extension)
 *  retombe sur `pdb`, le défaut de la page. PUR : le nom entre, l'extension
 *  sort, rien d'autre n'est lu. */
export const dockingTopologyExt = (name = '') => {
  const ext = String(name || '')
    .split(/[\\/]/)
    .pop()
    .replace(/\.gz$/i, '')
    .split('.')
    .pop()
    .toLowerCase();
  if (ext === 'ent') return 'pdb';
  if (ext === 'mmcif') return 'cif';
  return ['cif', 'mol2', 'sdf'].includes(ext) ? ext : 'pdb';
};

/** LES TRACES D'UN DOCKING DANS L'EXPÉRIENCE — le programme, ses images, ses
 *  poses, les résultats CAPRI. Ce sont les SEULS signes qui survivent à la perte
 *  des métadonnées de FICHIERS (`dockingStructures`, `dockingMolecules` et le
 *  pointeur `dockingDrive`) : la page les écrit dès qu'un run est importé, et le
 *  document du dataset les porte encore quand le reste a disparu. */
export const DOCKING_HISTORY_FIELDS = ['dockingProgram', 'dockingImages', 'dockingResults', 'dockingPoses', 'dockingCapri'];

/** Vrai quand `test` garde AU MOINS une trace de docking : un champ non vide
 *  (tableau non vide, texte non blanc). PUR. */
export const dockingHistoryOf = (test = {}) => DOCKING_HISTORY_FIELDS.some((field) => {
  const value = test ? test[field] : null;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim() !== '';
  return value !== undefined && value !== null && value !== false;
});

/** L'ARCHIVE DOIT-ELLE ÊTRE CHERCHÉE MALGRÉ UN DATASET MUET ?
 *
 *  Défaut signalé (« Test_86 », 15/10/2026) : l'expérience avait été perdue puis
 *  recréée, si bien que `dockingStructures`, `dockingMolecules` ET `dockingDrive`
 *  étaient TOUS vides. La page en concluait « aucun import : rien à restaurer » et
 *  ne cherchait donc JAMAIS la copie de référence restée dans son propre dossier
 *  du Drive (`<instance>_docking_restore.json.gz`) : le viewer restait vide, et
 *  rien ne le disait — alors que l'utilisateur, lui, voyait bien les PDB dans
 *  `…/<instance>/data/pdb_files`.
 *
 *  OUI quand les trois signes manquent à la fois — rien de déclaré, RIEN dans la
 *  base de ce poste, et pourtant une trace de docking dans l'expérience (donc une
 *  archive existe peut-être). NON pour une page VIERGE (aucune trace) : elle n'a
 *  rien à chercher, aucune requête n'est faite pour rien, et le défaut « une page
 *  neuve n'est jamais vierge » ne revient pas. PUR : exécutable sans navigateur. */
export const dockingArchiveWanted = ({ test = {}, structures = [], molecules = [] } = {}) => {
  const declared = (Array.isArray(test.dockingStructures) && test.dockingStructures.length > 0)
    || (Array.isArray(test.dockingMolecules) && test.dockingMolecules.length > 0)
    || !!test.dockingDrive;
  if (declared) return false;                     // le chemin déclaré s'en charge
  if ((Array.isArray(structures) && structures.length > 0)
    || (Array.isArray(molecules) && molecules.length > 0)) return false;   // la page a de quoi montrer
  return dockingHistoryOf(test);
};

/** Les fichiers d'un docking que le dataset DÉCLARE, avec leur lien.
 *  Un fichier sans lien (métadonnées d'un import où l'envoi Drive a échoué) est
 *  écarté : il n'y a rien à télécharger, et le nom seul ne fait pas une
 *  structure. `kind` : 'structure' (8_seletopclusts) ou 'molecule' (à docker). */
export const declaredDockingFiles = (test = {}) => {
  const out = [];
  const add = (list, kind) => (Array.isArray(list) ? list : []).forEach((raw) => {
    if (!raw || typeof raw !== 'object') return;
    const name = String(raw.name || raw.fileName || '').trim();
    const url = String(raw.driveUrl || raw.url || '').trim();
    if (!name || !url) return;
    if (kind === 'molecule') {
      out.push({
        kind, name, url,
        meta: {
          segid: raw.segid || '',
          fileName: raw.fileName || '',
          sourcePath: raw.sourcePath || ''
        }
      });
      return;
    }
    out.push({ kind, name, url });
  });
  add(test.dockingStructures, 'structure');
  add(test.dockingMolecules, 'molecule');
  return out;
};

/** Les fichiers déclarés qui NE SONT PAS dans la base de ce poste (comparés par
 *  `structureNameKey`). C'est ce que la page doit aller chercher — et ce que
 *  `missing` doit dire à la restauration automatique : un poste qui n'a que 2
 *  des 4 structures déclarées a bien « quelque chose qui manque ». */
export const missingDeclaredDockingFiles = ({ test = {}, structures = [], molecules = [] } = {}) => {
  const present = new Set([
    ...(Array.isArray(structures) ? structures : []).map((s) => structureNameKey(s && s.name)),
    ...(Array.isArray(molecules) ? molecules : []).map((m) => structureNameKey(m && m.name))
  ].filter(Boolean));
  return declaredDockingFiles(test).filter((f) => {
    const key = structureNameKey(f.name);
    return !key || !present.has(key);
  });
};

/**
 * Télécharge les fichiers déclarés qui manquent et rend les entrées À RANGER
 * dans la base du navigateur, dans la forme EXACTE que l'import y écrit
 * (`{ name, pdb, driveUrl }` pour une structure, `{ …métadonnées, pdb }` pour
 * une molécule) — la restauration n'a donc plus qu'à les stocker.
 *
 * ⚠ LE NOMBRE DE FICHIERS EST CONNU D'AVANCE (leurs liens sont dans le dataset) :
 *   la boucle le DIT au lieu de laisser la barre du haut pulser sans repère — un
 *   dossier de 40 PDB avance donc de 1/40 en 1/40 (voir utils/loadProgress.js).
 *   Le rapporteur est APPELÉ ET ATTENDU : un appelant qui, dans le sien, rend la
 *   main au navigateur (`yieldToPaint`, utils/backgroundWork.js) garde la page
 *   PEINTE et DÉFILABLE pendant un long téléchargement.
 *
 * @param {object}   opts
 * @param {object}   opts.test       l'expérience (métadonnées déclarées)
 * @param {object}   opts.have       ce que ce poste a déjà : `{ structures, molecules }`
 * @param {Function} opts.fetchText  async (file) => texte PDB ('' / throw = échec)
 * @param {Function} [opts.onProgress] async (done, total, phase) — APRÈS chaque fichier
 * @param {Function} [opts.isAborted]  () => boolean — consulté AVANT chaque fichier
 * @returns {{ structures: Array, molecules: Array, fetched: string[], failed: string[] }}
 */
export const fetchDeclaredDockingFiles = async ({ test = {}, have = {}, fetchText, onProgress, isAborted } = {}) => {
  const out = { structures: [], molecules: [], fetched: [], failed: [] };
  if (typeof fetchText !== 'function') return out;
  const missing = missingDeclaredDockingFiles({
    test,
    structures: have && have.structures,
    molecules: have && have.molecules
  });
  const total = missing.length;
  /* ⏹ ARRÊTER UNE DESCENTE DE 40 FICHIERS. Le drapeau appartient à l'appelant
     (le ⏹ de la barre du haut, voir abortControl) : ici on ne fait que le
     consulter, et ce qui est DÉJÀ arrivé reste — la boucle s'interrompt, la
     page range ce qu'elle a. */
  const stopped = () => typeof isAborted === 'function' && !!isAborted();
  const report = async (done, phase) => {
    if (typeof onProgress !== 'function') return;
    // Un rapporteur qui échoue ne fait pas échouer la restauration.
    try { await onProgress(done, total, phase); } catch { /* le rapport est un confort */ }
  };
  const phaseOf = (i) => (i < total ? `File ${i + 1} of ${total} — ${missing[i].name}` : '');
  if (stopped()) return out;
  await report(0, phaseOf(0));
  let done = 0;
  for (const file of missing) {
    if (stopped()) break;
    let text = '';
    try { text = String((await fetchText(file)) || ''); } catch { text = ''; }
    if (!text.trim()) {
      out.failed.push(file.name);
    } else if (file.kind === 'molecule') {
      out.molecules.push({ ...(file.meta || {}), name: file.name, driveUrl: file.url, hasPdb: true, pdb: text });
    } else {
      out.structures.push({ name: file.name, pdb: text, driveUrl: file.url });
    }
    if (text.trim()) out.fetched.push(file.name);
    done += 1;
    // Le compteur vient d'avancer : la barre le dit, et la page peut peindre.
    await report(done, phaseOf(done));
  }
  return out;
};
