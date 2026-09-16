/* =========================================================================
   src/utils/driveMirror.js
   LE DRIVE EST LE MIROIR DU PROGRAMME — suppressions et renommages compris.

   L'application savait déjà ranger les fichiers sur le Drive (dossiers
   <dataset>/projects/<projet>/…). Il lui manquait les deux gestes qui font
   qu'un miroir est un miroir :

     • SUPPRIMER : effacer un dataset (ou un projet) n'effaçait rien sur le
       Drive. Les fichiers, les dossiers et leurs noms restaient — et comme
       l'application cherchait ensuite le dossier par son nom, elle en créait
       un second, vide, à côté du premier : « je vois réapparaître des dossiers
       que j'avais supprimés ».
     • RENOMMER : le dossier n'était renommé que sur le poste qui avait gardé
       son identifiant en mémoire. Depuis un autre poste, l'application ne
       trouvait pas le dossier sous son nouveau nom et en créait un autre.

   Ces deux gestes sont ici, TOUJOURS BEST-EFFORT (Drive éteint, réseau, droits :
   on rend un compte rendu, on ne lève jamais) :

     mirrorDeleteDataset  → le dossier <dataset>/ part à la corbeille Drive
     mirrorRenameDataset  → <ancien titre>/ devient <nouveau titre>/
     mirrorDeleteProject  → <dataset>/projects/<projet>/ ET <dataset>/<projet>/
                            (le dossier des documents de section) partent à la
                            corbeille (+ les pierres tombales des deux chemins :
                            ils ne se recréent pas)
     mirrorRenameProject  → le dossier du projet ET son fichier
                            <projet>_document.json sont renommés

   Les identifiants des dossiers sont retenus dans le registre partagé
   (driveMirrorStore.js → Lab Workspace/_workspace/state.json), donc renommer
   ou supprimer fonctionne depuis N'IMPORTE QUEL poste. Nextcloud est traité
   de la même façon (DELETE / MOVE WebDAV).
   ========================================================================= */

import {
  getDriveToken, ensureLabWorkspaceFolder, findFolderByName,
  findDriveFileByName, getDriveFileMeta, trashDriveFile, renameDriveFile
} from './driveUpload';
import {
  getCloudProvider, nextcloudConfigured, nextcloudDavBase, ncDelete, ncMove
} from './nextcloud';
import { sanitizeSlug } from './driveNaming';
import { projectDocumentFileName } from './projectDocumentDrive';
import {
  readDriveMirror, writeDriveMirror, addDriveTombstone, rememberDatasetFolder,
  rememberProjectFolder, forgetProjectFolder, findDatasetFolderId, findProjectFolderId,
  projectFolderPaths, datasetFolderNameOf
} from './driveMirrorStore';

/** Le nom de dossier d'un dataset ('' si l'on ne sait rien de lui). */
export const mirrorDatasetFolderName = ({ id = '', name = '' } = {}) => datasetFolderNameOf(name, id);

/** Vrai quand le miroir Drive est utilisable pour ce poste (Drive connecté ou
 *  Nextcloud configuré). Sans backend, toutes les opérations rendent
 *  `{ ok:false, reason:'no-backend' }` — jamais d'erreur. */
export const mirrorAvailable = () => {
  if (getCloudProvider() === 'nextcloud') return nextcloudConfigured();
  return !!getDriveToken();
};

const ok = (extra = {}) => ({ ok: true, provider: getCloudProvider(), ...extra });
const failed = (reason, extra = {}) => ({ ok: false, reason, provider: getCloudProvider(), ...extra });

/** Cible Nextcloud d'un chemin relatif au dossier « Lab Workspace ». */
const ncUrlOf = (segments = []) => {
  const base = nextcloudDavBase();
  if (!base) return '';
  const parts = ['Lab Workspace', ...segments.filter(Boolean).map((s) => sanitizeSlug(s))];
  return `${base}/${parts.map((p) => encodeURIComponent(p)).join('/')}`;
};

/** Le dossier Drive d'un dataset : le registre d'abord (identifiant partagé,
 *  donc valable depuis n'importe quel poste), puis le nom (slug), puis le nom
 *  de secours `dataset_<id>` utilisé quand le titre n'était pas encore connu.
 *  Ne crée RIEN : un dossier absent rend ''. */
export const findDatasetFolder = async ({ id = '', name = '', extraNames = [] } = {}) => {
  if (getCloudProvider() === 'nextcloud') return '';
  if (!getDriveToken()) return '';
  const mirror = readDriveMirror();
  const registered = findDatasetFolderId(mirror, { id, name });
  if (registered) {
    try {
      const meta = await getDriveFileMeta(registered);
      if (meta && meta.id && !meta.trashed) return meta.id;
    } catch { /* dossier déplacé / plus accessible → on retombe sur le nom */ }
  }
  const workspaceId = await ensureLabWorkspaceFolder();
  if (!workspaceId) return '';
  const wanted = [mirrorDatasetFolderName({ id, name }), ...extraNames.map((n) => sanitizeSlug(n))]
    .filter(Boolean);
  if (id) wanted.push(`dataset_${sanitizeSlug(id)}`);
  for (const candidate of wanted) {
    const found = await findFolderByName(candidate, workspaceId);
    if (found) return found;
  }
  return '';
};


/* ── SUPPRIMER UN DATASET : son dossier Drive part avec lui ───────────────── */

/**
 * Effacer un dataset sur le Drive : son dossier (donc tous ses fichiers) part à
 * la corbeille, et une PIERRE TOMBALE (id du dataset, chemin vide) est écrite
 * dans le miroir — dans ce navigateur ET dans le fichier d'état du Drive, donc
 * sur tous les postes. C'est cette tombe qui empêche un dataset supprimé de
 * réapparaître ailleurs (App.jsx filtre la liste avec isDatasetMirrorDeleted).
 *
 * @param {{id:string,name:string,extraNames?:string[]}} dataset
 * @returns {Promise<{ok:boolean,provider:string,reason?:string,folderIds?:string[]}>}
 */
export const mirrorDeleteDataset = async ({ id = '', name = '', extraNames = [] } = {}) => {
  const record = () => writeDriveMirror(
    addDriveTombstone(readDriveMirror(), { id, name, path: '' }, Date.now())
  );
  if (!id && !name) return failed('no-dataset');
  try {
    if (getCloudProvider() === 'nextcloud') {
      if (!nextcloudConfigured()) { record(); return failed('no-backend'); }
      const urls = [datasetFolderNameOf(name, id), ...extraNames.map((n) => sanitizeSlug(n))]
        .filter(Boolean).map((slug) => ncUrlOf([slug]));
      const deleted = [];
      for (const url of urls) {
        if (url && await ncDelete(url)) deleted.push(url);
      }
      record();
      return ok({ folderIds: deleted });
    }
    if (!getDriveToken()) { record(); return failed('no-backend'); }
    const folderId = await findDatasetFolder({ id, name, extraNames });
    const trashed = folderId ? await trashDriveFile(folderId) : false;
    record();
    return ok({ folderIds: folderId ? [folderId] : [], trashed });
  } catch (err) {
    /* Même si Drive n'a pas répondu, la tombe est écrite : la suppression est
       déjà actée dans le programme, et un dossier orphelin vaut mieux qu'un
       dataset qui revient. */
    record();
    return failed(String((err && err.message) || err));
  }
};

/* ── RENOMMER UN DATASET : le dossier Drive est renommé en place ──────────── */

/**
 * Renommer le dossier Drive d'un dataset. Cherché par identifiant (registre
 * partagé, donc valable depuis n'importe quel poste) puis par ancien nom :
 * jamais de second dossier créé à côté de l'ancien.
 * @returns {Promise<{ok:boolean,provider:string,reason?:string,folderId?:string}>}
 */
export const mirrorRenameDataset = async ({ id = '', oldName = '', newName = '' } = {}) => {
  const target = datasetFolderNameOf(newName, id);
  if (!target) return failed('no-new-name');
  const previous = datasetFolderNameOf(oldName, '');
  if (previous && previous === target) return ok({ folderId: '' });
  try {
    if (getCloudProvider() === 'nextcloud') {
      if (!nextcloudConfigured()) return failed('no-backend');
      const from = ncUrlOf([previous || datasetFolderNameOf('', id)]);
      const to = ncUrlOf([target]);
      if (!from || !to) return failed('no-dataset-folder');
      const moved = await ncMove(from, to);
      return moved ? ok({ folderId: to }) : failed('not-found');
    }
    if (!getDriveToken()) return failed('no-backend');
    const folderId = await findDatasetFolder({ id, name: oldName });
    if (!folderId) return failed('not-found');
    const renamed = await renameDriveFile(folderId, target);
    if (renamed) {
      writeDriveMirror(rememberDatasetFolder(readDriveMirror(), { id, name: newName, folderId }));
    }
    return renamed ? ok({ folderId }) : failed('rename-failed');
  } catch (err) {
    return failed(String((err && err.message) || err));
  }
};


/* ── PROJETS : dossier du projet + son document de texte ──────────────────── */

/** Le dossier `projects/` d'un dataset ('' s'il n'existe pas encore). */
const findProjectsFolder = async (dataset) => {
  const datasetFolderId = await findDatasetFolder(dataset);
  if (!datasetFolderId) return '';
  return findFolderByName('projects', datasetFolderId);
};

/** Le dossier Drive d'un projet : registre partagé, puis nom exact. */
const findProjectFolder = async ({ datasetId = '', datasetName = '', projectName = '', knownFolderId = '' }) => {
  if (knownFolderId) {
    try {
      const meta = await getDriveFileMeta(knownFolderId);
      if (meta && meta.id && !meta.trashed) return meta.id;
    } catch { /* dossier disparu → on cherche par nom */ }
  }
  const registered = findProjectFolderId(readDriveMirror(), { datasetId, datasetName, projectName });
  if (registered) {
    try {
      const meta = await getDriveFileMeta(registered);
      if (meta && meta.id && !meta.trashed) return meta.id;
    } catch { /* ignore */ }
  }
  const projectsFolderId = await findProjectsFolder({ id: datasetId, name: datasetName });
  if (!projectsFolderId) return '';
  return findFolderByName(sanitizeSlug(projectName), projectsFolderId);
};

/** Le dossier de PROJET À LA RACINE du dataset (« <dataset>/<projet> »), celui
 *  qui porte les DOCUMENTS DE SECTION (<projet>/<section> — le dossier affiché
 *  sous « 📁 Drive location » de chaque section de la page projet). Il n'est pas
 *  dans « projects/ » : c'est un SECOND dossier de projet, et c'est lui qui
 *  restait sur le Drive après la suppression d'un projet. '' s'il n'existe pas. */
const findProjectRootFolder = async ({ datasetId = '', datasetName = '', projectName = '' }) => {
  /* Le chemin vient de la MÊME liste que les tombes (projectFolderPaths) : un
     projet nommé comme un dossier partagé du dataset (« projects »…) n'a donc
     pas de dossier de section à chercher — on ne mettrait pas le conteneur
     commun à la corbeille. */
  const rootSlug = projectFolderPaths(projectName)[1] || '';
  if (!rootSlug) return '';
  const datasetFolderId = await findDatasetFolder({ id: datasetId, name: datasetName });
  if (!datasetFolderId) return '';
  return findFolderByName(rootSlug, datasetFolderId);
};

/**
 * Supprimer un projet : SES DEUX dossiers Drive partent à la corbeille — les
 * expériences, figures et le document (`projects/<projet>`) ET le dossier des
 * documents de section (`<projet>`, à la racine du dataset, voir
 * driveNaming.projectSectionFolderPath). Les deux chemins sont mis en pierre
 * tombale, donc ni l'un ni l'autre ne se recrée, et un autre poste ne les voit
 * plus. Le compte rendu dit ce qui a été trouvé (`missing`) : un dossier absent
 * (déjà supprimé, ou projet jamais envoyé sur le Drive) n'est pas une erreur.
 */
export const mirrorDeleteProject = async ({ datasetId = '', datasetName = '', projectName = '' } = {}) => {
  const paths = projectFolderPaths(projectName);
  const record = () => {
    let mirror = readDriveMirror();
    paths.forEach((path) => {
      mirror = addDriveTombstone(mirror, {
        id: datasetId, name: datasetName, path, kind: 'project'
      }, Date.now());
    });
    return writeDriveMirror(mirror);
  };
  if (!projectName) return failed('no-project');
  try {
    if (getCloudProvider() === 'nextcloud') {
      if (!nextcloudConfigured()) { record(); return failed('no-backend'); }
      const datasetSlug = datasetFolderNameOf(datasetName, datasetId);
      const urls = datasetSlug ? [
        ncUrlOf([datasetSlug, 'projects', sanitizeSlug(projectName)]),
        ncUrlOf([datasetSlug, sanitizeSlug(projectName)])
      ] : [];
      const deleted = [];
      for (const url of urls) { if (url && await ncDelete(url)) deleted.push(url); }
      record();
      return deleted.length ? ok({ folderIds: deleted }) : failed('not-found');
    }
    if (!getDriveToken()) { record(); return failed('no-backend'); }
    const folderId = await findProjectFolder({ datasetId, datasetName, projectName });
    const rootFolderId = await findProjectRootFolder({ datasetId, datasetName, projectName });
    const trashed = [];
    if (folderId && await trashDriveFile(folderId)) trashed.push(folderId);
    if (rootFolderId && rootFolderId !== folderId && await trashDriveFile(rootFolderId)) {
      trashed.push(rootFolderId);
    }
    record();
    return ok({
      folderIds: trashed, trashed: trashed.length > 0, missing: !folderId && !rootFolderId
    });
  } catch (err) {
    record();
    return failed(String((err && err.message) || err));
  }
};

/**
 * Renommer un projet sur le Drive : `<dataset>/projects/<ancien>` devient
 * `<nouveau>`, et le document `<ancien>_document.json` (voir
 * projectDocumentDrive.js) est renommé AVEC lui — sinon deux copies du texte du
 * projet cohabiteraient dans le dossier.
 */
export const mirrorRenameProject = async ({
  datasetId = '', datasetName = '', oldName = '', newName = '', knownFolderId = ''
} = {}) => {
  const target = sanitizeSlug(newName);
  if (!target || sanitizeSlug(oldName) === target) return ok({ folderId: '' });
  try {
    if (getCloudProvider() === 'nextcloud') {
      if (!nextcloudConfigured()) return failed('no-backend');
      const datasetSlug = datasetFolderNameOf(datasetName, datasetId);
      if (!datasetSlug) return failed('no-dataset-folder');
      const from = ncUrlOf([datasetSlug, 'projects', sanitizeSlug(oldName)]);
      const to = ncUrlOf([datasetSlug, 'projects', target]);
      const moved = await ncMove(from, to);
      if (moved) {
        await ncMove(
          `${from}/${encodeURIComponent(projectDocumentFileName({ name: oldName }))}`,
          `${to}/${encodeURIComponent(projectDocumentFileName({ name: newName }))}`
        ).catch(() => false);
      }
      /* Le dossier de SECTION du projet (<ancien>, à la racine du dataset) suit
         lui aussi le renommage : sinon il restait sous l'ancien nom. */
      const rootFrom = ncUrlOf([datasetSlug, sanitizeSlug(oldName)]);
      const rootTo = ncUrlOf([datasetSlug, target]);
      if (rootFrom && rootTo) await ncMove(rootFrom, rootTo).catch(() => false);
      return moved ? ok({ folderId: to }) : failed('not-found');
    }
    if (!getDriveToken()) return failed('no-backend');
    let folderId = await findProjectFolder({
      datasetId, datasetName, projectName: oldName, knownFolderId
    });
    /* Le dossier peut DÉJÀ porter le nouveau nom (l'application renomme aussi
       le dossier via renameDriveFilesFor) : on ne cherche pas à renommer deux
       fois — on termine le travail (document + registre partagé). */
    let alreadyRenamed = false;
    if (!folderId) {
      const currentId = await findProjectFolder({ datasetId, datasetName, projectName: newName });
      if (currentId) { folderId = currentId; alreadyRenamed = true; }
    }
    if (!folderId) return failed('not-found');
    if (!alreadyRenamed) {
      const renamed = await renameDriveFile(folderId, target);
      if (!renamed) return failed('rename-failed');
    }
    try {
      const docId = await findDriveFileByName(projectDocumentFileName({ name: oldName }), folderId);
      if (docId) await renameDriveFile(docId, projectDocumentFileName({ name: newName }));
    } catch { /* le document sera réécrit au prochain archivage */ }

    /* Le dossier de PROJET À LA RACINE du dataset (« <ancien> », celui des
       documents de section) est renommé AVEC le projet : sans cela il restait
       sous l'ancien nom et un second dossier apparaissait sous le nouveau — les
       documents de section semblaient avoir disparu. Best-effort : un dossier
       absent est simplement recréé au prochain envoi. */
    try {
      const rootFolderId = await findProjectRootFolder({
        datasetId, datasetName, projectName: oldName
      });
      if (rootFolderId) await renameDriveFile(rootFolderId, target);
    } catch { /* ignore */ }

    const withoutOld = forgetProjectFolder(readDriveMirror(), { datasetId, datasetName, projectName: oldName });
    writeDriveMirror(rememberProjectFolder(withoutOld, {
      datasetId, datasetName, projectName: newName, folderId
    }));
    return ok({ folderId });
  } catch (err) {
    return failed(String((err && err.message) || err));
  }
};
