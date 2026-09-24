/* =========================================================================
   _viewer_membrane_rows_test.mjs — LES FEUILLETS DANS L'ESPACE PHOSPHOLIPIDES,
   et les DEUX BARRES avec les MÊMES commandes.

   Les deux demandes, mot pour mot :

     « upper leaflet and lower leaflet ticks should not be located in the section
       membrane inside the left window. they should appear in the phospholipid
       space of the styling window so that I can change their style, lipid by
       lipid. If in the pymol macro a lipid is selected they should also be
       there. »
     « The selection window (on the left) does not still have the same appearance
       as the styling window while they should be identical in terms of commands
       (dropdown menus etc.). »

   CE QUI EST VÉRIFIÉ ICI :

    1. Les DEUX TICKS ont quitté la boîte « Membrane » de la barre de GAUCHE, qui
       ne garde que la MESURE et renvoie au styling.
    2. Ils sont devenus des RANGÉES du groupe « 🧫 Membrane · leaflets », DANS
       l'espace phospholipides de la fenêtre de styling, une seule fois par
       molécule — et la liste joint les QUATRE sélections mesurées et TOUTE
       sélection qu'un script PyMOL fait sur les lipides.
    3. Chaque rangée écrit dans le MÊME état que les ticks (`selStyles`) : ce qui
       était dessiné avant l'est encore, mais stylable sélection par sélection.
    4. Les DEUX BARRES passent par UNE SEULE implémentation des commandes
       (renderLookControls), avec les adaptateurs de chaque barre — et chacune
       garde la curation de ses propres listes (spec.styles / spec.colors d'un
       côté, SEL_ROW_STYLE_CHOICES / SEL_COLOR_MODES de l'autre).
    5. LA RÈGLE DU PROPRIÉTAIRE DES TÊTES, exécutée : un feuillet soustrait les
       atomes de ses têtes pour TOUS les styles qu'il dessine, à partir des deux
       rangées lues AU MOMENT DU RENDU (membraneHeadOwnerExprs) — donc ni l'ordre
       des clics ni le style choisi en premier ne peuvent plus laisser les têtes
       dans les sphères du feuillet (« works well only lower leaflet »).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};

const VIEW = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
const gone = (needle, what) => ok(!VIEW.includes(needle), `${what}\n  encore là   : ${needle}`);
const countOf = (re) => (VIEW.match(re) || []).length;

/* ── 1. LA BOÎTE « MEMBRANE » DE GAUCHE N'EXISTE PLUS ──────────────────── */
/* La demande : « la finestra membrane a sinistra che clippa anche senza script
   de pymol deve essere eliminata ». Elle apparaissait sur TOUT fichier contenant
   une bicouche, script ou pas, elle rognait le haut d'une barre à largeur fixe
   (le nom des fichiers du fichier de mesure en sortait), et elle répétait — en
   plus petit et non stylable — ce que le groupe 🧫 du styling dit déjà. */
gone('Styles of the leaflets:', 'plus d’encart « Styles of the leaflets » dans la barre de gauche');
gone('rounded-lg border border-teal-200 bg-teal-50/70', '…ni la boîte qui le portait');
gone('upper {membraneInfo.upperAtoms} atoms', '…ni la lecture de la mesure qui s’y trouvait');
gone("{['upper_leaflet', 'lower_leaflet'].map((n) => {", 'plus un seul tick de feuillet dans la boîte Membrane de gauche');
gone("{['upper_headgroups', 'lower_headgroups'].map((n) => {", '…ni les deux boutons de têtes de groupe');
gone('selStyles[n] && (selStyles[n].sphere || selStyles[n].ball || selStyles[n].stick)',
  '…donc plus de cochage écrit à la main dans cette boîte');
gone('|| !!membraneInfo', '…et plus aucune condition d’affichage de la barre liée à une membrane mesurée');
has('NO « MEMBRANE » BOX IN THIS BAR', 'la source dit que la boîte a été retirée (la demande)');
/* La MESURE n’est pas perdue : elle est lue en tête du groupe 🧫. Le PARAGRAPHE
   de comptes, lui, est parti avec tout le reste (la demande suivante : « remove
   all that descriptive text […], leave only the buttons »). */
has('{info.axis} · mid {info.midplane.toFixed(1)} Å · {info.thickness.toFixed(1)} Å',
  'la mesure (axe · plan médian · épaisseur) est toujours affichée, dans le groupe');
gone('upper ${info.upperAtoms} atoms / ${info.upperResidues} lipids / lower',
  '…sans le paragraphe de comptes de l’ancienne boîte');

/* ── 2. LES RANGÉES VIVENT DANS L'ESPACE PHOSPHOLIPIDES DU STYLING ─────── */
has("const renderMembraneSelections = (sec) => {", 'un rendu dédié aux sélections lipidiques');
has('🧫 Membrane · leaflets', '…sous le nom « Membrane · leaflets »');
has("{shown && kind === 'lipid' && sec.id === firstLipidSectionOf(String(sec.id).split('::')[0]) && renderMembraneSelections(sec)}",
  '…rendu dans les ESPACES LIPIDIQUES (kind === \'lipid\') ET quand la molécule est visible, pas dans la barre de gauche');
has('const firstLipidSectionOf = (molKey) => {',
  '…UNE seule fois par molécule (la première cuve lipidique), jamais une copie par type de lipide');
has('{info.axis} · mid {info.midplane.toFixed(1)} Å · {info.thickness.toFixed(1)} Å',
  'la mesure est rappelée en tête du groupe, là où elle servait');
has('ONLY THE ROWS LIVE HERE', 'le groupe ne porte plus que ses rangées (la demande)');
gone('The leaflets are styled HERE, one selection at a time', '…sans le paragraphe d’explication');
gone('A row named after the heads can therefore never cover the whole bilayer.', '…ni la note sur les têtes');
gone('The four measured names work in a PyMOL script as well', '…ni le rappel du macro : le contrat des quatre noms est dans le code');

/* La liste : les QUATRE noms mesurés, plus les sélections du script DANS les lipides. */
has('const measured = Object.keys(membraneSele || {});',
  'la liste part des quatre sélections que le viewer a MESURÉES (les anciens ticks)');
has('const cats = catSelectionsFor(structure);', '…elle lit la classification chimique de la structure');
has('const lipid = cats && cats.lipid;', '…dont la sélection des lipides');
has('return seleIsWithin(structure, selKeyExpr(k), lipid) === true;',
  '…et garde toute sélection dont les atomes SONT dans les lipides (la demande : « if in the pymol macro a lipid is selected they should also be there »)');
has('const keys = [...measured, ...extra];', 'les deux familles de lignes sont réunies : mesurées d’abord');
has('const sig = `${measured.join(\',\')}::${selections.map((s) => `${s.name}=${s.expr}`).join(\'|\')}::${Object.keys(selStyles).join(\',\')}`;',
  'la liste est mémoïsée sur sa propre signature (pas de test de débordement à chaque rendu)');
has("if (cached.struct === structure && cached.sig === sig) return cached.keys;",
  '…et invalidée dès que la structure ou les sélections changent');

/* ── 3. CHAQUE RANGÉE ÉCRIT LE MÊME ÉTAT QUE LES TICKS ─────────────────── */
has('set: (field, value) => setSelField(key, field, value),',
  'une rangée de feuillet écrit `selStyles[nom]` — l’état que les ticks écrivaient');
has('setMaterial: (fam, field, value) => setSelMaterial(key, fam, field, value),',
  '…matériau par famille compris');
has('{n != null ? `${n} atoms` : \'—\'}', '…et chaque rangée dit combien d’atomes elle couvre');
has('const n = selectionAtomCount(key);', '…comptés par le helper unique de la barre de gauche');

/* ── 4. LES DEUX BARRES, LES MÊMES COMMANDES ───────────────────────────── */
eq(countOf(/const renderLookControls = \(\{/g), 1,
  'les commandes d’une rangée ont UNE seule implémentation (plus de copie entre les deux barres)');
eq(countOf(/renderLookControls\(\{/g), 3,
  'trois surfaces l’appellent : la rangée de styling, la rangée de sélection et une rangée de feuillet');
eq(countOf(/look: selLookOf\(st\),/g), 2,
  'les deux barres d’état (sélection et feuillet) passent par le MÊME adaptateur de lecture');
has('uid,', 'la rangée de styling lui passe son uid (le nom de la rangée)');
has('label: spec.label,', '…et son libellé');
has('styleOptions: spec.styles,', '…la liste de styles de SA spécification (curation conservée)');
has('colorOptions: spec.colors,', '…et SA liste de colorations');
has('styleLabelOf: (token) => styleLabelFor(kind, token),', '…avec les libellés de son type de molécule');
has('{styleOptions.map((s) => <option key={s} value={s}>{styleLabelOf(s)}</option>)}',
  'le menu « Style » est écrit par le rendu commun');
has('{colorOptions.map((c) => <option key={c} value={c}>{COLOR_LABELS[c] || c}</option>)}',
  'le menu « Color by » aussi (même vocabulaire, mêmes libellés)');
has('styleOptions: SEL_ROW_STYLE_CHOICES,', 'la barre de gauche garde SA liste de styles');
has('colorOptions: SEL_COLOR_MODES,', '…et sa liste de colorations');
has("styleLabelOf: (t) => STYLE_LABELS[t] || t,", '…avec les libellés partagés du styling');
/* Les adaptateurs : le vocabulaire d'une rangée EST celui du styling. */
has('const LOOK_FIELD_OF_SEL = {', 'un seul endroit traduit les champs des deux barres');
has("colorBy: 'colorMode',", '…« colorBy » devient « colorMode »');
has("solidColor: 'color',", '…« solidColor » devient « color »');
has("opacity: 'transparency',", '…« opacity » devient « transparency »');
has("sphere: 'radiusSphere',", '…« sphere » devient « radiusSphere »');
has("bond: 'radiusBond',", '…et « bond » devient « radiusBond »');
has('const work = setSelRowStyle(key, value);',
  'le STYLE reste une COMMANDE (setSelRowStyle, le geste des ticks) — jamais une écriture directe');
has("const chained = membraneHeadRelinquish(key, value !== 'hide', work);",
  '…enchaînée sur la règle des têtes de groupe (leurs atomes quittent le feuillet parent)');
has('const selLookOf = (st) => {', '…et la lecture d’une rangée de sélection passe par selLookOf');
/* Les ticks « + show » restent : PyMOL EMPILE ses commandes « show ». */
has('+ show', 'les ticks d’empilement sont toujours là (deux « show » de PyMOL)');
has('{families.map((fam) => {', 'le matériau est écrit par le rendu commun, famille par famille');
has('families: selRowFamilies(st),', '…avec les familles que la rangée dessine vraiment');
/* Plus AUCUN contrôle dupliqué dans la barre de gauche. */
gone('THE MATERIAL OF WHAT THIS ROW DRAWS', 'l’ancien bloc matériau de la barre de gauche a disparu');
gone('radiusSphere: Number(e.target.value)', '…et ses curseurs de rayon (le rendu commun les porte)');
eq(countOf(/Transparency regulator of THIS row/g), 1,
  'la transparence d’une rangée est écrite UNE fois, pour les deux barres');
eq(countOf(/title="Sphere radius — a multiplier of the style's own atom size \(1\.00 = untouched\)"/g), 1,
  '…le rayon des sphères (R●) aussi');
eq(countOf(/title="Bond radius — a multiplier of the style's own stick thickness AND of a Tube's own tube radius \(1\.00 = untouched\)"/g), 1,
  '…et le rayon des bâtons (R—), qui règle aussi le tube');

/* ── 5. LE MENU D'UNE MEMBRANE, ET LES DEUX PAIRES DE RANGÉES ──────────── */
/* Le rapport : « dei 4 comandi nella finestra styling (upper leaflet, lower
   leaflet, upper headgroups and lower headgroup) funziona bene solo lower
   leaflet » — et « i drop down menu per le membrane non devono contenere ribbon,
   cartoon, tube ed inoltre CPK è uguale a sphere ». */
const MEMBRANE_LIST = (VIEW.match(/const MEMBRANE_ROW_STYLE_CHOICES = \[([^\]]*)\];/) || [, ''])[1]
  .split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
eq(MEMBRANE_LIST, ['hide', 'ball+stick', 'licorice', 'spacefill', 'surface'],
  'la liste dédiée aux membranes : cacher · billes-bâtons · bâtons · CPK · surface');
ok(!MEMBRANE_LIST.some((s) => ['cartoon', 'ribbon', 'tube', 'trace'].includes(s)),
  'aucun style de POLYMÈRE : NGL ne dessine RIEN d’un lipide en cartoon / ribbon / tube — le sélecteur semblait mort');
ok(!MEMBRANE_LIST.includes('sphere'),
  '« Sphere » n’y est pas : c’est le MÊME `spacefill` que CPK (deux noms pour une commande)');
has('styleOptions: MEMBRANE_ROW_STYLE_CHOICES,', 'c’est cette liste que la rangée de membrane offre');
eq(countOf(/styleOptions: MEMBRANE_ROW_STYLE_CHOICES,/g), 1, '…une seule fois (le groupe des lipides)');

/* Le feuillet parent et la règle « une rangée de têtes possède ses atomes »,
   EXÉCUTÉE sur des styles réels : c’est ce qui fait qu’un style choisi sur les
   têtes se VOIT, même quand le feuillet qui les contient dessine des sphères. */
const iRel = VIEW.indexOf('const MEMBRANE_SIDE_OF = {');
const jRel = VIEW.indexOf('const SEL_STYLE_FLAG_OF = {');
ok(iRel >= 0 && jRel > iRel, 'les helpers des feuillets sont extractibles du viewer');
const CODE_REL = VIEW.slice(iRel, jRel);
const runRel = (key, on, styles) => new Function('cfg', `${CODE_REL}
  const SEL_STYLE_TOGGLE_TOKEN = { cartoon: 'cartoon', ribbon: 'ribbon', tube: 'tube', ball: 'ball', stick: 'stick', sphere: 'sphere', surface: 'surface' };
  return membraneHeadRelinquish(cfg.key, cfg.on, cfg.styles);`)({ key, on, styles });
const withParent = { upper_leaflet: { sphere: true, colorMode: 'resname' }, upper_headgroups: {} };
const rel1 = runRel('upper_headgroups', true, withParent);
eq(rel1.upper_leaflet.hideFor.sphere, ['upper_headgroups'],
  'les têtes du haut quittent les sphères de leur feuillet : leur propre style se voit enfin');
eq(rel1.upper_leaflet.colorMode, 'resname', '…sans rien perdre du reste de la rangée du feuillet');
ok(rel1.upper_headgroups === withParent.upper_headgroups, '…et la rangée de têtes elle-même n’est pas touchée');
eq(runRel('upper_headgroups', false, rel1).upper_leaflet.hideFor, undefined,
  'choisir « Hide » sur les têtes rend leurs atomes au feuillet (le geste est réversible)');
const onlySticks = { lower_leaflet: { stick: true } };
eq(runRel('lower_headgroups', true, onlySticks).lower_leaflet.hideFor.stick, ['lower_headgroups'],
  'idem pour les têtes du bas, sur un feuillet dessiné en bâtons');
const emptyParent = { lower_leaflet: {} };
ok(runRel('lower_headgroups', true, emptyParent) === emptyParent,
  'un feuillet qui ne dessine RIEN ne reçoit aucune exclusion inutile');
ok(runRel('water', true, withParent) === withParent, 'une rangée qui n’est pas des têtes ne change rien du tout');

/* 👁 solo : le feuillet de DERRIÈRE ne peut pas se voir à travers celui de devant. */
has('const membraneOppositeRows = (key) => Object.keys(MEMBRANE_SIDE_OF)', 'les rangées de l’autre feuillet sont calculées');
has('const setMembraneSolo = (key, on) => {', '…et le bouton 👁 solo les cache d’un seul clic');
has('cur.hidden = true;', '…avec le MÊME drapeau `hidden` que le 🙈 de la barre de gauche');
has('const solo = measuredRow && membraneSoloOn(key);', 'l’état du bouton est LU dans les styles, jamais doublé');
has('👁 solo', 'le bouton est là, sur chaque rangée mesurée');
has('the front leaflet covers the one behind it',
  '…et le groupe dit POURQUOI le feuillet de derrière ne se voyait pas (le rapport « seul lower leaflet marche »)');

/* ── 5. LA RÈGLE « LE PROPRIÉTAIRE DES TÊTES », AU MOMENT DU RENDU ─────── */
/* Le rapport : « upper headgroup and lower headgroup works well only lower
   leaflet ». Cause trouvée : `hideFor` est écrit PAR STYLE au moment du clic —
   styliser les têtes pendant que le feuillet ne dessine encore RIEN n'y inscrit
   donc rien, et le CPK choisi plus tard sur le feuillet avale les têtes (et
   réciproquement). La règle ci-dessous repose la question à CHAQUE
   reconstruction de la scène, à partir des deux rangées elles-mêmes. */
const iOwn = VIEW.indexOf('const MEMBRANE_CHILD_OF = {');
const jOwn = VIEW.indexOf('const selRowStyle = (st) => {');
ok(iOwn >= 0 && jOwn > iOwn, 'la règle « propriétaire des têtes » est extractible du viewer');
const CODE_OWN = VIEW.slice(iOwn, jOwn);
// Le segment porte déjà le vrai SEL_STYLE_TOGGLE_TOKEN (les flags qu'une rangée
// peut dessiner) : rien à simuler.
ok(CODE_OWN.includes('const SEL_STYLE_TOGGLE_TOKEN = {'),
  '…et il porte la liste des styles qu’une rangée peut dessiner (source unique)');
const OWN_EXPR = (k) => (k === 'upper_headgroups' ? 'upper and resn POPC+POPE' : 'lower and resn POPC+POPE');
const runOwn = (key, styles) => new Function('cfg', `${CODE_OWN}
  return membraneHeadOwnerExprs(cfg.key, cfg.styles, cfg.exprOf);`)({ key, styles, exprOf: OWN_EXPR });

// (a) L'ORDRE DU RAPPORT : les têtes stylisées D'ABORD (le feuillet ne dessine
//     encore rien, donc rien n'a pu être mémorisé), le CPK choisi sur le feuillet
//     ENSUITE. La règle doit malgré tout soustraire les têtes.
const styledFirst = { upper_headgroups: { ball: true, stick: true }, upper_leaflet: {} };
eq(styledFirst.upper_leaflet.hideFor, undefined,
  '…prémisse : à ce stade rien n’est inscrit dans hideFor (le feuillet ne dessinait rien)');
eq(runOwn('upper_leaflet', { ...styledFirst, upper_leaflet: { sphere: true } }), '(upper and resn POPC+POPE)',
  'le CPK du feuillet soustrait les têtes, même quand le clic sur les têtes n’a rien pu mémoriser');
// (b) L'ORDRE INVERSE : CPK d'abord, têtes ensuite. La même clause revient, donc
//     la déduplication de `exclusionOf` évite de l'écrire deux fois.
eq(runOwn('upper_leaflet', { upper_leaflet: { sphere: true, hideFor: { sphere: ['upper_headgroups'] } }, upper_headgroups: { stick: true } }),
  '(upper and resn POPC+POPE)', 'l’autre ordre donne la MÊME clause : les deux chemins convergent');
// (c) POUR TOUS LES STYLES du feuillet, pas seulement le jumeau de celui des têtes :
//     `exclusionOf(style)` est appelé une fois par style dessiné.
['ball', 'stick', 'sphere', 'surface', 'cartoon'].forEach((flag) => {
  ok(runOwn('lower_leaflet', { lower_leaflet: { [flag]: true }, lower_headgroups: { sphere: true } }) !== '',
    `…et pour le style « ${flag} » du feuillet aussi`);
});
// (d) « Hide » sur les têtes rend leurs atomes au feuillet : plus rien à soustraire.
eq(runOwn('upper_leaflet', { upper_leaflet: { sphere: true }, upper_headgroups: { hidden: true, ball: true } }), '',
  'des têtes cachées n’enlèvent plus rien à leur feuillet (le geste reste réversible)');
// (e) Une rangée de têtes qui ne dessine RIEN ne possède rien non plus.
eq(runOwn('upper_leaflet', { upper_leaflet: { sphere: true }, upper_headgroups: {} }), '',
  '…et une rangée de têtes sans représentation non plus');
// (f) Les garde-fous : « all » / « none » ne sont pas des clauses utiles, une
//     rangée qui n’est pas un feuillet n’a pas de propriétaire, et l’absence de
//     styles ne doit jamais lever d’exception.
const ownOf = (expr) => new Function('expr', `${CODE_OWN}
  return membraneHeadOwnerExprs('upper_leaflet',
    { upper_leaflet: { sphere: true }, upper_headgroups: { ball: true } }, () => expr);`)(expr);
eq(ownOf('all'), '', 'une sélection « all » n’est jamais recopiée comme clause d’exclusion');
eq(ownOf('none'), '', '…ni « none » (le feuillet se dessinerait tout entier)');
eq(ownOf(''), '', '…ni une chaîne vide');
eq(runOwn('water', { water: { sphere: true }, upper_headgroups: { ball: true } }), '',
  'une rangée qui n’est pas un feuillet n’a pas de propriétaire à chercher');
eq(runOwn('upper_headgroups', { upper_headgroups: { ball: true }, upper_leaflet: { sphere: true } }), '',
  'une rangée de têtes n’est jamais traitée comme un feuillet (pas de récursion)');
eq(runOwn('lower_leaflet', undefined), '', 'aucun style = aucune clause (jamais de throw)');

/* …et le branchement : la clause est calculée une fois par rangée et ajoutée à
   l’exclusion de CHAQUE style, à côté de ce que hideFor dit déjà. */
has('const membraneOwners = membraneHeadOwnerExprs(key, styles, selKeyExpr);',
  'la clause est calculée à partir des styles VIVANTS, une fois par rangée');
has('if (membraneOwners && !parts.includes(membraneOwners)) parts.push(membraneOwners);',
  '…puis ajoutée pour chaque style, sans doublon avec hideFor');
has('const exclusionOf = (style) => {', '…par la fonction d’exclusion que la rangée appelle par style');
has("const ex = style ? exclusionOf(style) : '';", '…donc chaque représentation de la rangée en hérite');
has('const sele = ex ? `(${seleBase}) and not (${ex})` : seleBase;',
  '…sous la forme « and not (…) » : les têtes SORTENT de la représentation du feuillet');
/* Une seule implémentation de la règle : pas de copie de la clause ailleurs. */
eq(countOf(/membraneHeadOwnerExprs\s*=/g), 1, 'une seule définition de la règle (pas de copie)');
eq(countOf(/membraneHeadOwnerExprs\(/g), 1, '…et un seul appel : c’est bien la MÊME règle partout');

/* ── Bilan ─────────────────────────────────────────────────────────────── */
console.log(`_viewer_membrane_rows_test.mjs — ${passed} assertions OK (feuillets stylables + deux barres identiques)`);


