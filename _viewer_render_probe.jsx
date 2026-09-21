/* =========================================================================
   _viewer_render_probe.jsx — RENDU RÉEL (SSR dans Node) du viewer et des pages.

   Les suites _viewer_*.mjs LISENT le source : elles attrapent une consigne
   perdue, jamais une erreur qui n'existe qu'à l'EXÉCUTION. Constat du jour où
   la page docking a planté (« Cannot access 'En' before initialization » dans le
   bundle minifié) : un `useEffect` lisait `extraMols` dans son TABLEAU DE
   DÉPENDANCES — une lecture faite PENDANT le rendu — alors que le
   `const [extraMols, setExtraMols] = useState([])` était déclaré plus bas : le
   binding était encore dans sa zone morte (TDZ) et TOUTE page ouvrant le viewer
   jetait. Aucune suite statique ne pouvait le voir ; ce fichier monte vraiment
   l'arbre dans Node (react-dom/server exécute les corps de composants) : une
   erreur de rendu sort ici AVEC SON NOM DE SOURCE, jamais avec le nom minifié
   du bundle déployé.

   Sortie — une ligne par cible :
       ok    | <label> | <longueur du HTML rendu>
       threw | <label> | <message>
         @ <ligne de pile>
   Code de sortie : 1 dès qu'une cible a jeté.
   Lancé par _viewer_render_smoke_test.mjs (build SSR puis exécution).
   La sortie est ÉCRITE SYNCHRONEMENT (fs.writeSync sur fd 1) et le process se
   termine par process.exit : un handle asynchrone laissé ouvert par un module
   (polling, fetch) ne doit pas transformer une exécution réussie en blocage.
   ========================================================================= */
import { writeSync } from 'node:fs';

/* ── Globals navigateur ────────────────────────────────────────────────────
   Le graphe de la page docking touche window/document DÈS L'ÉVALUATION du
   module (NMRSections.jsx appelle loadRDKitScript() en haut de fichier, et cet
   appel lit window.__RDKit · document.createElement) : sans ces bouchons le
   module n'arrive même pas à se charger dans Node et l'on testerait le mauvais
   échec. Ils ne servent QU'À ça — aucun rendu ne doit en dépendre. */
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

const noop = () => {};
/* TestHeader est un ÉLÉMENT JSX chez l'appelant (activeTestModule le construit
   comme <div>) et le shell le rend tel quel : `{TestHeader}`. Lui passer une
   FONCTION ferait cracher React (« Functions are not valid as a React child »). */
const TestHeader = React.createElement('div', { 'data-probe': 'header' }, 'probe');
const activeTest = {
  id: 'probe', type: 'docking', name: 'Render probe', date: '2026-01-01',
  values: {}, data: {}, images: [], categories: [], protocolIds: [],
  dockingImages: [], custom: {}, samples: {},
};
const pageProps = {
  activeTest, updateActiveTest: noop, allTests: [], TestHeader,
  datasetProtocols: [], jumpToProtocol: noop, allCmpds: [], allCellLines: [],
  customFields: [], testCategories: [], operators: [], instances: [],
  solvents: [], buffers: [], additives: [], mandatoryRules: [], mandatoryBehavior: {},
};

let failed = 0;
const out = [];
const say = (line) => out.push(line);
const render = (label, element) => {
  try {
    say(`ok    | ${label} | ${renderToString(element).length}`);
  } catch (e) {
    failed += 1;
    say(`threw | ${label} | ${e && e.message}`);
    String((e && e.stack) || '').split('\n').slice(1, 4)
      .forEach((line) => say(`        @ ${line.trim()}`));
  }
};

/* 1 · la page docking entière (sa coquille et tout ce qu'elle monte d'emblée) */
render('page DockingTestRenderer', React.createElement(
  (await import('./src/components/DockingTestRenderer.jsx')).default, pageProps
));

/* 2 · chaque section docking rendue SEULE (la coquille garde les autres fermées) */
const docking = await import('./src/components/DockingSections.jsx');
const ctx = {
  activeTest, compoundMeta: {}, updateActiveTest: noop, allCmpds: [], allCellLines: [],
  customFields: [], testCategories: [], instance: '', instanceName: '', allTests: [],
  solvents: [], buffers: [], additives: [], data: {}, values: {},
};
for (const [name, Comp] of Object.entries(docking)) {
  if (typeof Comp === 'function' && /^Docking/.test(name)) {
    render(`section ${name}`, React.createElement(Comp, { ctx }));
  }
}

/* 3 · le viewer 3D lui-même — c'est là qu'était le TDZ */
render('viewer NMRMoleculeViewer', React.createElement(
  (await import('./src/components/NMRMoleculeViewer.jsx')).default,
  {
    src: null, structureText: null, moleculeType: 'protein', height: '520px',
    onStructureFile: noop, onStructureSrc: noop, onTrajectoryFile: noop,
  }
));

/* 4 · toutes les autres pages (une coquille par type d'expérience) */
for (const name of [
  'NMRTestRenderer', 'DOSYTestRenderer', 'NMRFittingsTestRenderer', 'CDTestRenderer',
  'ssNMRTestRenderer', 'FlowCytometryTestRenderer', 'MicroscopyTestRenderer',
  'PlateTestRenderer', 'ProteinExpressionTestRenderer', 'CloningTestRenderer',
]) {
  render(`page ${name}`, React.createElement(
    (await import(`./src/components/${name}.jsx`)).default, pageProps
  ));
}

say(failed === 0 ? 'RENDER PROBE OK' : `RENDER PROBE FAILED (${failed})`);
writeSync(1, `${out.join('\n')}\n`);   // synchrone : rien ne peut être tronqué
process.exit(failed === 0 ? 0 : 1);    // un handle resté ouvert ne bloque pas la suite
