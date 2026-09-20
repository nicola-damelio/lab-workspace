/* =========================================================================
   _large_system_style_test.mjs — le viewer 3D et les GRANDS SYSTÈMES.

   Ce qui est vérifié ici est ce qui doit rester vrai :

     • au-delà des seuils (25 000 atomes / 1,5 Mo de structure), le viewer passe
       en rendu « léger » : les MOLÉCULES D'EAU ne sont PAS dessinées et TOUT le
       reste est dessiné dans le style choisi dans « Large: » — lines par défaut
       (l'utilisateur voulait « tout en lines », spheres/dots en option) ;
     • ce style n'est plus appliqué qu'aux hétéro-atomes : la protéine n'est plus
       forcée en cartoon, sinon « tout en lines » ne veut rien dire ;
     • l'eau revient uniquement par la case 💧 Water (même style léger) ;
     • les seuils de bascule sont ceux annoncés par la bannière d'information.

   Le viewer est un .jsx : il ne s'importe pas sous Node. Les règles sont donc
   vérifiées SUR LA SOURCE — comme les autres garde-fous du dépôt.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};

const VIEWER = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8');
const lines = VIEWER.split(/\r?\n/);

/* ── 1. Les seuils annoncés ───────────────────────────────────────────────── */
ok(/const LARGE_ATOM_COUNT = 25000;/.test(VIEWER), '25 000 atomes : le seuil de bascule en rendu léger');
ok(/const LARGE_STRUCT_BYTES = 1\.5 \* 1024 \* 1024;/.test(VIEWER), '1,5 Mo de structure : l’autre seuil de bascule');

/* ── 2. Le bloc « grand système » de addDefaultReps ───────────────────────── */
// Le bloc complet, du test du mode léger jusqu'au retour anticipé.
const start = lines.findIndex((l) => l.includes('if (lightRenderRef.current) {'));
ok(start > 0, 'addDefaultReps a bien un bloc dédié au rendu léger');
const block = lines.slice(start, start + 12).join('\n');
ok(/const ls = largeStyleRef\.current \|\| 'lines';/.test(block), 'le style léger par défaut est « lines »');
ok(/const sele = showLargeWaterRef\.current \? 'all' : 'not water';/.test(block),
  'l’eau n’est dessinée que si 💧 Water est cochée (sinon la sélection est « not water »)');
ok(/addRepresentation\('line'/.test(block), 'le style « lines » existe');
ok(/addRepresentation\('spacefill'/.test(block), 'le style « spheres » existe');
ok(/addRepresentation\('dot'/.test(block), 'le style « dots » existe');
ok(!/addRepresentation\('cartoon'/.test(block),
  'la protéine n’est PLUS forcée en cartoon : « tout en lines » s’applique à tous les atomes');
ok(!/'hetero and not water'/.test(block),
  'le style léger ne s’applique plus aux seuls hétéro-atomes mais à tout le système');
ok(/sele, colorScheme: 'element'/.test(block), 'la même sélection sert pour les trois styles');
ok(/catch \{ \/\* lightweight style best-effort \*\/ \}/.test(block), 'l’ajout de représentation reste protégé');

/* ── 3. Le style léger est celui du menu « Large: » ───────────────────────── */
ok(/const \[largeStyle, setLargeStyle\] = useState\('lines'\);/.test(VIEWER), 'le menu « Large: » démarre sur Lines');
ok(/const largeStyleRef = useRef\('lines'\);/.test(VIEWER), 'la référence synchrone démarre aussi sur Lines');
ok(/<option value="lines">Large: Lines \(all atoms\)<\/option>/.test(VIEWER), 'le menu propose Lines pour tous les atomes');
ok(/<option value="spheres">Large: Spheres<\/option>/.test(VIEWER), 'le menu propose Spheres');
ok(/<option value="dots">Large: Dots \(lightest\)<\/option>/.test(VIEWER), 'le menu propose Dots (le plus léger)');
ok(/\[lightRender, largeStyle, showLargeWater, status\]/.test(VIEWER),
  'changer de style léger (ou cocher l’eau) reconstruit les représentations');

/* ── 4. La bannière dit la vérité ────────────────────────────────────────── */
const banner = lines.find((l) => l.includes('Large structure{lightInfo.nAtoms'));
ok(!!banner, 'la bannière « Large structure » existe');
ok(/every atom is drawn in/.test(banner), 'elle annonce le style de TOUS les atomes');
ok(/water is not drawn, tick 💧 Water to show it/.test(banner), 'elle annonce que l’eau n’est pas dessinée');
ok(!/protein cartoon/.test(banner), 'elle ne promet plus une protéine en cartoon');

/* ── Bilan ────────────────────────────────────────────────────────────────── */
console.log(`_large_system_style_test.mjs — ${passed} assertions OK`);
