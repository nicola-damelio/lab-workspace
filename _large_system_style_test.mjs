/* =========================================================================
   _large_system_style_test.mjs — le viewer 3D et les GRANDS SYSTÈMES.

   Ce qui est vérifié ici est ce qui doit rester vrai :

     • au-delà des seuils (25 000 atomes / 1,5 Mo de structure), le viewer ouvre
       le système en rendu « léger » : les MOLÉCULES D'EAU ne sont PAS dessinées et
       TOUT le reste est dessiné dans le style léger — lines par défaut
       (l'utilisateur voulait « tout en lines », spheres/dots en option) ;
     • ce style n'est plus appliqué qu'aux hétéro-atomes : la protéine n'est plus
       forcée en cartoon, sinon « tout en lines » ne veut rien dire ;
     • l'eau ne revient que par la case 💧 Water (même style léger) — mais les deux
       réglages (style · eau) n'ont plus de menu à eux : les seuls qui les relisent
       sont un setup enregistré, et le rendu léger n'est qu'un DÉPART ;
     • ce rendu léger n'est qu'un POINT DE DÉPART : le premier geste de style dans
       la barre « Molecules · styling » (un menu de rangée, un ↺, le ✔ d'une
       molécule) appelle leaveLightMode() et le système est redessiné par ses
       SECTIONS. Les rangées ne sont donc JAMAIS ignorées — sans bouton
       « ✨ Full detail » ;
     • la bannière « ℹ️ Large structure (… atoms): every atom is drawn in … » a
       DISPARU de l'écran, et la ligne §2 → F · Others « Large system » avec elle :
       il n'y a plus rien à débloquer à la main, et le compte d'atomes mesuré
       (lightInfo) n'est plus affiché nulle part.

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
const gone = (needle, what) => ok(!VIEWER.includes(needle), `${what}\n  encore présent : ${needle}`);

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
ok(/const \[largeStyle, setLargeStyle\] = useState\('lines'\);/.test(VIEWER), 'le style léger de départ est Lines');
ok(/const largeStyleRef = useRef\('lines'\);/.test(VIEWER), 'la référence synchrone démarre aussi sur Lines');
// Le menu « Large: » (et sa case 💧 Water, dans le menu F · Others) a disparu avec
// les six menus de catégorie : le style de départ n'est plus un réglage d'écran.
// Aucune capacité de dessin n'est perdue pour autant — les trois styles sont
// toujours implémentés dans addDefaultReps (§2), et un setup enregistré reste le
// seul endroit qui relise le style choisi autrefois.
gone('<option value="lines">Large: Lines (all atoms)</option>', 'plus de menu « Large: Lines »');
gone('<option value="spheres">Large: Spheres</option>', '…ni « Large: Spheres »');
gone('<option value="dots">Large: Dots (lightest)</option>', '…ni « Large: Dots »');
ok(/if \(typeof lg\.style === 'string'\) setLargeStyle\(lg\.style\);/.test(VIEWER),
  'le style de départ se relit d’un setup enregistré (plus aucun menu ne l’écrit)');
ok(/\[lightRender, largeStyle, showLargeWater, status\]/.test(VIEWER),
  'changer de style léger (ou cocher l’eau) reconstruit les représentations');

/* ── 4. Plus de bannière : un grand système ne se bloque plus ─────────────── */
// L'utilisateur ne veut plus voir « ℹ️ Large structure (40 504 atoms): every
// atom is drawn in lines — water is not drawn, tick 💧 Water… » : la bannière
// est supprimée, et elle n'a plus de raison d'être puisqu'il n'y a plus rien à
// débloquer à la main (voir §5).
gone('Large structure{lightInfo.nAtoms', 'la bannière « Large structure » n’est plus rendue');
gone('ℹ️ Large structure', '…ni son texte d’information en haut de la fenêtre');
gone('tick 💧 Water to show it', '…ni la consigne « tick 💧 Water to show it »');
// L'information n'est pas perdue : le compte d'atomes reste MESURÉ (lightInfo) —
// c'est la ligne « Large system » qui n'existe plus, donc plus aucune infobulle
// ne l'affiche.
ok(/setLightInfo\(\{ nAtoms, size:/.test(VIEWER), 'le compte d’atomes du grand système reste mesuré');
gone('lightInfo && lightInfo.nAtoms', '…mais plus aucune infobulle de ligne « Large system » ne l’affiche');

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
// Aucune commande de style ne doit oublier la bascule. Ce sont les gestes de la
// barre « Molecules · styling » : les six menus de catégorie de §2 (et leurs
// sélecteurs globaux de chaînes latérales / de couleur de surface) ont disparu,
// chaque partie d'une molécule a sa RANGÉE.
ok(styleHook('const setSectionField = (id, kind, sub, field, value) => {', 3).includes('leaveLightMode();'),
  'un menu de rangée (style · Color by · rayons · matériau) sort du rendu léger');
ok(styleHook('const resetSectionRowLook = (id, kind, sub) => {', 3).includes('leaveLightMode();'),
  '…le ↺ d’une rangée aussi');
ok(styleHook('const resetSectionKindLook = (id, kind) => {', 3).includes('leaveLightMode();'),
  '…et le ↺ d’une molécule entière');
ok(styleHook('const toggleSectionVisible = (id, kind) => {', 3).includes('leaveLightMode();'),
  '…et le ✔ qui dessine ou cache une molécule');
gone('{ leaveLightMode(); setSidechainStyle(e.target.value); }',
  'il n’y a plus de sélecteur GLOBAL de chaînes latérales : la rangée « Side chains » le remplace');
// Les pastilles de 2° structure passent par setSstrucColour, qui appelle
// leaveLightMode() lui-même (il change ce qui est DESSINÉ, pas seulement une
// couleur) : la palette apparaît dans la rangée dès que « Secondary structure »
// est choisi.
eq((VIEWER.match(/const setSstrucColour = \(key, hex\) => \{/g) || []).length, 1,
  'les couleurs de 2° structure s’écrivent par UN seul helper');
eq((VIEWER.match(/leaveLightMode\(\);   \/\/ it changes what is drawn/g) || []).length, 1,
  '…et ce helper sort du rendu léger avant d’écrire la couleur');
ok(VIEWER.includes('the 2°-structure palette (helix · sheet · loop) every molecule coloured by « Secondary structure » reads'),
  'la rangée « Secondary structure » écrit ces trois couleurs par ce même helper');
// Le ↺ de la section 2° structure du ⚙ remet la PALETTE à ses défauts : c'est une
// palette (le schéma la lit en direct, rien n'est reconstruit), pas un choix de
// dessin — elle n'a donc pas à quitter le rendu léger.
ok(VIEWER.includes('onClick={() => setSstrucColors({ ...SSTRUC_COLOR_DEFAULTS })}'),
  'le ↺ de la section 2° structure du ⚙ remet les trois couleurs à leurs défauts');
ok(VIEWER.includes('const SSTRUC_COLOR_DEFAULTS = { ...sstrucColorStore };'),
  '…et ces défauts sont ceux du store que le schéma lit');
// La barre « Molecules · styling » a remplacé le mode de docking : c'est elle qui
// porte les gestes de style par molécule (voir _dock_style_test.mjs).
ok(VIEWER.includes('{(entry.sections || []).map((sec) => renderSection(sec))}'),
  'la barre rend les rangées de chaque molécule (la principale comprise)');
// Le rendu léger reste le POINT DE DÉPART (et le bloc d’addDefaultReps est intact).
ok(styleHook('if (lightRenderRef.current) {', 12).includes("addRepresentation('line'"),
  'addDefaultReps garde son bloc léger : rien ne change au chargement d’un grand système');
// Il n'y a plus de ligne « Large system » pour l'annoncer… mais le CODE dit ce
// qu'elle disait : le bloc léger décrit un départ, pas un verrou.
gone('It is only the STARTING view', 'plus de ligne « Large system » à qui l’annoncer');
ok(VIEWER.includes('This block is only the STARTING layout'),
  '…l’intention est écrite dans le code : le bloc léger n’est qu’un DÉPART');

/* ── Bilan ────────────────────────────────────────────────────────────────── */
console.log(`_large_system_style_test.mjs — ${passed} assertions OK`);
