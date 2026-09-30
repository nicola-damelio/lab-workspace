import react from '@vitejs/plugin-react';
export default {
  plugins: [react()],
  logLevel: 'error',
  build: {
    ssr: '.tmp_persist/harness.mjs',
    outDir: '.tmp_persist/out',
    emptyOutDir: true,
    minify: false,
    target: 'node20',
    rollupOptions: { output: { format: 'es', entryFileNames: 'harness.mjs' } }
  }
};