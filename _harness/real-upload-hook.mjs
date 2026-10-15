/* =========================================================================
   _harness/real-upload-hook.mjs — LE CROCHET ESM DE L'HARNESS, qui charge les
   modules de src/ TELS QUELS.

   Pourquoi il existe (et pourquoi il ne se confond pas avec
   `_esm_test_hook.mjs`) :
     • `_esm_test_hook.mjs` REMPLACE src/utils/driveUpload.js par un bouchon :
       très bien pour les suites qui n'ont pas besoin du vrai Drive, mais alors
       les requêtes (`q`, `pageSize`, `pageToken`, reprise 401, retry) ne sont
       plus exécutées — elles sont SIMULÉES par le bouchon ;
     • la FASE 0 doit prouver ce que l'app fait VRAIMENT sur le Drive : ce
       crochet-ci résout les imports sans extension (comme Vite) et ne
       remplace RIEN. Le code réel tourne donc sur le faux Drive
       (_harness/fake-drive.mjs), branché sur `globalThis.fetch`.
     • le drapeau global ne pouvait pas servir : `module.register()` exécute les
       crochets SUR UN AUTRE FIL, où `globalThis` n'est pas celui du test. Un
       crochet dédié est la seule façon fiable — et il laisse
       `_esm_test_hook.mjs` intact pour toutes les suites existantes.
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
    } catch { /* la résolution standard expliquera l'erreur */ }
  }
  return next(specifier, context);
}

/* AUCUN `load` : src/utils/driveUpload.js se charge TEL QUEL. */
