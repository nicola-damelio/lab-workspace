/* =========================================================================
   _viewer_atom_charge_test.mjs — « ATOM CHARGE », LA DEMANDE DE CETTE SESSION :
   « In the “molecule styling” window add a “color by” option: atom charge. »

   Ce que cette suite mesure, et pourquoi elle EXÉCUTE au lieu de relire :

     1. LA RAMPE est une fonction PURE (`atomChargeColorOf`) : un atome neutre prend
        EXACTEMENT la pastille « neutre » de la roue ⚙, un atome à −1 e la pastille
        « négative », un atome à +1 e la pastille « positive », une charge hors
        échelle est ÉCRÊTÉE au pôle (−2 e se peint comme −1 e : un Mg²⁺ n'invente pas
        une quatrième couleur), et rien de ce qui n'est pas un nombre fini ne se peint
        autrement que le neutre ;
     2. LES TROIS PASTILLES DE LA ROUE ⚙ SONT LES ANCRES de cette rampe : changer le
        pôle négatif déplace le pôle négatif (et le milieu), changer le neutre déplace
        le point zéro, et le pôle opposé ne bouge pas d'un chiffre ;
     3. LA CHARGE D'UN ATOME est celle du ⚡ ESP — la MÊME table (`espChargesFor`, un
        parcours par structure, mis en cache) : l'oxygène d'un ligand est négatif, un
        sodium vaut +1 (sa charge formelle), et un atome sans structure / sans index /
        hors table vaut 0 — jamais une charge inventée ;
     4. LE SCHÉMA PEINT VRAIMENT, dans le VRAI NGL 2.4 : enregistré par
        `registerColorScheme`, instancié avec la structure que NGL passe à toute
        représentation (`getColorParams`), il rend POUR CHAQUE ATOME la couleur de sa
        charge, et sans structure il rend le NEUTRE (jamais du noir) ;
     5. LA FENÊTRE DE STYLING L'OFFRE PARTOUT : « Atom charge » est dans le vocabulaire
        partagé (COLOR_LABELS) ET dans CHAQUE liste « Color by » de CHAQUE type de
        molécule, la rangée le passe à NGL en `color`, et le repli d'un build sans le
        schéma maison est le `partialcharge` NATIF de NGL — le sibling de la même
        grandeur —, jamais un aplat d'éléments.

   Le viewer est un .jsx : ses helpers PURS sont EXTRAITS puis EXÉCUTÉS, et le NGL
   installé (2.4.0, celui de la page) est utilisé là où cela compte.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const NGL = require('ngl');

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};

const SRC = process.env.VIEWER_SRC || new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url);
const VIEW = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);

/* ── Extraction : le comptage de profondeur lit un MASQUE où les commentaires sont
   remplacés par des espaces de même longueur — les parenthèses de la prose (les blocs
   de documentation du viewer en sont pleins) fausseraient sinon la fin d'un `const`. */
const MASK = VIEW
  .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
  .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
const sliceObject = (src, name) => {
  const start = src.indexOf(`const ${name} = {`);
  assert.ok(start >= 0, `objet ${name} introuvable`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (MASK[i] === '{') depth += 1;
    else if (MASK[i] === '}') { depth -= 1; if (depth === 0) return `${src.slice(start, i + 1)};`; }
  }
  throw new Error(`${name} : objet non terminé`);
};
const sliceDecl = (src, name) => {
  const head = `const ${name} = `;
  const start = src.indexOf(head);
  assert.ok(start >= 0, `déclaration ${name} introuvable`);
  let depth = 0;
  for (let i = start + head.length; i < src.length; i += 1) {
    const c = MASK[i];
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') depth -= 1;
    else if (c === ';' && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`${name} : déclaration non terminée`);
};
const sliceFn = (src, name) => {
  const start = src.indexOf(`const ${name} = `);
  assert.ok(start >= 0, `fonction ${name} introuvable`);
  const arrow = src.indexOf('=>', start);
  const body = arrow >= 0 ? src.indexOf('{', arrow) : -1;
  const between = body > arrow ? MASK.slice(arrow + 2, body).trim() : 'x';
  if (body < 0 || between !== '') return sliceDecl(src, name);
  let depth = 0;
  for (let i = body; i < src.length; i += 1) {
    if (MASK[i] === '{') depth += 1;
    else if (MASK[i] === '}') { depth -= 1; if (depth === 0) return `${src.slice(start, i + 1)};`; }
  }
  throw new Error(`${name} : corps non terminé`);
};
const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

/* ══ 1. LA RAMPE — EXTRAITE PUIS EXÉCUTÉE ═════════════════════════════════════
   Les pastilles viennent de la table que la roue ⚙ édite, et la rampe des fonctions
   pures du viewer : ce qui est mesuré ici est exactement ce que NGL recevra. */
const RAMP = new Function([
  sliceObject(VIEW, 'CHARGE_COLORS'),
  sliceDecl(VIEW, 'DEFAULT_ELEMENT_COLOR'),
  sliceDecl(VIEW, 'chargeColorStore'),
  sliceFn(VIEW, 'chargeColorOf'),
  sliceFn(VIEW, 'lerpHexColors'),
  sliceDecl(VIEW, 'ATOM_CHARGE_DOMAIN'),
  sliceFn(VIEW, 'atomChargeColorOf'),
  'return { CHARGE_COLORS, chargeColorStore, chargeColorOf, lerpHexColors, ATOM_CHARGE_DOMAIN, atomChargeColorOf };',
].join('\n'))();

const NEUTRAL = RAMP.chargeColorOf('neutral');
const NEG = RAMP.chargeColorOf('negative');
const POS = RAMP.chargeColorOf('positive');
eq(RAMP.ATOM_CHARGE_DOMAIN, 1, 'l’échelle pleine de la rampe est ±1 e, la grandeur qu’elle peint');
eq(RAMP.atomChargeColorOf(0), NEUTRAL, 'un atome neutre prend EXACTEMENT la pastille « neutre » de la roue ⚙');
eq(RAMP.atomChargeColorOf(-1), NEG, 'un atome à −1 e (un chlorure) prend la pastille « négative »');
eq(RAMP.atomChargeColorOf(1), POS, 'un atome à +1 e (un sodium) prend la pastille « positive »');
eq(RAMP.atomChargeColorOf(-2), NEG, '…et une charge hors échelle est ÉCRÊTÉE au pôle (−2 e se peint comme −1 e)');
eq(RAMP.atomChargeColorOf(4.5), POS, '…+4.5 e comme +1 e : aucune quatrième couleur n’est inventée');
[NaN, null, undefined, '', {}, []].forEach((bad) => eq(RAMP.atomChargeColorOf(bad), NEUTRAL,
  `une charge illisible (${String(bad)}) se peint en neutre, jamais autrement`));
// Le MILIEU de la rampe : interpolé entre le neutre et le pôle, dans le bon sens.
const halfNeg = RAMP.atomChargeColorOf(-0.5);
const halfPos = RAMP.atomChargeColorOf(0.5);
ok(rgb(halfNeg)[0] > rgb(NEUTRAL)[0] && rgb(halfNeg)[0] < rgb(NEG)[0],
  `à mi-chemin, le rouge d’un atome négatif est ENTRE le neutre et le pôle (${rgb(halfNeg)} · ${rgb(NEUTRAL)} · ${rgb(NEG)})`);
ok(rgb(halfNeg)[2] < rgb(NEUTRAL)[2] && rgb(halfNeg)[2] > rgb(NEG)[2],
  '…son bleu aussi (la rampe est bien interpolée, pas un escalier)');
ok(rgb(RAMP.atomChargeColorOf(-0.9))[0] > rgb(halfNeg)[0],
  '…et plus la charge est grande, plus l’atome s’approche du pôle');
ok(rgb(halfNeg)[0] > rgb(halfNeg)[2], 'un atome NÉGATIF tire vers le rouge');
ok(rgb(halfPos)[2] > rgb(halfPos)[0], 'un atome POSITIF tire vers le bleu');
ok(halfNeg !== halfPos, '…et les deux moitiés ne rendent pas la même couleur (le signe est peint)');
/* LES PASTILLES DE LA ROUE ⚙ SONT VIVANTES : la rampe les lit à chaque appel. */
RAMP.chargeColorStore.negative = 0x00ff00;
eq(RAMP.atomChargeColorOf(-1), 0x00ff00, 'changer le pôle négatif dans la roue ⚙ change le pôle négatif de la rampe');
ok(RAMP.atomChargeColorOf(-0.5) !== halfNeg, '…et déplace le milieu de la rampe');
eq(RAMP.atomChargeColorOf(1), POS, '…sans toucher au pôle opposé');
RAMP.chargeColorStore.negative = NEG;
RAMP.chargeColorStore.neutral = 0x010203;
eq(RAMP.atomChargeColorOf(0), 0x010203, 'changer le NEUTRE déplace le point zéro de la rampe');
RAMP.chargeColorStore.neutral = NEUTRAL;
eq(RAMP.atomChargeColorOf(0), NEUTRAL, '…et la rampe suit la pastille dans les deux sens');

/* ══ 2. LA TABLE DES CHARGES — LE MÊME PARCOURS QUE LE ⚡ ESP ═════════════════
   Une structure réellement parsée par le VRAI NGL : une alanine, un ligand à trois
   atomes (aucune charge, aucune liaison — le cas d'un PDB) et un sodium. */
globalThis.FileReader = class {
  readAsText(blob) {
    Promise.resolve(blob.text()).then((t) => {
      this.result = t;
      if (typeof this.onload === 'function') this.onload({ target: this });
    });
  }
};
const CHARGE_PDB = [
  'ATOM      1  N   ALA A   1      11.104   6.134  -6.504  1.00  0.00           N',
  'ATOM      2  CA  ALA A   1      11.639   6.071  -5.131  1.00  0.00           C',
  'ATOM      3  C   ALA A   1      13.149   6.136  -5.106  1.00  0.00           C',
  'ATOM      4  O   ALA A   1      13.788   5.252  -5.588  1.00  0.00           O',
  'HETATM    5  C1  LIG B 101      -2.000   3.000   1.000  1.00  0.00           C',
  'HETATM    6  O1  LIG B 101      -1.000   3.500   1.500  1.00  0.00           O',
  'HETATM    7  N1  LIG B 101      -3.000   3.800   0.800  1.00  0.00           N',
  'HETATM    8  SOD SOD C 102       6.000   6.000   6.000  1.00  0.00           NA',
  'END',
].join('\n');

const APP = new Function('NGL', [
  'const window = { NGL };   // le code extrait lit `window.NGL`, comme dans la page',
  sliceDecl(VIEW, 'ESP_MAX_RADIUS'),
  sliceDecl(VIEW, 'ESP_KCAL'),
  sliceDecl(VIEW, 'ESP_NEUTRAL_REFERENCE'),
  sliceDecl(VIEW, 'ESP_CHARGE_PER_UNIT'),
  sliceObject(VIEW, 'ESP_ELECTRONEGATIVITY'),
  sliceObject(VIEW, 'ESP_ION_CHARGES'),
  sliceFn(VIEW, 'espHeteroChargeOf'),
  sliceDecl(VIEW, 'espChargeCache'),
  sliceFn(VIEW, 'espChargesFor'),
  sliceObject(VIEW, 'CHARGE_COLORS'),
  sliceDecl(VIEW, 'DEFAULT_ELEMENT_COLOR'),
  sliceDecl(VIEW, 'chargeColorStore'),
  sliceFn(VIEW, 'chargeColorOf'),
  sliceFn(VIEW, 'lerpHexColors'),
  sliceDecl(VIEW, 'ATOM_CHARGE_DOMAIN'),
  sliceFn(VIEW, 'atomChargeColorOf'),
  sliceFn(VIEW, 'atomChargeOf'),
  'let atomChargeSchemeKey = null;',
  sliceFn(VIEW, 'defineAtomChargeScheme'),
  sliceFn(VIEW, 'registerColorScheme'),
  'return { espChargesFor, chargeColorOf, atomChargeColorOf, atomChargeOf, defineAtomChargeScheme, registerColorScheme };',
].join('\n'))(NGL);

const st = await NGL.autoLoad(new Blob([CHARGE_PDB], { type: 'text/plain' }), { ext: 'pdb' });
const table = APP.espChargesFor(st);
ok(!!table, 'la table de charges du ⚡ ESP se calcule sur cette structure');
eq(table.charges.length, st.atomCount, '…une charge par atome (la structure entière)');
eq(APP.atomChargeOf({ index: 5 }, st), table.charges[5],
  'la charge que « Atom charge » peint est EXACTEMENT celle du ⚡ ESP — une seule table pour les deux colorations');
ok(APP.atomChargeOf({ index: 5 }, st) < 0, '…l’oxygène du ligand est NÉGATIF (NGL lui donnait 0)');
eq(APP.atomChargeOf({ index: 7 }, st), 1, '…et le sodium SOD vaut +1 (sa charge FORMELLE)');
eq(APP.atomChargeOf({ index: 5 }, null), 0, 'sans structure, la charge est 0 — jamais inventée');
eq(APP.atomChargeOf({}, st), 0, 'un atome sans index vaut 0');
eq(APP.atomChargeOf({ index: 999 }, st), 0, 'un index hors table vaut 0');
eq(APP.atomChargeOf(null, st), 0, 'un atome absent vaut 0');

/* ══ 3. LE SCHÉMA DANS LE VRAI NGL — ENREGISTRÉ, INSTANCIÉ, ET IL PEINT ═══════ */
const atomKey = APP.registerColorScheme(NGL, 'lab-test-atom-charge', APP.defineAtomChargeScheme());
ok(typeof atomKey === 'string' && atomKey.length > 0, 'le schéma lab-atom-charge s’enregistre dans le VRAI NGL');
const cm = NGL.ColormakerRegistry.getScheme({ scheme: atomKey, structure: st });
ok(cm.parameters.structure === st,
  'NGL passe bien la structure au schéma (StructureRepresentation#getColorParams) — la couleur suit donc L’ATOME de CETTE structure');
let painted = 0;
st.eachAtom((a) => {
  eq(cm.atomColor({ index: a.index }), APP.atomChargeColorOf(table.charges[a.index]),
    `l’atome ${a.index} (${a.atomname} ${a.resname}) prend la couleur de SA charge`);
  painted += 1;
});
eq(painted, st.atomCount, '…pour TOUS les atomes, aucun oublié');
const oCol = rgb(cm.atomColor({ index: 5 }));
ok(oCol[0] > rgb(NEUTRAL)[0] && oCol[2] < rgb(NEUTRAL)[2],
  `l’oxygène négatif du ligand quitte le neutre vers le ROUGE (${oCol} contre ${rgb(NEUTRAL)})`);
eq(cm.atomColor({ index: 7 }), POS,
  '…et le sodium (+1 e) prend EXACTEMENT la pastille « positive » de la roue (le pôle, sans interpolation)');
const naCol = rgb(cm.atomColor({ index: 7 }));
ok(naCol[2] > naCol[0] && Math.abs(naCol[2] - rgb(NEUTRAL)[2]) > Math.abs(oCol[2] - rgb(NEUTRAL)[2]),
  `…une charge pleine s’éloigne plus du neutre qu’une charge partielle (${naCol} contre ${oCol})`);
// Sans structure, le schéma ne peint JAMAIS du noir : il peint le neutre de la roue.
const cmNoStruct = NGL.ColormakerRegistry.getScheme({ scheme: atomKey });
eq(cmNoStruct.atomColor({ index: 0 }), NEUTRAL, 'sans structure (la sonde du registre) l’atome prend le neutre, jamais du noir');
eq(cmNoStruct.atomColor({}), NEUTRAL, '…et un atome sans index aussi');
eq(cmNoStruct.atomColor(null), NEUTRAL, '…et un atome absent');
// Le REPLI NATIF existe et s’instancie : le `partialcharge` de NGL 2.4, la même
// grandeur (une rampe rouge → blanc → bleu sur `atom.partialCharge`, domaine ±1 e).
ok(NGL.ColormakerRegistry.getSchemes().partialcharge !== undefined,
  'le colormaker `partialcharge` du repli est bien enregistré par NGL 2.4');
ok(typeof NGL.ColormakerRegistry.getScheme({ scheme: 'partialcharge', structure: st }).atomColor === 'function',
  '…et il est instanciable sur une structure (une molécule n’est jamais laissée sans couleur)');

/* ══ 4. L'OFFRE DANS LA FENÊTRE DE STYLING — LE VOCABULAIRE ET LE CÂBLAGE ═════ */
has("atomcharge: 'Atom charge',", '« Atom charge » est dans le vocabulaire PARTAGÉ des colorations (COLOR_LABELS)');
{
  // La liste des « Color by » est LUE dans la source puis parcourue : la nouvelle
  // lecture doit être offerte sur CHAQUE type de molécule, et chaque valeur offerte
  // doit avoir un libellé (un jeton sans libellé s’afficherait tel quel).
  const iColors = VIEW.indexOf('const COLORS = {');
  const colorsSrc = VIEW.slice(iColors, VIEW.indexOf('\n};', iColors));
  const lists = [...colorsSrc.matchAll(/(\w+): \[([^\]]*)\]/g)]
    .map((m) => ({ kind: m[1], modes: m[2].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean) }));
  ok(lists.length >= 10, `les listes « Color by » sont lues dans la source (${lists.length} listes)`);
  const iLabels = VIEW.indexOf('const COLOR_LABELS = {');
  const labels = new Map([...VIEW.slice(iLabels, VIEW.indexOf('\n};', iLabels)).matchAll(/(\w+): '([^']*)'/g)]
    .map((m) => [m[1], m[2]]));
  lists.forEach(({ kind, modes }) => {
    ok(modes.includes('atomcharge'), `« Atom charge » est offert sur la rangée « ${kind} »`);
    modes.forEach((mode) => ok(labels.has(mode), `…et chaque valeur de « ${kind} » a un libellé (${mode})`));
  });
}
has("const ATOM_CHARGE_DOMAIN = 1;   // e — the full scale of the ramp (±)",
  'l’échelle de la rampe est écrite dans la source, en unités de charge élémentaire');
has("defineAtomChargeScheme());", 'le schéma est bâti par SA fonction de définition (nommée, donc testable)');
has("registerAtomChargeScheme(NGL);   // ⚡ the PARTIAL charge of EVERY atom (lab-atom-charge)",
  '…et il est enregistré au démarrage de la scène, avec les autres schémas maison');
has("case 'atomcharge': return schemeParam(atomChargeSchemeKey, 'partialcharge');",
  'une rangée le passe à NGL en `color`, avec le `partialcharge` NATIF de NGL en repli');
has("if (mode === 'atomcharge') return atomChargeSchemeKey || 'partialcharge';",
  'la barre des sélections et celle de la membrane passent par la MÊME correspondance');
has("const CHARGE_ORDER = ['negative', 'neutral', 'positive'];",
  'les trois ancres de la rampe sont les trois pastilles de la roue ⚙ (aucune palette en plus)');
has('« Color by » of ${uid} — « Electrostatic potential » paints a surface and nothing else; « Atom charge » paints EVERY atom by its own partial charge',
  'l’infobulle du menu « Color by » dit ce que la nouvelle lecture peint');
has('every atom by its own PARTIAL charge — the three swatches of « Charge » in the ⚙ wheel are the ramp',
  'la rangée le redit quand elle est choisie, sans rouvrir un second ⚙');
has('THE SAME THREE SWATCHES ARE THE ANCHORS OF « Atom charge »',
  '…et la roue ⚙ dit que ses trois pastilles sont les ancres de cette rampe');

console.log(`_viewer_atom_charge_test.mjs — ${passed} assertions OK`);
