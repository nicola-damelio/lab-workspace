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
        'export const resolveDrivePathFromNames = async (names) => (typeof M().resolveDrivePathFromNames === "function" ? M().resolveDrivePathFromNames(names) : { leafId: "", path: [] });',
        'export const listDriveChildren = async (id) => (typeof M().listDriveChildren === "function" ? M().listDriveChildren(id) : []);',
        // Miroir du Drive (driveMirror.js / workspaceDrive.js) : un faux Drive
        // peut fournir dossiers et fichiers, mettre à la corbeille, renommer…
        'export const ensureLabWorkspaceFolder = async () => (typeof M().ensureLabWorkspaceFolder === "function" ? M().ensureLabWorkspaceFolder() : "ws_folder");',
        'export const findFolderByName = async (name, parent) => (typeof M().findFolderByName === "function" ? M().findFolderByName(name, parent) : "");',
        'export const findDriveFileByName = async (name, parent) => (typeof M().findDriveFileByName === "function" ? M().findDriveFileByName(name, parent) : "");',
        'export const findOrCreateFolder = async (name, parent) => (typeof M().findOrCreateFolder === "function" ? M().findOrCreateFolder(name, parent) : "");',
        'export const getDriveFileMeta = async (id) => (typeof M().getDriveFileMeta === "function" ? M().getDriveFileMeta(id) : { id: String(id || ""), name: "", trashed: false });',
        'export const trashDriveFile = async (id) => (typeof M().trashDriveFile === "function" ? M().trashDriveFile(id) : false);',
        'export const renameDriveFile = async (id, name) => (typeof M().renameDriveFile === "function" ? M().renameDriveFile(id, name) : false);',
      ].join('\n'),
    };
  }
  return next(url, context);
}
