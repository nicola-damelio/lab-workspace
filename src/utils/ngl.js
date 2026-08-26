/* =========================================================================
   src/utils/ngl.js
   Shared NGL (3D molecular viewer) loader.

   Used by NMRMoleculeViewer.jsx and MDTrajectoryFrames.js. Loads NGL from a
   CDN once and caches the promise so every consumer shares a single script
   load and resolves to the same window.NGL instance.
   ========================================================================= */

let _nglPromise = null;
const NGL_CDN_URLS = [
  'https://unpkg.com/ngl@2.4.0/dist/ngl.js',
  'https://cdn.jsdelivr.net/npm/ngl@2.4.0/dist/ngl.js',
];

export const ensureNGL = () => {
  if (typeof window !== 'undefined' && window.NGL) return Promise.resolve(window.NGL);
  if (_nglPromise) return _nglPromise;
  _nglPromise = new Promise((resolve, reject) => {
    let idx = 0;
    const tryNext = () => {
      if (idx >= NGL_CDN_URLS.length) {
        _nglPromise = null;
        reject(new Error('Could not load NGL from any CDN (unpkg / jsdelivr).'));
        return;
      }
      const script = document.createElement('script');
      script.src = NGL_CDN_URLS[idx++];
      script.async = true;
      script.onload = () => (window.NGL ? resolve(window.NGL) : tryNext());
      script.onerror = () => tryNext();
      document.head.appendChild(script);
    };
    tryNext();
  });
  return _nglPromise;
};
