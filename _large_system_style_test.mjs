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
     • ce rendu léger n'est qu'un POINT DE DÉPART : le premier geste de style
       dans « 2 · Molecular Styling » (menu de catégorie, chaînes latérales,
       pastille de couleur, styles de rôle du docking) appelle leaveLightMode()
       et le système est redessiné avec les représentations par catégorie. Les
       menus ne sont donc JAMAIS ignorés — sans bouton « ✨ Full detail » ;
     • la bannière « ℹ️ Large structure (… atoms): every atom is drawn in … » a
       DISPARU de l'écran : l'information ne vit plus que dans l'infobulle de la
       ligne §2 → F · Others « Large system », qui décrit le départ, pas un
       verrou.

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

/* ── 4. Plus de bannière : un grand système ne se bloque plus ─────────────── */
// L'utilisateur ne veut plus voir « ℹ️ Large structure (40 504 atoms): every
// atom is drawn in lines — water is not drawn, tick 💧 Water… » : la bannière
// est supprimée, et elle n'a plus de raison d'être puisqu'il n'y a plus rien à
// débloquer à la main (voir §5).
const gone = (needle, what) => ok(!VIEWER.includes(needle), `${what}\n  encore présent : ${needle}`);
gone('Large structure{lightInfo.nAtoms', 'la bannière « Large structure » n’est plus rendue');
gone('ℹ️ Large structure', '…ni son texte d’information en haut de la fenêtre');
gone('tick 💧 Water to show it', '…ni la consigne « tick 💧 Water to show it »');
// L'information n'est pas perdue : elle passe dans l'infobulle de la ligne §2.
ok(VIEWER.includes('lightInfo && lightInfo.nAtoms'), 'le nombre d’atomes reste dit (infobulle de la ligne « Large system »)');

/* ── 5. Le premier geste de style quitte le rendu léger ───────────────────── */
// C'EST LE CŒUR DU CORRECTIF : sans bouton « ✨ Full detail », les menus de §2
// n'avaient plus aucun effet sur un grand système (addDefaultReps sortait sur le
// bloc léger). Chaque commande de style appelle donc leaveLightMode().
const styleHook = (anchor, span) => {
  const i = lines.findIndex((l) => l.includes(anchor));
  return i < 0 ? '' : lines.slice(i, i + span).join('\n');
};
const leaveBlock = styleHook('const leaveLightMode = () => {', 5);
ok(!!leaveBlock, 'leaveLightMode existe (le geste de style fait la bascule)');
ok(/if \(!lightRenderRef\.current\) return;/.test(leaveBlock),
  'la bascule ne coûte rien quand le système est déjà dessiné normalement');
ok(/lightRenderRef\.current = false;/.test(leaveBlock),
  'la référence synchrone passe à false AVANT le rebuild (addDefaultReps la lit)');
ok(/setLightRender\(false\);/.test(leaveBlock),
  '…et l’état suit, ce qui déclenche le rebuild du rendu principal');
// Aucune commande de style ne doit oublier la bascule.
ok(styleHook('const setCatStyle = (cat, key, value) => {', 3).includes('leaveLightMode();'),
  'les SIX menus de catégorie (setCatStyle) sortent du rendu léger');
ok(styleHook('const setSurfaceColor = (cat, value) => {', 3).includes('leaveLightMode();'),
  'la couleur de surface (ESP) aussi');
ok(VIEWER.includes('{ leaveLightMode(); setSidechainStyle(e.target.value); }'),
  'le sélecteur de chaînes latérales aussi');
// Les pastilles de 2° structure passent par setSstrucColour, qui appelle
// leaveLightMode() lui-même (il change ce qui est DESSINÉ, pas seulement une
// couleur) : les trois pastilles du panneau + les deux boutons de ↺.
eq((VIEWER.match(/const setSstrucColour = \(key, hex\) => \{/g) || []).length, 1,
  'les couleurs de 2° structure s’écrivent par UN seul helper');
eq((VIEWER.match(/leaveLightMode\(\);   \/\/ it changes what is drawn/g) || []).length, 1,
  '…et ce helper sort du rendu léger avant d’écrire la couleur');
eq((VIEWER.match(/setSstrucColour\('/g) || []).length, 3,
  'les trois pastilles de couleur 2° structure l’utilisent');
const iReset = lines.findIndex((l) => l.includes('setSstrucColors({ helix: 0xb44a90, sheet: 0xf8d878, loop: 0xe6e6e6 });'));
ok(iReset > 0 && lines[iReset - 1].includes('leaveLightMode();'), 'le bouton ↺ Reset defaults aussi');
ok(styleHook('const applyDockStylesNow = () => {', 5).includes('leaveLightMode();'),
  'les styles de rôle du docking aussi');
// Le rendu léger reste le POINT DE DÉPART (et le bloc d’addDefaultReps est intact).
ok(styleHook('if (lightRenderRef.current) {', 12).includes("addRepresentation('line'"),
  'addDefaultReps garde son bloc léger : rien ne change au chargement d’un grand système');
// La ligne §2 dit qu’elle décrit le départ, pas un verrou.
ok(VIEWER.includes('It is only the STARTING view'),
  'la ligne §2 → F · Others annonce que le rendu léger n’est qu’un départ');

/* ── Bilan ────────────────────────────────────────────────────────────────── */
console.log(`_large_system_style_test.mjs — ${passed} assertions OK`);
