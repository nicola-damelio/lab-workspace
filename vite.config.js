import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite' // <-- AGGIUNTO
import { execSync } from 'child_process'

// Short git hash of the deployed build — shown in the sidebar so you can
// confirm the deployed version matches the latest commit on GitHub.
const appCommit = (() => {
  // Local build (and any machine with the repository): ask git.
  try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* pas de .git */ }
  // Build made by the hosting platform (no git binary / shallow checkout): the
  // platform hands the commit over as an environment variable. Without this the
  // sidebar would print "dev" and there would be no way to confirm WHICH page is
  // online — the check that matters before closing the tap (MIN_APP_BUILD_AT).
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || '';
  return sha ? sha.slice(0, 7) : 'dev';
})();

// Age of THIS build (ms since epoch): sent with every login so the token server
// can refuse a page older than its MIN_APP_BUILD_AT (see server/token-server.js).
const appBuildAt = Date.now();

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(), // <-- AGGIUNTO
  ],
  define: {
    __APP_COMMIT__: JSON.stringify(appCommit),
    // ÂGE DE CE BUILD (ms depuis l'epoch) — figé ici, à la compilation. Il part
    // avec chaque connexion (voir src/utils/labAuth.js) et permet au serveur de
    // jetons de refuser une page ANTÉRIEURE à son MIN_APP_BUILD_AT : c'est ce
    // qui ferme le robinet des pages ouvertes avant le verrou (elles
    // continuaient d'écrire après le déploiement, sans déclarer de version).
    __APP_BUILD_AT__: JSON.stringify(appBuildAt),
  },
})