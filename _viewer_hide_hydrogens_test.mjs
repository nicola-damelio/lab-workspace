/* =========================================================================
   _viewer_hide_hydrogens_test.mjs — LE TICK « HIDE ALL HYDROGENS » DE LA FENÊTRE DE
   STYLING.

   La demande de cette session, mot pour mot : « In the styling window add a tick
   allowing to hide all hydrogens in all molecules. »

   Deux moitiés, mesurées séparément :
     · LA CLAUSE — `not hydrogen`, et le mot-clé `hydrogen` est VÉRIFIÉ sur le paquet
       NGL installé (un proxy d'atome d'hydrogène, un de carbone) : ce n'est pas une
       impression, c'est la réponse du moteur que le viewer utilise (voir
       src/utils/viewerHydrogenFilter.js) ;
     · LE BRANCHEMENT — le tick est un état persisté, il entre dans styleSignature (donc
       la scène se reconstruit), et la clause est ajoutée au SEUL endroit qui fabrique
       les représentations de toutes les molécules (buildSectionReps), drapeau passé par
       rebuildSectionsOf / addDefaultReps — sans quoi « in all molecules » serait faux.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HYDROGEN_SELECTION, HIDDEN_HYDROGEN_SELECTION, withoutHydrogensSele, withoutHydrogensParams,
} from './src/utils/viewerHydrogenFilter.js';

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => { assert.deepEqual(a, b, what); passed += 1; };
const VIEW = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => {
  assert.ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
  passed += 1;
};

/* ── 1. LA CLAUSE ─────────────────────────────────────────────────────────── */
eq(HYDROGEN_SELECTION, 'hydrogen', 'le mot-clé d’hydrogène du module');
eq(HIDDEN_HYDROGEN_SELECTION, 'not hydrogen', 'la clause qui les retire');
eq(withoutHydrogensSele(''), 'not hydrogen', 'une sélection vide devient la clause seule');
eq(withoutHydrogensSele('   '), 'not hydrogen', '…et une sélection blanche aussi');
eq(withoutHydrogensSele('all'), 'not hydrogen', '« all » devient la clause seule (forme courte)');
eq(withoutHydrogensSele('resn POPC'), '(resn POPC) and not hydrogen',
  'une expression de rangée est GARDÉE entre parenthèses (sinon un `or` changerait de sens)');
eq(withoutHydrogensSele('upper_leaflet or lower_leaflet'),
  '(upper_leaflet or lower_leaflet) and not hydrogen',
  '…c’est exactement ce qui protège les rangées de membrane');

/* Les paramètres : un NOUVEL objet, l’origine jamais touchée. */
const row = { sele: 'resn POPC', colorScheme: 'element', opacity: 0.8 };
const off = withoutHydrogensParams(row, false);
ok(off === row, 'tick décoché : les paramètres passent TELS QUELS (aucune copie)');
const on = withoutHydrogensParams(row, true);

/* ── 2. LE MOT-CLÉ EST VÉRIFIÉ SUR LE NGL INSTALLÉ ────────────────────────── */
let mod = null;
for (const t of ['ngl', 'ngl/dist/ngl.esm.js', 'ngl/dist/ngl.js']) {
  try { mod = await import(t); break; } catch { /* essai suivant */ }
}
const NGL = (mod && mod.Selection) ? mod : (mod && mod.default ? mod.default : mod);
assert.ok(NGL && NGL.Selection, 'ngl est installé (le viewer charge ce moteur)');
const base = { atomname: 'HB2', resname: 'LEU', resno: 1, chainname: 'A', chainid: 0, index: 0, sstruc: '', altloc: '' };
const hydrogen = { ...base, element: 'H' };
const carbon = { ...base, element: 'C', atomname: 'CB' };
const clause = new NGL.Selection(HIDDEN_HYDROGEN_SELECTION);
eq(clause.test(hydrogen), false, 'NGL : `not hydrogen` écarte bien un hydrogène');
eq(clause.test(carbon), true, '…et garde bien un carbone');
const plain = new NGL.Selection(HYDROGEN_SELECTION);
eq(plain.test(hydrogen), true, 'NGL : `hydrogen` désigne bien l’hydrogène');
eq(plain.test(carbon), false, '…et pas le carbone');
/* Le piège, gardé comme garde-fou : `.H` n’écarte PAS les hydrogènes nommés. */
const trap = new NGL.Selection('(all) and not .H');
eq(trap.test(hydrogen), true, '`.H` ne filtre PAS les hydrogènes (HB2 survit) — d’où la clause mesurée');

/* ── 3. LE BRANCHEMENT DANS LE VIEWER ─────────────────────────────────────── */
has("import { withoutHydrogensParams } from '../utils/viewerHydrogenFilter';",
  'le viewer importe la clause de son propre module');
has('const [hideHydrogens, setHideHydrogens] = useState(() => {', 'le tick est un état du viewer');
has("localStorage.getItem('labViewerHideHydrogens') === 'on'", '…relu au montage (persisté)');
has("localStorage.setItem('labViewerHideHydrogens', hideHydrogens ? 'on' : 'off')", '…et réécrit à chaque geste');
has('const hideHydrogensRef = useRef(hideHydrogens);', 'le constructeur le lit par une RÉFÉRENCE (hors rendu)');
has("|H:${hideHydrogens ? 'off' : 'on'}", 'le tick entre dans styleSignature (la scène se reconstruit)');
has('const hideHydrogens = opts.hideHydrogens === true;', 'buildSectionReps le reçoit par ses options');
has('r = comp.addRepresentation(type, withoutHydrogensParams(params, hideHydrogens));',
  '…et l’applique à CHAQUE représentation qu’il crée (toutes les molécules)');
has('hideHydrogens: hideHydrogensRef.current === true,', 'rebuildSectionsOf le passe au constructeur');
has("withoutHydrogensParams({ sele, colorScheme: 'element', ...extra }, hideHydrogensRef.current === true)",
  'l’affichage allégé d’un grand système l’applique aussi (« in all molecules »)');
has('title="Hide every hydrogen of EVERY molecule shown here',
  'le tick se nomme et dit sa portée');
has('checked={hideHydrogens} onChange={(e) => setHideHydrogens(e.target.checked)}',
  '…et c’est bien une case à cocher de la fenêtre de styling');

console.log(`_viewer_hide_hydrogens_test.mjs — ${passed} assertions OK (clause mesurée sur NGL · tick branché sur toutes les molécules)`);

ok(on !== row, 'tick coché : les paramètres sont COPIÉS (la rangée partagée ne bouge pas)');
eq(on.sele, '(resn POPC) and not hydrogen', '…avec la clause ajoutée');
eq(row.sele, 'resn POPC', '…et la rangée d’origine intacte');
eq(on.opacity, 0.8, '…tous les autres champs conservés');
eq(withoutHydrogensParams({}, true).sele, 'not hydrogen',
  'une représentation sans sélection reçoit la clause seule');
