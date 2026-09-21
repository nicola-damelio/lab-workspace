/* =========================================================================
   _viewer_render_smoke_test.mjs — LA seule suite qui EXÉCUTE un rendu.

   Les suites _viewer_*.mjs (source extrait, assertions texte) protègent ce que
   le viewer DOIT contenir ; elles ne peuvent pas voir une erreur qui n'existe
   qu'au RENDU. Le 21/09/2026 la page docking a planté en production avec

       ReferenceError: Cannot access 'En' before initialization
       at cQ (assets/auto-ML461hIB.js:74:8202)

   'En' était le nom minifié de `extraMols` : le tableau de dépendances d'un
   `useEffect` (src/components/NMRMoleculeViewer.jsx, lu PENDANT le rendu)
   citait `extraMols` alors que son `useState` était déclaré ~100 lignes plus
   bas — TDZ — donc TOUTE page ouvrant le viewer jetait, docking comprise.
   Les 8 suites statiques étaient vertes : c'est ce trou que comble ce fichier.

   Il construit _viewer_render_probe.jsx en SSR (Vite, sans minification : les
   noms de source survivent) et l'exécute dans Node ; le probe monte la page
   docking, chaque section docking, le viewer et toutes les autres pages, puis
   rend une ligne par cible. Ici on vérifie :
     • aucune cible n'a jeté (donc, en particulier, aucune TDZ au rendu) ;
     • le viewer et la page docking ont BIEN rendu du HTML (une cible muette
       serait un faux vert) ;
     • les 11 pages + les 6 sections docking sont toutes passées.
   ========================================================================= */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { build } from 'vite';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};

const ENTRY = '_viewer_render_probe.jsx';
const OUT_DIR = '_render_smoke';
const PAGES = [
  'DockingTestRenderer', 'NMRTestRenderer', 'DOSYTestRenderer', 'NMRFittingsTestRenderer',
  'CDTestRenderer', 'ssNMRTestRenderer', 'FlowCytometryTestRenderer', 'MicroscopyTestRenderer',
  'PlateTestRenderer', 'ProteinExpressionTestRenderer', 'CloningTestRenderer',
];
const SECTIONS = [
  'DockingAnalysisSection', 'DockingDataSection', 'DockingExperimentSetupSection',
  'DockingExperimentalConditions', 'DockingInstrumentalSetup', 'DockingParametersSection',
];

/* ── 1 · build SSR du probe ───────────────────────────────────────────────── */
await build({
  logLevel: 'error',
  build: { ssr: ENTRY, outDir: OUT_DIR, emptyOutDir: true, minify: false },
});
const built = `${OUT_DIR}/${ENTRY.replace(/\.jsx$/, '.js')}`;
ok(existsSync(built), `${built} doit être construit (sinon rien n'est testé)`);

/* ── 2 · exécution ────────────────────────────────────────────────────────── */
let out = '';
let exitCode = 0;
try {
  out = execFileSync(process.execPath, [built], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  exitCode = e.status === undefined ? -1 : e.status;
  out = `${e.stdout || ''}\n${e.stderr || ''}`;
}
const lines = out.split(/\r?\n/);
const rows = lines.filter((l) => /^(ok|threw)\s+\|/.test(l));
const target = (label) => rows.find((l) => l.split('|')[1].trim() === label);
const rendered = (label) => {
  const row = target(label);
  if (!row || !row.startsWith('ok')) return false;
  return Number(row.split('|')[2]) > 0;
};

/* ── 3 · le verdict ───────────────────────────────────────────────────────── */
const threw = rows.filter((l) => l.startsWith('threw'));
ok(threw.length === 0, `aucun rendu ne doit jeter —\n${threw.join('\n')}\n${lines.filter((l) => l.includes('@ ')).join('\n')}`);
ok(out.includes('RENDER PROBE OK'), `le probe doit finir sur RENDER PROBE OK (exit=${exitCode})\n${lines.slice(-6).join('\n')}`);

/* Le TDZ de la page docking : le viewer ET la page qui l'ouvre rendent du HTML. */
ok(rendered('viewer NMRMoleculeViewer'), 'le viewer 3D rend du HTML (le TDZ « extraMols » ne revient pas)');
ok(rendered('page DockingTestRenderer'), 'la page docking rend du HTML');

PAGES.forEach((p) => ok(rendered(`page ${p}`), `la page ${p} rend du HTML`));
SECTIONS.forEach((s) => ok(rendered(`section ${s}`), `la section ${s} rend du HTML`));

/* Un probe qui n'aurait plus rien monté (import cassé) ne doit pas passer pour
   un vert : le nombre de cibles rendues est vérifié lui aussi. */
ok(rows.length === PAGES.length + SECTIONS.length + 1, `les 18 cibles sont mesurées (mesurées : ${rows.length})`);

console.log(`_viewer_render_smoke_test.mjs — ${passed} assertions OK`);
