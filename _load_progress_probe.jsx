/* =========================================================================
   _load_progress_probe.jsx — LA BARRE DE CHARGEMENT RENDUE POUR DE VRAI.

   _load_progress_bar_test.mjs vérifie le magasin et le câblage ; ce fichier
   comble le trou habituel : une consigne peut être écrite dans le JSX et ne
   rien donner à l'écran. Ici react-dom/server monte GlobalLoadProgress dans
   Node, dans chacun des états qu'elle doit distinguer :

     · idle          — rien ne tourne : la barre ne doit RIEN dessiner (c'est
                       exactement ce qui remplace le message d'arrêt permanent) ;
     · counted       — une opération qui compte (3 molécules sur 7) : le
                       pourcentage ET la largeur remplie viennent de ces compteurs ;
     · unknown       — la même opération avant tout compteur : le remplissage
                       PULSE, aucune largeur fausse, aucun pourcentage ;
     · registry-only — une opération seulement déclarée dans abortControl (une
                       analyse MD, sans progression) : elle s'annonce et reste
                       donc arrêtable ;
     · idle-again    — tout est fini : plus rien, à nouveau.

   Une ligne par état : `<état> | <html>` ; « (nothing) » quand le composant ne
   rend rien. Écriture SYNCHRONE puis process.exit, comme le probe de rendu du
   viewer (un handle resté ouvert ne doit pas bloquer la suite).
   ========================================================================= */
import { writeSync } from 'node:fs';

/* Globals navigateur : TestShellRenderer tire RichTextEditor, DriveUpload,
   ChartStarLayer… dont certains touchent window/document à l'évaluation. */
const stubEl = () => ({
  style: {}, setAttribute() {}, appendChild() {}, removeChild() {},
  addEventListener() {}, removeEventListener() {}, getContext: () => null,
  getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0 }),
});
const setGlobal = (key, value) => { try { globalThis[key] = value; } catch { /* getter seul */ } };
setGlobal('window', globalThis);
setGlobal('document', {
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: stubEl, createElementNS: stubEl, createTextNode: () => ({}),
  head: stubEl(), body: stubEl(), documentElement: stubEl(),
  addEventListener() {}, removeEventListener() {},
});
setGlobal('navigator', { userAgent: 'node' });
setGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
setGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
setGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
setGlobal('MutationObserver', class { observe() {} disconnect() {} takeRecords() { return []; } });
setGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
setGlobal('addEventListener', () => {});
setGlobal('removeEventListener', () => {});
setGlobal('dispatchEvent', () => true);
setGlobal('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 0));
setGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
setGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
setGlobal('location', { href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:', search: '', hash: '', host: 'localhost', pathname: '/' });
setGlobal('devicePixelRatio', 1);
setGlobal('innerWidth', 1280);
setGlobal('innerHeight', 800);

const React = (await import('react')).default;
const { renderToString } = await import('react-dom/server');
const { GlobalLoadProgress } = await import('./src/components/TestShellRenderer.jsx');
const { loadProgress } = await import('./src/utils/loadProgress.js');
const { abortControl } = await import('./src/utils/abortControl.js');

let failed = 0;
const out = [];
const shot = (state) => {
  try {
    const html = renderToString(React.createElement(GlobalLoadProgress));
    // Le HTML d'un composant qui ne rend rien est une chaîne vide. React insère
    // des `<!-- -->` entre deux nœuds texte : on les retire avant d'aplatir,
    // sinon « 43 % » se lit « 43<!-- --> % ».
    const flat = html.replace(/<!--\s*-->/g, '').replace(/\s+/g, ' ').replace(/></g, '> <').trim();
    out.push(`${state} | ${flat || '(nothing)'}`);
  } catch (e) {
    failed += 1;
    out.push(`${state} | THREW ${e && e.message}`);
  }
};

/* 1 · page au repos : rien ne doit être dessiné. */
shot('idle');

/* 2 · une STRUCTURE qui charge et qui compte : 3 molécules sur 7. */
const rep = loadProgress.begin('structure loading');
rep.step(3, 7, 'Loading the molecules…');
shot('counted');

/* 3 · la même, avant tout compteur (le fichier est en cours de lecture). */
rep.phase('Reading the file…');
shot('unknown');

/* 4 · une opération qui ne rapporte AUCUNE progression (analyse MD). */
rep.end();
const stop = abortControl.register('Calculate all analyses', () => {});
shot('registry-only');
stop();

/* 5 · tout est terminé : plus rien, à nouveau. */
shot('idle-again');

out.push(failed === 0 ? 'PROGRESS PROBE OK' : `PROGRESS PROBE FAILED (${failed})`);
writeSync(1, `${out.join('\n')}\n`);   // synchrone : rien ne peut être tronqué
process.exit(failed === 0 ? 0 : 1);    // un handle resté ouvert ne bloque pas la suite
