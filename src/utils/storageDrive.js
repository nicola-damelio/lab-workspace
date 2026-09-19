/* =========================================================================
   src/utils/storageDrive.js — le rangement Drive d'un STORAGE et de ses BOÎTES.

   Structure canonique (voir driveNaming) :

       storage/<storage>/images/<fichier>          ← image de référence
       storage/<storage>/boxes/<boîte>/images/<f>  ← photos de la boîte
       storage/<storage>/boxes/<boîte>/label.pdf   ← étiquette de la boîte

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
  getDriveFileMeta, moveDriveFile, renameDriveFile, resolveDrivePathFromNames, uploadLocalFile
} from './driveUpload';
import {
  BOX_LABEL_FILE_NAME, STORAGE_BOXES_DIR, STORAGE_DIR, sanitizeSlug,
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

/** Dépose (ou remplace) label.pdf dans storage/<storage>/boxes/<boîte>/.
 *  Le nom reste « label.pdf » : réenvoyer la même étiquette écrase la
 *  précédente au lieu d'empiler des copies.
 *  @returns {Promise<{id:string,name:string,driveUrl:string}|null>} */
export const saveBoxLabelFile = async ({ storage, box, blob, name = BOX_LABEL_FILE_NAME }) => {
  if (!blob || !cloudBackendAvailable()) return null;
  return uploadLocalFile({
    name,
    mimeType: 'application/pdf',
    file: blob,
    path: storageBoxFolderPath(storage, box),
    /* Le contexte de nommage est enregistré : la suppression de la boîte
       (markAttachmentsDeleted) et les renommages savent où vit ce fichier.
       `title` garantit qu'un futur renommage recalcule le MÊME nom. */
    ctx: { storage, box, title: String(name).replace(/\.[^/.]+$/, ''), section: '' }
  });
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
 *  @returns {Promise<number>} nombre de fichiers déplacés */
export const tidyStorageFiles = async ({ storage, box = '', urls = [] }) => {
  if (!cloudBackendAvailable()) return 0;
  const ids = [...new Set((Array.isArray(urls) ? urls : [urls]).flatMap((u) => driveFileIdsIn(u)))];
  if (!ids.length) return 0;
  const names = box ? storageBoxImagesFolderPath(storage, box) : storageImagesFolderPath(storage);
  let target = '';
  let moved = 0;
  for (const id of ids) {
    try {
      const meta = await getDriveFileMeta(id);
      if (!meta || !meta.id || meta.trashed) continue;
      if (!target) {
        const resolved = await resolveDrivePathFromNames(names);
        target = resolved && resolved.leafId ? String(resolved.leafId) : '';
      }
      if (!target) return moved;
      const parents = Array.isArray(meta.parents) ? meta.parents.map(String) : [];
      if (parents.includes(target)) continue;
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
 *  qu'elle contient (photos, label.pdf) suit le dossier automatiquement.
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

