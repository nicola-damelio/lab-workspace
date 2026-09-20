/* =========================================================================
   src/utils/storageDrive.js — le rangement Drive d'un STORAGE et de ses BOÎTES.

   Structure canonique (voir driveNaming) :

       storage/<storage>/images/<fichier>          ← image de référence
       storage/<storage>/boxes/<boîte>/images/<f>  ← photos de la boîte
       storage/<storage>/boxes/<boîte>/<date>_<propriétaire>_boxlabel.pdf
                                                   ← étiquette de la boîte

   Pourquoi ce module : les gestes qui écrivent sur le Drive (déposer
   l'étiquette, ranger un fichier envoyé avant cette structure, renommer le
   dossier d'un storage / d'une boîte) doivent être vérifiables hors navigateur.
   Ils ne dépendent donc QUE des primitives de `driveUpload` — le faux Drive des
   tests (`_esm_test_hook.mjs`) les remplace une à une — et jamais de React.

   Tous les gestes sont « au mieux » : un Drive qui ne répond pas laisse
   l'application fonctionner (elle réessaiera au geste suivant).
   ========================================================================= */
import {
  canonicalDatasetDirId, cloudBackendAvailable, ensureDriveFolder, findFolderByName,
  getDriveFileMeta, listDriveChildren, moveDriveFile, renameDriveFile,
  resolveDrivePathFromNames, trashDriveFile, uploadLocalFile
} from './driveUpload';
import {
  LEGACY_BOX_LABEL_FILE_NAME, STORAGE_BOXES_DIR, STORAGE_DIR, boxLabelFileName, sanitizeSlug,
  storageBoxFolderPath, storageBoxImagesFolderPath, storageImagesFolderPath
} from './driveNaming';

/** Tous les identifiants de fichier Drive cités par une valeur (URL, HTML, JSON).
 *  Sert à retrouver les fichiers DÉJÀ envoyés pour les ranger : on ne connaît
 *  d'eux que le lien stocké dans la boîte / le storage. */
export const driveFileIdsIn = (value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value == null ? '' : value);
  const ids = new Set();
  const re = /\/file\/d\/([A-Za-z0-9_-]{10,})|\/d\/([A-Za-z0-9_-]{10,})|[?&]id=([A-Za-z0-9_-]{10,})/g;
  let m = re.exec(text);
  while (m) {
    const id = m[1] || m[2] || m[3];
    if (id) ids.add(id);
    m = re.exec(text);
  }
  return [...ids];
};

/** Range à la CORBEILLE l'ancienne étiquette « label.pdf » d'une boîte : depuis
 *  que l'étiquette s'appelle <date>_<propriétaire>_boxlabel.pdf (voir
 *  driveNaming.boxLabelFileName), le dossier d'une boîte ne doit pas garder deux
 *  étiquettes — celle d'avant part à la corbeille (récupérable) dès que la
 *  nouvelle est déposée. Le fichier GARDÉ (`keepName`) n'est jamais touché.
 *  Au mieux : sans Drive, ou sans dossier, rien ne change.
 *  @returns {Promise<number>} le nombre d'anciennes étiquettes rangées */
export const clearLegacyBoxLabels = async ({ storage, box, keepName = '' }) => {
  if (!cloudBackendAvailable()) return 0;
  let leafId = '';
  try {
    /* RECHERCHE SEULE : le geste ne doit jamais fabriquer un dossier de boîte. */
    const found = await resolveDrivePathFromNames(storageBoxFolderPath(storage, box), { create: false });
    leafId = found && found.leafId ? String(found.leafId) : '';
  } catch { return 0; }
  if (!leafId) return 0;
  let children = [];
  try { children = await listDriveChildren(leafId); } catch { return 0; }
  let removed = 0;
  for (const child of (Array.isArray(children) ? children : [])) {
    const name = String((child && child.name) || '');
    if (name !== LEGACY_BOX_LABEL_FILE_NAME || name === String(keepName || '')) continue;
    try { if (await trashDriveFile(child.id)) removed += 1; } catch { /* au mieux */ }
  }
  return removed;
};

/** Dépose (ou remplace) l'étiquette d'une boîte dans storage/<storage>/boxes/<boîte>/.
 *  Le nom est celui de la boîte — <date>_<propriétaire>_boxlabel.pdf, construit
 *  par l'appelant avec driveNaming.boxLabelFileName — donc réenvoyer la même
 *  étiquette écrase la précédente ; une étiquette qui portait l'ANCIEN nom
 *  (« label.pdf ») est rangée, pour qu'un dossier de boîte ne porte jamais deux
 *  étiquettes.
 *  @returns {Promise<{id:string,name:string,driveUrl:string}|null>} */
export const saveBoxLabelFile = async ({ storage, box, blob, name = boxLabelFileName() }) => {
  if (!blob || !cloudBackendAvailable()) return null;
  const saved = await uploadLocalFile({
    name,
    mimeType: 'application/pdf',
    file: blob,
    path: storageBoxFolderPath(storage, box),
    /* Le contexte de nommage est enregistré : la suppression de la boîte
       (markAttachmentsDeleted) et les renommages savent où vit ce fichier.
       `title` garantit qu'un futur renommage recalcule le MÊME nom. */
    ctx: { storage, box, title: String(name).replace(/\.[^/.]+$/, ''), section: '' }
  });
  /* Seulement si l'étiquette est vraiment arrivée : sans Drive on ne range rien
     (on ne sait pas ce qu'il y a dans le dossier). */
  if (saved && saved.driveUrl) await clearLegacyBoxLabels({ storage, box, keepName: name });
  return saved;
};

/** Le dossier du conteneur « storage » du dataset ('' s'il n'existe pas). */
const storageContainerId = async (root) => {
  const canonical = await canonicalDatasetDirId(STORAGE_DIR, { rootId: root }).catch(() => '');
  if (canonical) return canonical;
  return findFolderByName(STORAGE_DIR, root).catch(() => '');
};

const datasetRoot = async () => ensureDriveFolder().catch(() => '');

/** Ramène dans la structure canonique les fichiers DÉJÀ envoyés ailleurs (ancien
 *  chemin `storage/<boîte>/<instance>/image/…` ou `storage/<storage>/image/…`).
 *  Le déplacement se fait par IDENTIFIANT de fichier (un déplacement ne change
 *  pas le lien stocké dans la boîte), et un fichier déjà au bon endroit n'est
 *  jamais touché : rouvrir une boîte ne provoque aucun déplacement.
 *
 *  Le dossier visé est d'abord CHERCHÉ (jamais créé) : ranger ne fabrique pas
 *  d'arborescence. Il n'est créé qu'au moment où un fichier a VRAIMENT besoin
 *  d'y entrer — un dossier vide laissé derrière soi est exactement ce que
 *  produisait un chemin recalculé pendant la frappe du nom (renommer une boîte
 *  laissait « j », « ja », « jac » sous storage/<storage>/boxes/).
 *  @returns {Promise<number>} nombre de fichiers déplacés */
export const tidyStorageFiles = async ({ storage, box = '', urls = [] }) => {
  if (!cloudBackendAvailable()) return 0;
  const ids = [...new Set((Array.isArray(urls) ? urls : [urls]).flatMap((u) => driveFileIdsIn(u)))];
  if (!ids.length) return 0;
  const names = box ? storageBoxImagesFolderPath(storage, box) : storageImagesFolderPath(storage);
  /* 1. Le dossier visé existe-t-il ? (recherche seule : rien n'est créé). Un
     chemin SUPPRIMÉ ne se recrée pas, donc on s'arrête là s'il lève. */
  let target = '';
  try {
    const found = await resolveDrivePathFromNames(names, { create: false });
    target = found && found.leafId ? String(found.leafId) : '';
  } catch { return 0; }
  let moved = 0;
  for (const id of ids) {
    try {
      const meta = await getDriveFileMeta(id);
      if (!meta || !meta.id || meta.trashed) continue;
      const parents = Array.isArray(meta.parents) ? meta.parents.map(String) : [];
      if (target && parents.includes(target)) continue;
      if (!target) {
        /* 2. Création À LA DEMANDE : seulement parce qu'un fichier va entrer. */
        const resolved = await resolveDrivePathFromNames(names);
        target = resolved && resolved.leafId ? String(resolved.leafId) : '';
        if (!target) return moved;
        if (parents.includes(target)) continue;
      }
      if (await moveDriveFile(id, target)) moved += 1;
    } catch { /* au mieux : un fichier inaccessible n'empêche pas les autres */ }
  }
  return moved;
};

/** Renomme le dossier Drive d'un storage : storage/<ancien> → storage/<nouveau>.
 *  Le dossier est cherché PAR SON NOM (aucune création), donc un storage jamais
 *  utilisé ne fabrique rien.
 *  @returns {Promise<boolean>} true quand un dossier a été renommé */
export const renameStorageDriveFolder = async ({ oldName, newName }) => {
  const oldSlug = sanitizeSlug(oldName);
  const newSlug = sanitizeSlug(newName);
  if (!oldSlug || !newSlug || oldSlug === newSlug) return false;
  const root = await datasetRoot();
  if (!root) return false;
  const container = await storageContainerId(root);
  if (!container) return false;
  const folderId = await findFolderByName(oldSlug, container).catch(() => '');
  if (!folderId) return false;
  return renameDriveFile(folderId, newSlug).catch(() => false);
};

/** Renomme le dossier Drive d'UNE boîte :
 *  storage/<storage>/boxes/<ancien nom> → …/<nouveau nom>. Une boîte garde donc
 *  le nom qu'on lui donne, jamais le « Test 74 » de sa création — et tout ce
 *  qu'elle contient (photos, étiquette boxlabel.pdf) suit le dossier automatiquement.
 *  @returns {Promise<boolean>} true quand le dossier a été renommé */
export const renameStorageBoxDriveFolder = async ({ storage, oldName, newName }) => {
  const oldSlug = sanitizeSlug(oldName);
  const newSlug = sanitizeSlug(newName);
  if (!oldSlug || !newSlug || oldSlug === newSlug) return false;
  const root = await datasetRoot();
  if (!root) return false;
  const container = await storageContainerId(root);
  if (!container) return false;
  const storageFolder = await findFolderByName(sanitizeSlug(storage) || '_unassigned', container).catch(() => '');
  if (!storageFolder) return false;
  const boxesFolder = await findFolderByName(STORAGE_BOXES_DIR, storageFolder).catch(() => '');
  if (!boxesFolder) return false;
  const boxFolder = await findFolderByName(oldSlug, boxesFolder).catch(() => '');
  if (!boxFolder) return false;
  return renameDriveFile(boxFolder, newSlug).catch(() => false);
};

/** Le chemin Drive d'un storage / d'une boîte, tel qu'il s'affiche dans l'UI. */
export const storageDrivePathLabel = (names) => (Array.isArray(names) ? names.join(' / ') : '');

/** Le dossier exact où l'étiquette d'une boîte est déposée. */
export const boxLabelFolderPath = (storage, box) => storageBoxFolderPath(storage, box);

