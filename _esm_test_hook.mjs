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
        'export const sendAdminGmail = async () => ({ ok: false, reason: "bouchon de test (hors navigateur)" });',
        'export const uploadLocalFile = async () => ({ ok: false, reason: "bouchon de test (hors navigateur)" });',
        'export const cloudBackendAvailable = () => false;',
        'export const downloadDriveFileBytes = async () => { throw new Error("bouchon de test"); };',
      ].join('\n'),
    };
  }
  return next(url, context);
}
