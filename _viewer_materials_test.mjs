/* =========================================================================
   _viewer_materials_test.mjs — LE MATÉRIAU des représentations (🎛 Material).

   Le rapport : le réglage Material ne faisait RIEN — les quatre familles
   (sphères · liaisons · cartoon · surface) restaient au matériau plat de NGL.
   La cause n'était pas le réglage mais la CIBLE : `addRepresentation` ne
   renvoie PAS la représentation, il renvoie l'ÉLÉMENT qui l'enveloppe
   (ngl 2.4.0, component.ts : `new RepresentationElement(this.stage, repr, p,
   this)`), et c'est cet élément que le viewer garde dans tous ses refs.
   L'ancien code parcourait `element.geometryList` pour régler des uniforms
   three.js : un élément n'a AUCUN geometryList (les géométries vivent sur la
   représentation, `repr.geometryList` / `repr.bufferList`), donc il revenait
   en silence et chaque curseur semblait mort.

   Ce garde-fou ne se contente donc pas de lire la source du viewer : il
   EXTRAIT les fonctions et les EXÉCUTE sur une doublure d'élément NGL, puis il
   lit les SOURCES ORIGINALES de ngl 2.4.0 — la sourcemap est livrée dans le
   paquet — pour vérifier sur le vrai code les faits sur lesquels le correctif
   repose :
     • l'élément reçoit `name = repr.type` et son propre `type` vaut la
       constante 'representation' (le contraire d'un type de rep) ;
     • roughness / metalness sont des paramètres de PREMIÈRE CLASSE de toute
       Representation, avec les défauts 0.4 / 0.0 (le « plat, pas brillant ») ;
     • côté buffer ils sont déclarés `{ uniform: true }` et `setParameters` les
       applique EN PLACE (setUniforms), le ShaderMaterial partageant le même
       objet uniforms : aucun rebuild, aucun needsUpdate n'est nécessaire.

   LE MATÉRIAU APPARTIENT MAINTENANT À LA LIGNE DE STYLING. Il était réglé par
   UN panneau global en bas de la barre Selections, avec quatre familles
   (sphères · liaisons · cartoon · surface) pour TOUTE la scène : deux molécules
   du même fichier ne pouvaient donc pas être dessinées avec deux matériaux
   différents. Demande de l'utilisateur : « they should be in each subsection of
   styling window because not all the molecules might be represented with the
   same material ». Le matériau est donc un champ du LOOK de chaque ligne de la
   fenêtre « Molecules · styling » (`material` / `roughness` / `metalness`, il
   suit la ligne General de sa molécule comme les autres champs et se persiste
   avec eux) ; chaque représentation retient la ligne dont elle vient
   (`rep.__sec`, écrit par buildSectionReps) et le rendu relit SON look — donc
   chaque molécule, et chaque partie d'une molécule, porte le sien (§6bis).
   Les LIGNES DE LA BARRE SELECTIONS ont le même contrôle (§6ter) : un matériau
   appartient à une famille de représentations, et une ligne de cette barre peut
   en dessiner plusieurs (sphères ET bâtons, cartoon…), donc la barre offre un 🎛
   par famille RÉELLEMENT dessinée — « si je dessine le peptide en cartoon, je
   veux choisir le matériau du cartoon » — chaque rep de la ligne retenant sa
   ligne et son style (`rep.__sel`).
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
const gone = (needle, what) => ok(!VIEW.includes(needle), `${what}\n  encore présent : ${needle}`);

/* ── Extraction : du `const <nom>` jusqu'au `;` qui ferme l'instruction ──────
   Parenthèses, crochets et accolades sont comptés, donc un `;` INTERNE (dans le
   corps d'un reduce, par exemple) ne coupe pas le bloc. */
const extract = (src, name) => {
  const start = src.indexOf(`const ${name}`);
  assert.ok(start >= 0, `déclaration ${name} introuvable`);
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const c = src[i];
    if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') depth -= 1;
    else if (c === ';' && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`${name} : instruction non terminée`);
};

const CODE = [
  extract(VIEW, 'MATERIAL_PRESETS'),
  extract(VIEW, 'MATERIAL_PRESET_KEYS'),
  extract(VIEW, 'MATERIAL_KINDS'),
  extract(VIEW, 'MATERIAL_KIND_OF_REP'),
  extract(VIEW, 'SEL_STYLE_REP_TYPE'),
  extract(VIEW, 'selRowFamilies'),
  extract(VIEW, 'materialValueOf'),
  extract(VIEW, 'reprOfElement'),
  extract(VIEW, 'repTypeOfElement'),
  extract(VIEW, 'applyMaterialToRep'),
].join('\n');
const F = new Function(`${CODE}
  return { MATERIAL_PRESETS, MATERIAL_PRESET_KEYS, MATERIAL_KINDS, MATERIAL_KIND_OF_REP, SEL_STYLE_REP_TYPE,
    selRowFamilies, materialValueOf, reprOfElement, repTypeOfElement, applyMaterialToRep };`)();

ok(!/useState|useRef|componentRef/.test(CODE),
  'le réglage du matériau ne dépend d’aucun état React : il est exécutable tel quel');

/* ══ 1. LES FAITS NGL, LUS DANS LES SOURCES DE NGL LUI-MÊME ═══════════════ */
let ngl = null;
try {
  ngl = JSON.parse(readFileSync(new URL('./node_modules/ngl/dist/ngl.esm.js.map', import.meta.url), 'utf8'));
} catch { /* ngl non installé : la section est sautée, jamais faussement verte */ }
if (ngl) {
  const srcOf = (pat) => {
    const i = ngl.sources.findIndex((s) => s.includes(pat));
    return i < 0 ? null : ngl.sourcesContent[i];
  };
  const elSrc = srcOf('component/representation-element.ts');
  const repSrc = srcOf('representation/representation.ts');
  const bufSrc = srcOf('buffer/buffer.ts');
  ok(!!elSrc && !!repSrc && !!bufSrc,
    `les sources de ngl 2.4.0 sont lisibles (${ngl.sources.length} fichiers dans la sourcemap)`);

  // L'ÉLÉMENT, et pourquoi l'ancienne cible ne pouvait pas marcher.
  ok(/super\(stage, Object\.assign\(\{ name: repr\.type \}, params\)\)/.test(elSrc),
    'l’ÉLÉMENT reçoit `name = repr.type` : c’est de là que vient le type de rep que le viewer lit');
  ok(/get type \(\) \{ return 'representation' \}/.test(elSrc),
    '…et son propre `type` vaut la constante « representation » — à ne pas prendre pour un type de rep');
  ok(/repr: Representation/.test(elSrc) && /this\.repr = repr/.test(elSrc),
    'la représentation enveloppée est PUBLIQUE (`repr`) : c’est par elle qu’on règle le matériau');
  ok(!/geometryList/.test(elSrc),
    'l’élément n’expose aucun geometryList — la raison exacte pour laquelle l’ancien code revenait en silence');
  ok(/setParameters \(params: any\)[\s\S]*?this\.repr\.setParameters\(params\)/.test(elSrc),
    'l’élément DÉLÈGUE setParameters à la représentation');

  // roughness / metalness : paramètres de première classe, et leurs défauts.
  ok(/roughness: \{\s*type: 'range', step: 0\.01, max: 1, min: 0, buffer: true\s*\}/.test(repSrc),
    'roughness est un paramètre `buffer: true` du schéma de TOUTE Representation');
  ok(/metalness: \{\s*type: 'range', step: 0\.01, max: 1, min: 0, buffer: true\s*\}/.test(repSrc),
    '…et metalness exactement pareil');
  ok(/this\.roughness = defaults\(p\.roughness, 0\.4\)/.test(repSrc),
    'le défaut de NGL est 0.4 (mat, non métallique) : le « plat, pas brillant » du rapport');
  ok(/this\.metalness = defaults\(p\.metalness, 0\.0\)/.test(repSrc), '…et 0.0 pour metalness');
  ok(/roughness: 0\.4,/.test(bufSrc) && /metalness: 0\.0,/.test(bufSrc),
    'les mêmes défauts sont dans les paramètres du buffer');

  // …et « en place » : pas de rebuild, pas de needsUpdate.
  ok(/roughness: \{ uniform: true \}/.test(bufSrc) && /metalness: \{ uniform: true \}/.test(bufSrc),
    'les deux sont déclarés `{ uniform: true }` côté buffer');
  ok(/uniformData\[ name \] = value/.test(bufSrc) && /this\.setUniforms\(uniformData\)/.test(bufSrc),
    'Buffer.setParameters les applique EN PLACE (setUniforms), sans reconstruire la géométrie');
  ok(/uniforms: this\.uniforms/.test(bufSrc),
    'le ShaderMaterial partage le MÊME objet uniforms : aucun needsUpdate n’est nécessaire');

  // Les types de reps que NGL connaît vraiment : c’est le vocabulaire des familles.
  const TYPES = new Set();
  ngl.sources.forEach((name, i) => {
    if (!/representation\//.test(name)) return;
    (ngl.sourcesContent[i] || '').split('\n').forEach((line) => {
      const m = /this\.type = '([^']+)'/.exec(line);
      if (m) TYPES.add(m[1]);
    });
  });
  ok(TYPES.has('spacefill') && TYPES.has('licorice') && TYPES.size > 20,
    `la liste des types de reps est extraite de ngl (${TYPES.size} types)`);
  F.MATERIAL_KINDS.forEach(({ key, reps }) => {
    reps.forEach((r) => ok(TYPES.has(r),
      `la famille « ${key} » nomme un type de rep qui EXISTE chez ngl 2.4.0 : ${r}`));
  });
  // Les reps SANS matériau : chez NGL leur roughness vaut null.
  ok(/roughness: null/.test(srcOf('representation/point-representation.ts'))
    && /roughness: null/.test(srcOf('representation/line-representation.ts')),
    'point et line déclarent `roughness: null` : elles n’ont pas de matériau du tout');
  ok(!F.MATERIAL_KIND_OF_REP.point && !F.MATERIAL_KIND_OF_REP.line && !F.MATERIAL_KIND_OF_REP.label,
    '…donc aucune famille ne les touche (aucun curseur ne peut les prétendre réglables)');
} else {
  console.log('  (ngl absent : les faits NGL n’ont pas été vérifiés)');
}

/* ══ 2. LES QUATRE FAMILLES ET LEURS PRESETS ══════════════════════════════ */
eq(F.MATERIAL_KINDS.map((k) => k.key), ['spheres', 'sticks', 'cartoon', 'surface'],
  'les quatre familles demandées, dans cet ordre');
eq(F.MATERIAL_KIND_OF_REP.spacefill, 'spheres', 'spacefill → Spheres');
eq(F.MATERIAL_KIND_OF_REP.licorice, 'sticks', 'licorice → Bonds');
eq(F.MATERIAL_KIND_OF_REP['ball+stick'], 'sticks', 'ball+stick compte aussi comme des liaisons');
eq(F.MATERIAL_KIND_OF_REP.hyperball, 'sticks', 'hyperball (une variante de liaisons) aussi');
['cartoon', 'ribbon', 'tube', 'trace', 'rope', 'backbone', 'rocket'].forEach((t) => {
  eq(F.MATERIAL_KIND_OF_REP[t], 'cartoon', `${t} → Cartoon`);
});
eq(F.MATERIAL_KIND_OF_REP.surface, 'surface', 'surface → Surface');
eq(F.MATERIAL_KIND_OF_REP.representation, undefined,
  'le type de l’ÉLÉMENT (« representation ») n’est le type d’aucune rep : il ne peut pas être confondu');
eq(F.MATERIAL_PRESETS.auto, null, '« auto » ne demande rien : le matériau de NGL reste');

/* ══ 3. LE RÉGLAGE, EXÉCUTÉ SUR UNE DOUBLURE D'ÉLÉMENT NGL ════════════════
   La doublure a la FORME d'un vrai élément : `name` = type de rep, `type` =
   « representation », `repr` = la représentation enveloppée dont on note les
   setParameters. Aucun geometryList, aucun uniforms : comme dans le navigateur. */
const bench = () => {
  const calls = [];
  const el = (name, opts = {}) => {
    const e = { name, type: 'representation', parameters: {} };
    if (opts.getType) e.getType = () => opts.getType;
    if (opts.noRepr !== true) e.repr = { setParameters: (p) => calls.push({ name, params: p }) };
    return e;
  };
  return { calls, el };
};

const B1 = bench();
F.applyMaterialToRep(B1.el('spacefill'), { preset: 'metallic' });
eq(B1.calls, [{ name: 'spacefill', params: { roughness: 0.18, metalness: 0.85 } }],
  '« metallic » atteint la rep de sphères de CETTE ligne, via setParameters (et rien d’autre)');

const B2 = bench();
F.applyMaterialToRep(B2.el('licorice'), { preset: 'gloss' });
eq(B2.calls[0].params, { roughness: 0.35, metalness: 0.15 }, '…et « gloss » une rep de liaisons');

const B3 = bench();
F.applyMaterialToRep(B3.el('surface'), { preset: 'glass' });
eq(B3.calls[0].params, { roughness: 0.08, metalness: 0, opacity: 0.45 },
  '« glass » ajoute l’opacité : une surface translucide, sans toucher au reste');

// LE MATÉRIAU APPARTIENT À LA LIGNE, plus à une famille de reps : la même valeur
// atteint n’importe quelle rep de cette ligne — et c’est `rep.__sec` (voir §6) qui
// dit de quelle ligne il s’agit, donc deux molécules peuvent en avoir deux.
const B4 = bench();
F.applyMaterialToRep(B4.el('ball+stick'), { preset: 'metallic' });
eq(B4.calls[0].params, { roughness: 0.18, metalness: 0.85 },
  'la même ligne règle ses liaisons exactement comme ses sphères (plus d’indexation par famille)');

const B5 = bench();
F.applyMaterialToRep(B5.el('spacefill'), { preset: 'metallic', roughness: 0.6 });
eq(B5.calls[0].params, { roughness: 0.6, metalness: 0.85 },
  'un curseur déplacé écrase le preset de CETTE ligne');
eq(F.materialValueOf({ preset: 'metallic', roughness: 0.6 }, 'roughness'), 0.6,
  '…materialValueOf relit la valeur du curseur avant le preset');
eq(F.materialValueOf({ preset: 'metallic' }, 'metalness'), 0.85,
  '…et retombe sur la valeur du preset quand le curseur n’a pas bougé');
eq(F.materialValueOf({}, 'metalness'), null,
  'une ligne vierge ne renvoie aucune valeur (donc aucun réglage)');

/* ══ 4. CE QUI NE DOIT RIEN FAIRE ═════════════════════════════════════════ */
const N1 = bench();
F.applyMaterialToRep(N1.el('spacefill'), { preset: 'auto' });
eq(N1.calls.length, 0, '« auto » n’appelle rien : le matériau de NGL (roughness 0.4) reste intact');
const N2 = bench();
F.applyMaterialToRep(N2.el('spacefill'), {});
eq(N2.calls.length, 0, 'une ligne sans preset ni valeur ne touche à rien');
const N3 = bench();
['point', 'line', 'label', 'dot', 'slice'].forEach((t) => {
  F.applyMaterialToRep(N3.el(t), { preset: 'metallic' });
});
eq(N3.calls.length, 0,
  'point / line / label / dot / slice n’ont pas de matériau chez NGL : aucun curseur ne les touche');

/* ══ 5. ROBUSTESSE : rien de ce qui suit ne doit casser le rendu ══════════ */
const R1 = bench();
F.applyMaterialToRep(R1.el('spacefill', { noRepr: true }), { preset: 'metallic' });
eq(R1.calls.length, 0, 'un élément sans représentation enveloppée ne fait pas planter le viewer');
eq(F.repTypeOfElement({ type: 'representation', getType: () => 'cartoon' }), 'cartoon',
  'si NGL cesse un jour de remplir `name`, getType() donne le même type de rep');
eq(F.repTypeOfElement({ type: 'representation' }), '',
  '…et un élément sans l’un ni l’autre ne prétend pas avoir un type de rep');
eq(F.reprOfElement({ name: 'spacefill' }), null, 'sans `repr`, reprOfElement renvoie null (jamais undefined)');
const viaMethod = { name: 'spacefill', getRepresentation: () => ({ setParameters: (p) => { viaMethod.seen = p; } }) };
F.applyMaterialToRep(viaMethod, { preset: 'matte' });
eq(viaMethod.seen, { roughness: 0.95, metalness: 0 }, 'la représentation est trouvée aussi via getRepresentation()');
const R2 = bench();
F.applyMaterialToRep(null, { preset: 'metallic' });
F.applyMaterialToRep(undefined, undefined);
F.applyMaterialToRep(R2.el('spacefill'), null);
F.applyMaterialToRep(R2.el('spacefill'), {});
eq(R2.calls.length, 0, 'appeler sans élément ou sans réglage est sans effet');
const throwing = { name: 'spacefill', repr: { setParameters: () => { throw new Error('boom'); } } };
F.applyMaterialToRep(throwing, { preset: 'metallic' });
ok(true, 'une rep qui refuse setParameters est avalée : jamais une exception dans la boucle de rendu');

/* ══ CANARI — la forme d'hier ne réglait vraiment RIEN ════════════════════
   L'implémentation d'avant, rejouée telle quelle sur la MÊME doublure : elle
   cherche un geometryList que l'élément n'a pas, donc elle ressort sans avoir
   rien touché. Si ce canari devenait efficace, c'est la suite qui ne mesurerait
   plus le bon objet. */
const oldApply = (el) => {
  const list = el.geometryList || el.geoList || (el.geometry ? [el.geometry] : []);
  if (!Array.isArray(list)) return 0;
  let touched = 0;
  list.forEach((g) => {
    const uniforms = g && g.material && g.material.uniforms;
    if (!uniforms) return;
    if (uniforms.roughness) { uniforms.roughness.value = 0.18; touched += 1; }
  });
  return touched;
};
eq(oldApply(bench().el('spacefill')), 0,
  'le canari est vivant : l’ancienne marche par geometryList ne touchait rien du tout sur un élément');

/* ══ 6. LA SOURCE DU VIEWER : le bug ne peut pas revenir ══════════════════ */
gone('eachGeometryOfRep', 'la marche par géométries a disparu du viewer');
gone('uniforms.roughness.value', '…et plus aucun uniform three.js n’est réglé à la main');
gone('const type = String(rep.name || rep.type', 'l’ancienne lecture du type (element.type d’abord) a disparu');
has('MATERIAL_KIND_OF_REP[repTypeOfElement(el)]', 'la famille est choisie sur le TYPE DE REP de l’élément');
has('repr.setParameters(params)', 'le matériau passe par l’API de NGL — donc en place, sans rebuild');
has('NGL 2.4 HAS a material', 'la documentation dit maintenant la vérité');
gone('NGL 2.4 has no material parameter', '…la phrase fausse (« NGL n’a pas de paramètre de matériau ») est partie');
has("roughness: { type: 'range'", 'le commentaire cite la VRAIE déclaration de NGL');
has("NGL's own material parameters", 'la bulle de l’interface dit la même vérité que le code');
has('_viewer_materials_test.mjs', 'le viewer nomme le garde-fou qui surveille ces types de reps');

/* ── 6bis. LE MATÉRIAU EST CELUI D'UNE LIGNE DE STYLING ───────────────────
   Demande : « they should be in each subsection of styling window because not
   all the molecules might be represented with the same material ». Le réglage
   n'est donc plus un panneau GLOBAL en bas de la barre Selections : il vit dans
   le look de CHAQUE ligne de la fenêtre « Molecules · styling » (donc de chaque
   molécule ET de chaque partie), il suit la ligne General comme les autres
   champs, il est persisté avec eux, et le rendu l'applique ligne par ligne — la
   rep sait de quelle ligne elle vient (`rep.__sec`). */
eq(F.MATERIAL_PRESET_KEYS, ['auto', 'matte', 'gloss', 'metallic', 'glass'],
  'le menu d’une ligne propose les cinq presets, dans l’ordre de MATERIAL_PRESETS');
has("material: 'auto',", 'le look d’une ligne part de « auto » : le matériau de NGL reste intact');
has("includes(entry.material)) dst.material = entry.material;",
  'la persistance n’accepte qu’un preset CONNU (un localStorage bricolé ne peut rien changer)');
has('material: g.material,', 'le matériau descend de General comme la transparence et les rayons');
has('if (el) el.__sec = { id: sec.id, kind: sec.kind, sub: spec.sub };',
  'chaque rep retient LA LIGNE qu’elle dessine (molécule + partie)');
has('const where = rep && rep.__sec;', 'le matériau est appliqué ligne par ligne — deux molécules, deux matériaux');
has('applyMaterialToRep(rep, { preset: look.material, roughness: look.roughness, metalness: look.metalness });',
  '…en relisant le look COURANT de cette ligne');
has("auto = NGL's own rough surface (0.40 / 0.00)", 'la ligne de styling porte le contrôle 🎛 et sa bulle');
has('const lookMatValue = (look, prop) => {', 'les deux curseurs montrent la valeur RÉELLE (preset ou curseur déplacé)');
gone('const [matSettings, setMatSettings] = useState(',
  'le réglage GLOBAL a disparu : c’est lui qui empêchait deux molécules d’avoir deux matériaux');
gone('🎛 Material', '…et son panneau en bas de la barre Selections avec lui');
gone('localStorage.setItem(MATERIALS_KEY', '…ainsi que sa clé de persistance propre (le matériau est dans le look)');
gone('matSliderValue', 'aucun reliquat du réglage global ne subsiste');

/* ── 6ter. LES LIGNES DE LA BARRE SELECTIONS : le matériau DE CE QU'ELLES
   DESSINENT. Une ligne de cette barre peut dessiner PLUSIEURS familles (sphères
   ET bâtons, cartoon…), et un matériau appartient à une famille de
   représentations : l'utilisateur a donné l'exemple — « supposons qu'une ligne
   est le peptide ; si je le dessine en cartoon, je veux pouvoir choisir le
   matériau du cartoon ». La barre offre donc un 🎛 PAR FAMILLE RÉELLEMENT
   DESSINÉE, dérivée des styles actifs avec la MÊME table que le rendu. */
eq(F.selRowFamilies({ cartoon: true }), ['cartoon'],
  'une ligne dessinée en cartoon n’offre QUE le matériau du cartoon (l’exemple)');
eq(F.selRowFamilies({ sphere: true, stick: true }), ['spheres', 'sticks'],
  'les sphères ET les bâtons : deux matériaux, un par famille');
eq(F.selRowFamilies({ sphere: true, cartoon: true, surface: true }), ['cartoon', 'spheres', 'surface'],
  '…dans l’ordre du rendu (cartoon · ribbon · tube · sphères · bâtons · surface)');
eq(F.selRowFamilies({ ball: true }), ['sticks'], 'ball+stick est une rep de liaisons (la même famille que licorice)');
eq(F.selRowFamilies({ ribbon: true, tube: true }), ['cartoon'],
  'ribbon et tube dessinent la MÊME famille : un seul contrôle, pas deux');
eq(F.selRowFamilies({}), [], 'aucun style dessiné → aucun contrôle de matériau');
eq(F.selRowFamilies(null), [], '…et une ligne sans état ne casse rien');
eq(Object.keys(F.SEL_STYLE_REP_TYPE).sort(),
  ['ball', 'cartoon', 'ribbon', 'sphere', 'stick', 'surface', 'tube'].sort(),
  'la table des styles couvre EXACTEMENT les styles que le rendu de la ligne ajoute');
has('if (el) { el.__sel = { key, style }; reps.push(el); }',
  'chaque rep d’une ligne Selections retient sa LIGNE et son STYLE');
has('const sel = rep && rep.__sel;', '…et le rendu du matériau la retrouve');
has('const rowMat = (selStylesRef.current[sel.key] || {}).mat;',
  'le matériau cherché est celui de CETTE ligne');
has('const setSelMaterial = (key, fam, field, value) => {',
  'la barre écrit le matériau de la famille (un adaptateur dédié aux deux barres)');
has('[key]: { ...cur, mat: { ...mat, [fam]: { ...(mat[fam] || {}), [field]: value } } },',
  '…sans toucher aux autres familles ni aux autres lignes');
has('{families.map((fam) => {', '…un contrôle par famille réellement dessinée');
has('families: selRowFamilies(st),', '…les familles étant celles que la ligne dessine');

/* ── Bilan ──────────────────────────────────────────────────────────────── */
console.log(`_viewer_materials_test.mjs — ${passed} assertions OK`);



