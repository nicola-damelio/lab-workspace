/* =========================================================================
   _esm_test_hook.mjs — résolveur ESM pour les tests « node » du dépôt.

   Les modules de src/ s'importent SANS extension (« ../data/constants ») :
   c'est Vite/rolldown qui complète à la compilation, pas Node. Ce crochet
   permet donc à `node _xxx_test.mjs` d'importer les sources RÉELLES (Node 24
   ne propose plus --experimental-specifier-resolution=node). Il remplace
   aussi src/utils/driveUpload.js (module navigateur : OAuth, Google Drive)
   par un bouchon, pour que les helpers du module Administration restent
   testables hors navigateur.
   ========================================================================= */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CANDIDATES = ['.js', '.jsx', '/index.js', '/index.jsx'];

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[a-z0-9]+$/i.test(specifier)) {
    try {
      const base = fileURLToPath(new URL(specifier, context.parentURL));
      const ext = CANDIDATES.find((e) => existsSync(base + e));
      if (ext) return next(specifier + ext, context);
    } catch { /* laisse la résolution standard expliquer l'erreur */ }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.endsWith('/src/utils/driveUpload.js')) {
    return {
      format: 'module',
      shortCircuit: true,
      source: [
        // `globalThis.__driveTestMocks` laisse un test fournir un faux Drive
        // (cloudBackendAvailable / uploadLocalFile / resolveDrivePathFromNames /
        // listDriveChildren / uploadWorkspaceFile / downloadDriveFileText /
        // driveToken / driveRootName). Sans mocks : cloud indisponible, dossier
        // vide, aucun jeton — c'est le comportement par défaut des suites
        // existantes.
        'const M = () => (globalThis.__driveTestMocks && typeof globalThis.__driveTestMocks === "object") ? globalThis.__driveTestMocks : {};',
        'export const sendAdminGmail = async () => ({ ok: false, reason: "bouchon de test (hors navigateur)" });',
        'export const uploadLocalFile = async (arg) => (typeof M().uploadLocalFile === "function" ? M().uploadLocalFile(arg) : { ok: false, reason: "bouchon de test (hors navigateur)" });',
        'export const cloudBackendAvailable = () => M().cloud === true;',
        // Mode « espace partagé » du Drive (driveUpload.js) : lu par les helpers de
        // rangement (administration/driveFiling.js) et le miroir du Drive. Sans
        // mock il vaut false — le comportement par défaut des suites existantes.
        'export const sharedWorkspaceMode = () => M().sharedWorkspaceMode === true;',
        // Ce qui vient d’arriver au dernier upload (« mis en file de reprise ? ») :
        // figuresLibrary s’en sert pour DIRE pourquoi la copie cloud manque.
        'export const takeLastUploadQueueInfo = () => (typeof M().takeLastUploadQueueInfo === "function" ? M().takeLastUploadQueueInfo() : null);',
        'export const downloadDriveFileBytes = async () => { throw new Error("bouchon de test"); };',
        // figuresLibrary.js importe aussi ces helpers : ils ne servent jamais
        // hors navigateur (cloudBackendAvailable() vaut false), mais le module
        // doit pouvoir être IMPORTÉ par les tests.
        'export const getDriveToken = () => (M().driveToken !== undefined ? M().driveToken : null);',
        // Upload vers « Lab Workspace/<folder>/<name> » : un faux Drive peut le
        // capter (voir _project_drive_doc_test.mjs) et relire ce qu'il a reçu.
        'export const uploadWorkspaceFile = async (arg) => (typeof M().uploadWorkspaceFile === "function" ? M().uploadWorkspaceFile(arg) : null);',
        'export const downloadDriveFileText = async (id) => (typeof M().downloadDriveFileText === "function" ? M().downloadDriveFileText(id) : "");',
        'export const dataUrlToBlob = (u) => (typeof M().dataUrlToBlob === "function" ? M().dataUrlToBlob(u) : null);',
        'export const getDriveRootName = () => M().driveRootName || "";',
        'export const resolveDrivePathFromNames = async (names, opts) => (typeof M().resolveDrivePathFromNames === "function" ? M().resolveDrivePathFromNames(names, opts) : { leafId: "", path: [] });',
        'export const listDriveChildren = async (id) => (typeof M().listDriveChildren === "function" ? M().listDriveChildren(id) : []);',
        // Miroir du Drive (driveMirror.js / workspaceDrive.js) : un faux Drive
        // peut fournir dossiers et fichiers, mettre à la corbeille, renommer…
        'export const ensureLabWorkspaceFolder = async () => (typeof M().ensureLabWorkspaceFolder === "function" ? M().ensureLabWorkspaceFolder() : "ws_folder");',
        // Racine du DATASET (dossier du dataset dans « Lab Workspace ») : un faux
        // Drive la fournit pour que les helpers qui CHERCHENT un dossier existant
        // (utils/figuresFolder.js) restent testables hors navigateur.
        'export const ensureDriveFolder = async () => (typeof M().ensureDriveFolder === "function" ? M().ensureDriveFolder() : "ds_folder");',
        'export const getDriveRootId = () => M().driveRootId || "";',
        'export const findFolderByName = async (name, parent) => (typeof M().findFolderByName === "function" ? M().findFolderByName(name, parent) : "");',
        // TOUS les jumeaux d'un nom (voir datasetDirTwins.js) : un faux Drive peut
        // en fournir plusieurs pour vérifier qu'on ne crée pas un second conteneur.
        'export const listFoldersByName = async (name, parent) => (typeof M().listFoldersByName === "function" ? M().listFoldersByName(name, parent) : []);',
        // Le conteneur canonique (projects / protocols / …) résolu par identité ;
        // sans mock il est « introuvable », donc les appelants retombent sur la
        // recherche par nom (comportement des suites existantes).
        'export const canonicalDatasetDirId = async (dir, opts) => (typeof M().canonicalDatasetDirId === "function" ? M().canonicalDatasetDirId(dir, opts) : "");',
        'export const findDriveFileByName = async (name, parent) => (typeof M().findDriveFileByName === "function" ? M().findDriveFileByName(name, parent) : "");',
        'export const findOrCreateFolder = async (name, parent) => (typeof M().findOrCreateFolder === "function" ? M().findOrCreateFolder(name, parent) : "");',
        'export const getDriveFileMeta = async (id) => (typeof M().getDriveFileMeta === "function" ? M().getDriveFileMeta(id) : { id: String(id || ""), name: "", trashed: false, parents: [] });',
        // Déplacer un FICHIER d'un dossier à l'autre (figuresLibrary : une image
        // de bibliothèque qui change de portée suit son dossier sur le Drive).
        'export const moveDriveFile = async (id, parent) => (typeof M().moveDriveFile === "function" ? M().moveDriveFile(id, parent) : false);',
        // Le REGISTRE local des fichiers (nom + contexte de nommage) : un
        // déplacement de bibliothèque le réécrit pour que le dossier suive le
        // projet (voir driveUpload.renameDriveFilesFor).
        'export const getDriveFileRegistry = () => (typeof M().getDriveFileRegistry === "function" ? M().getDriveFileRegistry() : {});',
        'export const registerDriveFile = (id, name, ctx, path) => (typeof M().registerDriveFile === "function" ? M().registerDriveFile(id, name, ctx, path) : undefined);',
        'export const trashDriveFile = async (id) => (typeof M().trashDriveFile === "function" ? M().trashDriveFile(id) : false);',
        // migrateTestImages.js (importé par les helpers de signature des devis /
        // BC) importe aussi la mise à la corbeille d'une chaîne de dossiers vides.
        'export const trashEmptyFolderChain = async (id) => (typeof M().trashEmptyFolderChain === "function" ? M().trashEmptyFolderChain(id) : false);',
        // Téléchargement et recherche Drive : la restauration automatique
        // (utils/driveRestore.js) s'en sert ; un faux Drive les fournit pour que
        // le mécanisme soit vérifié de bout en bout hors navigateur.
        'export const driveFetch = async (path, opts) => (typeof M().driveFetch === "function" ? M().driveFetch(path, opts) : { ok: false, status: 501, json: async () => ({}), blob: async () => new Blob([]) });',
        'export const untrashDriveFile = async (id) => (typeof M().untrashDriveFile === "function" ? M().untrashDriveFile(id) : false);',
        'export const renameDriveFile = async (id, name) => (typeof M().renameDriveFile === "function" ? M().renameDriveFile(id, name) : false);',
      ].join('\n'),
    };
  }
  return next(url, context);
}
