import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite' // <-- AGGIUNTO
import { execSync } from 'child_process'

// Short git hash of the deployed build — shown in the sidebar so you can
// confirm the deployed version matches the latest commit on GitHub.
const appCommit = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; }
})();

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(), // <-- AGGIUNTO
  ],
  define: {
    __APP_COMMIT__: JSON.stringify(appCommit),
  },
})