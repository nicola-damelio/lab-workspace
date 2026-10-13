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
 * @param {object}   opts
 * @param {object}   opts.test       l'expérience (métadonnées déclarées)
 * @param {object}   opts.have       ce que ce poste a déjà : `{ structures, molecules }`
 * @param {Function} opts.fetchText  async (file) => texte PDB ('' / throw = échec)
 * @returns {{ structures: Array, molecules: Array, fetched: string[], failed: string[] }}
 */
export const fetchDeclaredDockingFiles = async ({ test = {}, have = {}, fetchText } = {}) => {
  const out = { structures: [], molecules: [], fetched: [], failed: [] };
  if (typeof fetchText !== 'function') return out;
  const missing = missingDeclaredDockingFiles({
    test,
    structures: have && have.structures,
    molecules: have && have.molecules
  });
  for (const file of missing) {
    let text = '';
    try { text = String((await fetchText(file)) || ''); } catch { text = ''; }
    if (!text.trim()) { out.failed.push(file.name); continue; }
    if (file.kind === 'molecule') {
      out.molecules.push({ ...(file.meta || {}), name: file.name, driveUrl: file.url, hasPdb: true, pdb: text });
    } else {
      out.structures.push({ name: file.name, pdb: text, driveUrl: file.url });
    }
    out.fetched.push(file.name);
  }
  return out;
};
