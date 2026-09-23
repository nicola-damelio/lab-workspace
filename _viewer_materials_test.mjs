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
  extract(VIEW, 'MATERIAL_KINDS'),
  extract(VIEW, 'MATERIAL_KIND_OF_REP'),
  extract(VIEW, 'materialValueOf'),
  extract(VIEW, 'reprOfElement'),
  extract(VIEW, 'repTypeOfElement'),
  extract(VIEW, 'applyMaterialToRep'),
].join('\n');
const F = new Function(`${CODE}
  return { MATERIAL_PRESETS, MATERIAL_KINDS, MATERIAL_KIND_OF_REP, materialValueOf,
    reprOfElement, repTypeOfElement, applyMaterialToRep };`)();

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
F.applyMaterialToRep(B1.el('spacefill'), { spheres: { preset: 'metallic' } });
eq(B1.calls, [{ name: 'spacefill', params: { roughness: 0.18, metalness: 0.85 } }],
  '« metallic » atteint la rep des sphères, via setParameters (et rien d’autre)');

const B2 = bench();
F.applyMaterialToRep(B2.el('licorice'), { sticks: { preset: 'gloss' } });
eq(B2.calls[0].params, { roughness: 0.35, metalness: 0.15 }, '…et « gloss » une rep de liaisons');

const B3 = bench();
F.applyMaterialToRep(B3.el('surface'), { surface: { preset: 'glass' } });
eq(B3.calls[0].params, { roughness: 0.08, metalness: 0, opacity: 0.45 },
  '« glass » ajoute l’opacité : une surface translucide, sans toucher au reste');

const B4 = bench();
F.applyMaterialToRep(B4.el('ball+stick'), { spheres: { preset: 'metallic' } });
eq(B4.calls.length, 0, 'une famille ne déborde jamais sur une autre (metallic des sphères ne touche pas les liaisons)');

const B5 = bench();
F.applyMaterialToRep(B5.el('spacefill'), { spheres: { preset: 'metallic', roughness: 0.6 } });
eq(B5.calls[0].params, { roughness: 0.6, metalness: 0.85 },
  'un curseur déplacé écrase le preset de SA famille, et seulement lui');
eq(F.materialValueOf({ spheres: { preset: 'metallic', roughness: 0.6 }, sticks: { preset: 'gloss' } }, 'sticks', 'roughness'),
  0.35, '…les autres familles gardent leur preset');
eq(F.materialValueOf({ spheres: {} }, 'spheres', 'metalness'), null,
  'une famille vierge ne renvoie aucune valeur (donc aucun réglage)');

/* ══ 4. CE QUI NE DOIT RIEN FAIRE ═════════════════════════════════════════ */
const N1 = bench();
F.applyMaterialToRep(N1.el('spacefill'), { spheres: { preset: 'auto' } });
eq(N1.calls.length, 0, '« auto » n’appelle rien : le matériau de NGL (roughness 0.4) reste intact');
const N2 = bench();
F.applyMaterialToRep(N2.el('spacefill'), { spheres: {} });
eq(N2.calls.length, 0, 'une famille sans preset ni valeur ne touche à rien');
const N3 = bench();
['point', 'line', 'label', 'dot', 'slice'].forEach((t) => {
  F.applyMaterialToRep(N3.el(t), { spheres: { preset: 'metallic' }, sticks: { preset: 'metallic' }, cartoon: { preset: 'metallic' }, surface: { preset: 'metallic' } });
});
eq(N3.calls.length, 0,
  'point / line / label / dot / slice n’ont pas de matériau chez NGL : aucun curseur ne les touche');

/* ══ 5. ROBUSTESSE : rien de ce qui suit ne doit casser le rendu ══════════ */
const R1 = bench();
F.applyMaterialToRep(R1.el('spacefill', { noRepr: true }), { spheres: { preset: 'metallic' } });
eq(R1.calls.length, 0, 'un élément sans représentation enveloppée ne fait pas planter le viewer');
eq(F.repTypeOfElement({ type: 'representation', getType: () => 'cartoon' }), 'cartoon',
  'si NGL cesse un jour de remplir `name`, getType() donne le même type de rep');
eq(F.repTypeOfElement({ type: 'representation' }), '',
  '…et un élément sans l’un ni l’autre ne prétend pas avoir un type de rep');
eq(F.reprOfElement({ name: 'spacefill' }), null, 'sans `repr`, reprOfElement renvoie null (jamais undefined)');
const viaMethod = { name: 'spacefill', getRepresentation: () => ({ setParameters: (p) => { viaMethod.seen = p; } }) };
F.applyMaterialToRep(viaMethod, { spheres: { preset: 'matte' } });
eq(viaMethod.seen, { roughness: 0.95, metalness: 0 }, 'la représentation est trouvée aussi via getRepresentation()');
const R2 = bench();
F.applyMaterialToRep(null, { spheres: { preset: 'metallic' } });
F.applyMaterialToRep(undefined, undefined);
F.applyMaterialToRep(R2.el('spacefill'), null);
F.applyMaterialToRep(R2.el('spacefill'), {});
eq(R2.calls.length, 0, 'appeler sans élément ou sans réglage est sans effet');
const throwing = { name: 'spacefill', repr: { setParameters: () => { throw new Error('boom'); } } };
F.applyMaterialToRep(throwing, { spheres: { preset: 'metallic' } });
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

/* ── Bilan ──────────────────────────────────────────────────────────────── */
console.log(`_viewer_materials_test.mjs — ${passed} assertions OK`);



