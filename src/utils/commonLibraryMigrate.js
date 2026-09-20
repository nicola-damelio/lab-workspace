/* =========================================================================
   src/utils/commonLibraryMigrate.js — LE DÉMÉNAGEMENT DE LA BIBLIOTHÈQUE
   COMMUNE (et du bac « sans projet »), fait UNE FOIS par dataset.

   Ce qui existait :

       <dataset>/projects/unassigned/images     ← les figures sans projet
       <dataset>/projects/unassigned/<test>     ← les expériences sans projet

   `unassigned` n'a plus de sens : tout fichier appartient à un projet (à défaut
   au projet `test`), et les figures communes ne sont pas un projet. Le programme
   range donc, une seule fois :

       <dataset>/general_library_images         ← le dossier `images` du bac,
                                                  DÉPLACÉ à la racine du dataset
                                                  et renommé (les identifiants
                                                  des fichiers ne changent pas,
                                                  donc les liens déjà enregistrés
                                                  dans la bibliothèque continuent
                                                  de viser les mêmes figures) ;
       <dataset>/projects/test/<test>           ← chaque expérience du bac. Une
                                                  expérience qui porte déjà ce nom
                                                  dans `projects/test` est
                                                  LAISSÉE en place (on n'écrase
                                                  jamais un dossier) et annoncée ;
       le bac `unassigned`, VIDÉ               → à la corbeille (récupérable).

   Tout est « au mieux » : un Drive qui ne répond pas laisse le dataset tel quel
   — la lecture continue de fonctionner sur les anciens emplacements (voir
   figuresFolder.findCommonFiguresFolder) — et la migration repartira au prochain
   démarrage. Un bac qui porte encore quelque chose n'est jamais mis à la
   corbeille, et un nom déjà pris n'écrase rien.
   ========================================================================= */
import {
  canonicalDatasetDirId, cloudBackendAvailable, ensureDriveFolder, findFolderByName,
  findOrCreateFolder, getDriveRootId, listDriveChildren, listFoldersByName, moveDriveFile,
  renameDriveFile, trashDriveFile
} from './driveUpload';
import { DEFAULT_PROJECT_NAME, GENERAL_LIBRARY_DIR, PROJECTS_CONTAINER } from './driveNaming';
import { folderNameKey, legacyCommonFolderNames } from './figuresFolder';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
/** Un dossier du Drive (et non un fichier). */
const isFolder = (node) => !!node && !!node.id && String(node.mimeType || '') === FOLDER_MIME;
/** Ce nom est-il celui d'un dossier D'IMAGES (la bibliothèque commune ou le
 *  dossier `images` d'un projet) ? Ces dossiers ne sont JAMAIS des expériences :
 *  ils ne suivent donc pas le déménagement des expériences. */
const isImagesFolderName = (name) => {
  const key = folderNameKey(name);
  return key === folderNameKey(GENERAL_LIBRARY_DIR) || key.indexOf('images') === 0;
};
/** Les identifiants d'une liste rendue par `listFoldersByName` (objets ou chaînes). */
const idsOf = (list) => (Array.isArray(list) ? list : [])
  .map((x) => String((x && x.id) || x || '')).filter(Boolean);
/** Les FICHIERS (pas les dossiers) d'un dossier, best-effort. */
const filesOf = async (folderId) => (
  await listDriveChildren(folderId).catch(() => [])
).filter((node) => node && node.id && !isFolder(node));

/** Le drapeau « déjà fait » — un déménagement ne se relit pas à chaque
 *  démarrage. Une entrée par dataset, posée seulement quand le geste a abouti
 *  (sinon il repart au démarrage suivant). */
const flagKeyOf = (datasetId) => `labCommonLibraryMigrated::${String(datasetId || '')}`;
const isDone = (datasetId) => {
  try { return localStorage.getItem(flagKeyOf(datasetId)) === '1'; } catch { return false; }
};
const markDone = (datasetId) => {
  try { localStorage.setItem(flagKeyOf(datasetId), '1'); } catch { /* ignore */ }
};

/**
 * LE geste : la bibliothèque commune rejoint la racine du dataset et les
 * expériences du bac rejoignent `projects/test`.
 * @returns {Promise<{ libraryId:string, moved:string[], kept:string[],
 *                     merged:number, trashedBucket:boolean, reason:string }>}
 *          `reason` : '' quand tout est allé au bout — 'cloud-off' (pas de
 *          Drive), 'no-dataset' (dossier du dataset introuvable).
 */
export const migrateCommonLibrary = async () => {
  const report = { libraryId: '', moved: [], kept: [], merged: 0, trashedBucket: false, reason: '' };
  if (!cloudBackendAvailable()) { report.reason = 'cloud-off'; return report; }
  const root = await ensureDriveFolder().catch(() => '');
  if (!root) { report.reason = 'no-dataset'; return report; }
  const projectsId = (await canonicalDatasetDirId(PROJECTS_CONTAINER, { rootId: root, create: false }).catch(() => ''))
    || (await findFolderByName(PROJECTS_CONTAINER, root).catch(() => ''));

  /* ── 1. Le dossier de la bibliothèque COMMUNE ─────────────────────────────
     Son nom d'aujourd'hui d'abord ; sinon le dossier `images` du bac est
     DÉPLACÉ puis renommé (même identifiant, donc mêmes fichiers). */
  let libraryId = (await findFolderByName(GENERAL_LIBRARY_DIR, root).catch(() => '')) || '';
  const buckets = projectsId
    ? await Promise.all(legacyCommonFolderNames().map(async (name) => ({
        ids: idsOf(await listFoldersByName(name, projectsId).catch(() => []))
      })))
    : [];
  const bucketIds = buckets.flatMap((b) => b.ids);
  const legacyImagesId = async () => {
    for (const bucketId of bucketIds) {
      const id = await findFolderByName('images', bucketId).catch(() => '');
      if (id) return String(id);
    }
    return '';
  };
  if (!libraryId) {
    const imagesId = await legacyImagesId();
    if (imagesId) {
      /* DÉPLACEMENT puis RENOMMAGE : `projects/<bac>/images` devient
         `<dataset>/general_library_images`. */
      const moved = await moveDriveFile(imagesId, root).catch(() => false);
      if (moved) {
        await renameDriveFile(imagesId, GENERAL_LIBRARY_DIR).catch(() => false);
        libraryId = imagesId;
      }
    }
  } else if ((await filesOf(libraryId)).length === 0) {
    /* Le dossier du nouveau nom existe déjà (le programme le crée avec la
       structure du dataset) mais il est VIDE : un dossier vide n'est pas une
       bibliothèque — les figures du bac y entrent, et le dossier vidé part à la
       corbeille. */
    const imagesId = await legacyImagesId();
    if (imagesId) {
      const files = await filesOf(imagesId);
      let merged = 0;
      for (const file of files) {
        if (await moveDriveFile(file.id, libraryId).catch(() => false)) merged += 1;
      }
      report.merged = merged;
      if (files.length && merged === files.length) await trashDriveFile(imagesId).catch(() => false);
    }
  }
  report.libraryId = String(libraryId || '');

  /* ── 2. Les EXPÉRIENCES du bac → `projects/test/…` ──────────────────────── */
  if (bucketIds.length && projectsId) {
    const defaultProjectId = await findOrCreateFolder(DEFAULT_PROJECT_NAME, projectsId).catch(() => '');
    for (const bucketId of bucketIds) {
      const children = (await listDriveChildren(bucketId).catch(() => [])).filter(isFolder);
      for (const child of children) {
        if (isImagesFolderName(child.name)) continue; // la bibliothèque, pas une expérience
        const childName = String(child.name || '');
        if (!defaultProjectId) { report.kept.push(childName); continue; }
        const clash = await findFolderByName(childName, defaultProjectId).catch(() => '');
        if (clash && String(clash) !== String(child.id)) { report.kept.push(childName); continue; }
        if (await moveDriveFile(child.id, defaultProjectId).catch(() => false)) report.moved.push(childName);
        else report.kept.push(childName);
      }
      /* Le bac, devenu VIDE, part à la corbeille (récupérable) : « unassigned »
         n'a plus lieu d'exister. Un bac qui porte encore quoi que ce soit est
         laissé intact. */
      const left = await listDriveChildren(bucketId).catch(() => []);
      if (Array.isArray(left) && left.length === 0) {
        report.trashedBucket = (await trashDriveFile(bucketId).catch(() => false)) || report.trashedBucket;
      }
    }
  }
  return report;
};

/**
 * La migration, UNE FOIS par dataset : appelée quand le Drive est prêt (voir
 * App.jsx). `force` refait le geste même si le drapeau dit « déjà fait ».
 * @returns {Promise<object>} le rapport (voir migrateCommonLibrary), plus
 *          `{ skipped: true }` quand le drapeau est déjà posé.
 */
export const migrateCommonLibraryOnce = async ({ force = false } = {}) => {
  const datasetId = String(getDriveRootId() || '');
  if (!force && isDone(datasetId)) return { skipped: true };
  let report;
  try { report = await migrateCommonLibrary(); } catch { report = { reason: 'error' }; }
  if (report && !report.reason) {
    markDone(datasetId);
    if (report.libraryId || report.moved.length || report.merged) {
      console.info(
        'Bibliothèque commune rangée :',
        `general_library_images${report.libraryId ? '' : ' (à créer au prochain envoi)'}`,
        report.merged ? `· ${report.merged} fichier(s) rapatrié(s)` : '',
        report.moved.length ? `· ${report.moved.length} expérience(s) → projects/${DEFAULT_PROJECT_NAME}` : '',
        report.kept.length ? `· laissé(s) en place : ${report.kept.join(', ')}` : ''
      );
    }
  }
  return report;
};
