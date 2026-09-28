/* =========================================================================
   src/utils/projectRootMigrate.js — LES DOSSIERS DE PROJET RESTÉS À LA RACINE
   DU DATASET SONT RANGÉS DANS `projects/`.

   Signalé le 25/09/2026 : « je trouve des dossiers au nom d'un projet en dehors
   du dossier projects ». Ils venaient des DOCUMENTS DE SECTION de la page projet,
   qui étaient envoyés dans `<dataset>/<projet>/<section>` (voir l'ancienne route
   `driveNaming.projectSectionFolderPath`) : un second dossier de projet, à côté
   de `projects/`, alors que la structure déclarée du dataset n'admet QUE
   `projects`, `general_library_images`, `backups`, `protocols`, `storage`,
   `publications` (voir driveNaming.DATASET_FOLDER_DIRS).

   Deux choses, ici :
     1. la ROUTE a changé (`projects/<projet>/<section>`, comme les expériences,
        les figures, le document de texte et les `useful_files` du projet) ;
     2. ce module DÉPLACE ce qui existe déjà, une fois par dataset, quand le Drive
        est prêt (voir App.jsx) :
          `<dataset>/<projet>/<section>/<doc>`  →  `<dataset>/projects/<projet>/<section>/<doc>`
        Le dossier du projet est créé s'il manque, un dossier de section dont le
        nom est déjà pris est FUSIONNÉ (ses fichiers rejoignent celui du projet),
        et un FICHIER dont le nom est déjà pris est LAISSÉ (on n'écrase jamais un
        document). La racine vidée part à la corbeille et son chemin est mis en
        PIERRE TOMBALE, donc aucun envoi ne le recrée.

   Reconnaître un dossier de projet resté à la racine : son nom est celui d'un
   dossier déjà présent dans `projects/`, OU son contenu est fait de dossiers de
   SECTION de projet (Background, Discussion…). Tout autre dossier inattendu est
   LAISSÉ en place et annoncé (`kept`) — on ne range pas ce qu'on ne comprend pas.

   Tout est « au mieux » : un Drive muet laisse le dataset tel quel (la lecture
   continue de fonctionner — les documents de section sont référencés par leur
   lien Drive, pas par une lecture du dossier) et la migration repart au prochain
   démarrage. La logique de reconnaissance est PURE et vérifiée hors navigateur
   (voir _project_root_migrate_test.mjs).
   ========================================================================= */
import {
  canonicalDatasetDirId, ensureDriveFolder, findDriveFileByName, findFolderByName,
  findOrCreateFolder, getDriveRootId, getDriveRootName, getDriveToken, listDriveChildren,
  moveDriveFile, trashDriveFile
} from './driveUpload';
import {
  DATASET_FOLDER_DIRS, PROJECTS_CONTAINER, isProjectSectionFolderName, sanitizeSlug
} from './driveNaming';
import { addDriveTombstone, isDrivePathMirrorDeleted, readDriveMirror, writeDriveMirror } from './driveMirrorStore';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Un dossier du Drive (et non un fichier). */
const isFolder = (node) => !!node && !!node.id && String(node.mimeType || '') === FOLDER_MIME;

/** Les enfants d'un dossier (dossiers ET fichiers), best-effort. */
const childrenOf = async (folderId) => listDriveChildren(folderId).catch(() => []);

/** Vrai quand ce dossier de la RACINE du dataset est le dossier « documents de
 *  section » d'un PROJET : soit un dossier du même nom existe déjà dans
 *  `projects/` (c'est LE dossier du projet, l'autre est le doublon), soit son
 *  contenu est fait de dossiers de section de projet. Un conteneur partagé du
 *  dataset (`projects`, `backups`…) n'est jamais candidat. PUR. */
export const looksLikeProjectSectionFolder = ({ name = '', childNames = [], isKnownProject = false } = {}) => {
  const slug = sanitizeSlug(name);
  if (!slug || DATASET_FOLDER_DIRS.includes(slug.toLowerCase())) return false;
  if (isKnownProject) return true;
  return (Array.isArray(childNames) ? childNames : []).some((child) => isProjectSectionFolderName(child));
};

/** Le drapeau « déjà fait » — une entrée par dataset, comme le déménagement de
 *  la bibliothèque commune (voir commonLibraryMigrate.js). */
const FLAG_KEY = 'labProjectRootMigrated';
export const projectRootMigratedFlagKey = (datasetId = '') => `${FLAG_KEY}::${datasetId || 'nods'}`;
const isDone = (datasetId) => {
  try { return localStorage.getItem(projectRootMigratedFlagKey(datasetId)) === '1'; } catch { return false; }
};
const markDone = (datasetId) => {
  try { localStorage.setItem(projectRootMigratedFlagKey(datasetId), '1'); } catch { /* au mieux */ }
};

/**
 * Le déménagement lui-même. Rend un RAPPORT : `{ moved, merged, kept, trashed, reason }`
 * (chemins relatifs au dossier du dataset, pour que le constat soit lisible).
 * @returns {Promise<{moved:string[],merged:string[],kept:string[],trashed:string[],reason:string}>}
 */
export const migrateProjectRootFolders = async () => {
  const report = { moved: [], merged: [], kept: [], trashed: [], reason: '' };
  if (!getDriveToken()) return { ...report, reason: 'no-drive' };
  const datasetId = String(getDriveRootId() || '');
  const rootId = await ensureDriveFolder().catch(() => '');
  if (!rootId) return { ...report, reason: 'no-dataset' };
  const datasetName = getDriveRootName();
  const projectsId = await canonicalDatasetDirId(PROJECTS_CONTAINER, { rootId, create: true }).catch(() => '');
  if (!projectsId) return { ...report, reason: 'no-projects' };

  const atRoot = (await childrenOf(rootId)).filter(isFolder);
  for (const node of atRoot) {
    const name = String(node.name || '');
    const slug = sanitizeSlug(name);
    // Les conteneurs partagés du dataset ne sont jamais déplacés.
    if (!slug || DATASET_FOLDER_DIRS.includes(slug.toLowerCase())) continue;
    // Un chemin supprimé dans le programme ne se recrée pas (et ne se « répare » pas).
    if (isDrivePathMirrorDeleted(readDriveMirror(), { dataset: { id: datasetId, name: datasetName }, path: slug })) continue;

    const insideProjects = await findFolderByName(slug, projectsId).catch(() => '');
    const children = await childrenOf(node.id);
    const childNames = children.map((c) => String(c.name || ''));
    if (!looksLikeProjectSectionFolder({ name, childNames, isKnownProject: !!insideProjects })) {
      report.kept.push(name);
      continue;
    }
    const destId = insideProjects || await findOrCreateFolder(slug, projectsId).catch(() => '');
    if (!destId) { report.kept.push(name); continue; }

    /* DÉPLACER, SANS JAMAIS ÉCRASER : un enfant dont le nom existe déjà à
       destination est laissé en place (un fichier = un document à ne pas perdre ;
       un dossier = on verse seulement ses fichiers dans celui du projet). */
    for (const child of children) {
      const childName = String(child.name || '');
      const clashFolder = await findFolderByName(childName, destId).catch(() => '');
      const clashFile = clashFolder ? '' : await findDriveFileByName(childName, destId).catch(() => '');
      if (!clashFolder && !clashFile) {
        if (await moveDriveFile(child.id, destId).catch(() => false)) report.moved.push(`${name}/${childName}`);
        else report.kept.push(`${name}/${childName}`);
        continue;
      }
      if (!isFolder(child)) { report.kept.push(`${name}/${childName}`); continue; }
      const twins = await childrenOf(child.id);
      for (const leaf of twins) {
        const leafName = String(leaf.name || '');
        if (isFolder(leaf)) { report.kept.push(`${name}/${childName}/${leafName}`); continue; }
        const leafClash = await findDriveFileByName(leafName, clashFolder).catch(() => '');
        if (leafClash) { report.kept.push(`${name}/${childName}/${leafName}`); continue; }
        if (await moveDriveFile(leaf.id, clashFolder).catch(() => false)) report.merged.push(`${name}/${childName}/${leafName}`);
        else report.kept.push(`${name}/${childName}/${leafName}`);
      }
      const leftTwin = await childrenOf(child.id);
      if (leftTwin.length === 0) {
        if (await trashDriveFile(child.id).catch(() => false)) report.trashed.push(`${name}/${childName}`);
      } else {
        // Il reste quelque chose (fichiers en double…) : le dossier est ANNONCÉ.
        report.kept.push(`${name}/${childName}`);
      }
    }
    /* LA RACINE VIDÉE PART À LA CORBEILLE — et son chemin devient une PIERRE
       TOMBALE : un envoi qui recalculerait ce chemin est refusé
       (driveUpload.resolveDrivePathFromNames → isDrivePathMirrorDeleted). */
    const leftAtRoot = await childrenOf(node.id);
    if (leftAtRoot.length === 0) {
      if (await trashDriveFile(node.id).catch(() => false)) {
        report.trashed.push(name);
        writeDriveMirror(addDriveTombstone(
          readDriveMirror(), { id: datasetId, name: datasetName, path: slug, kind: 'folder' }, Date.now()
        ));
      }
    } else {
      // Quelque chose n'a pas pu être rangé : on le DIT au lieu de le taire.
      report.kept.push(name);
    }
  }
  return report;
};

/** Le geste, UNE FOIS par dataset : appelé quand le Drive est prêt (App.jsx).
 *  `force` refait le geste même si le drapeau dit « déjà fait ». */
export const migrateProjectRootFoldersOnce = async ({ force = false } = {}) => {
  const datasetId = String(getDriveRootId() || '');
  if (!force && isDone(datasetId)) return { skipped: true };
  let report;
  try { report = await migrateProjectRootFolders(); } catch { report = { moved: [], merged: [], kept: [], trashed: [], reason: 'error' }; }
  if (report && !report.reason) {
    markDone(datasetId);
    if (report.moved.length || report.merged.length) {
      console.info(
        'Dossiers de projet rangés dans projects/ :',
        report.moved.length ? `${report.moved.length} dossier(s)/fichier(s) déplacé(s)` : '',
        report.merged.length ? `· ${report.merged.length} fusionné(s)` : '',
        report.kept.length ? `· laissé(s) en place : ${report.kept.join(', ')}` : ''
      );
    }
  }
  return report;
};
