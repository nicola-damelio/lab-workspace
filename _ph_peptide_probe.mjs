/* SONDE (jetable) — LE CHEMIN DU PANNEAU, EN VRAI : le peptide du rapport, bâti par la page,
   chargé dans NGL, lu par `geometryOfStructure` (elements + bondStore) et chargé par
   `partialChargesOf({ elements, bonds, ph: 7 })`. On rejoue AUSSI l'ancienne règle sur le
   MÊME graphe pour prouver qu'elle y comptait bien 34 ammoniums. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { partialChargesOf } from './src/utils/forceFieldKcal.js';
import { bondGraphOf } from './src/utils/geometryRelax.js';

const require = createRequire(import.meta.url);
const NGL = require('ngl');
if (typeof globalThis.FileReader !== 'function') {
  globalThis.FileReader = class {
    readAsText(blob) {
      Promise.resolve(blob.text()).then((text) => {
        this.result = text;
        if (typeof this.onload === 'function') this.onload({ target: this });
      });
    }
  };
}

const src = readFileSync('src/components/NMRSections.jsx', 'utf8');
const extract = (name) => {
  const start = src.indexOf(`const ${name} = `);
  if (start === -1) throw new Error('missing ' + name);
  const bodyStart = start + `const ${name} = `.length;
  let depth = 0; let i = bodyStart;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (ch === ';' && depth === 0) break;
  }
  return src.slice(start, i + 1) + '\n';
};
const order = ['_vecSub', '_vecAdd', '_vecScale', '_vecDot', '_vecCross', '_vecNorm', '_vecNormalize',
  '_deg2rad', 'nerfPlace', '_padLeft', '_padRight', '_formatAtomName', '_fmtNum', 'pdbAtomLine',
  'AA_1_TO_3', 'PROTEIN_BB', 'SS_TORSIONS', 'ssTorsionAt', '_ringClose', 'placeSidechainAtoms',
  'buildProteinBackbone', 'buildProteinHCoords', 'proteinSequenceToPdbText'];
let code = '';
order.forEach((n) => { code += extract(n); });
const { proteinSequenceToPdbText } = new Function(code + '\nreturn { proteinSequenceToPdbText };')();

const SEQ = 'SIIGIIMGILGNIPQVIQIIMSIVKAFKGNK';
const pdb = proteinSequenceToPdbText(SEQ, '');
const ss = await NGL.autoLoad(new Blob([pdb], { type: 'text/plain' }), { ext: 'pdb' });

/* LA LECTURE DU PANNEAU — `geometryOfStructure` recopiée ligne pour ligne. */
const count = ss.atomStore.count;
const ap = ss.getAtomProxy();
const elements = new Array(count);
for (let i = 0; i < count; i += 1) { ap.index = i; elements[i] = ap.element; }
const bonds = [];
const store = ss.bondStore;
for (let k = 0; k < store.count; k += 1) {
  const i = Number(store.atomIndex1[k]); const j = Number(store.atomIndex2[k]);
  if (!Number.isInteger(i) || !Number.isInteger(j) || i === j) continue;
  bonds.push({ i, j, order: store.bondOrder ? Number(store.bondOrder[k]) || 1 : 1 });
}
const graph = bondGraphOf({ bonds, atomCount: count });
const nAtoms = elements.filter((e) => e === 'N').length;
const nH = elements.filter((e) => e === 'H').length;
console.log(`atomes ${count} (${nH} H, ${nAtoms} N) · liaisons NGL ${bonds.length}`);

/* L'ANCIENNE RÈGLE, REJOUÉE SUR CE GRAPHE-LÀ. */
let oldRule = 0; const oldNames = [];
for (let k = 0; k < count; k += 1) {
  if (elements[k] !== 'N') continue;
  const nbs = graph.neighbours(k);
  const heavy = nbs.filter((m) => elements[m] !== 'H');
  const h = nbs.length - heavy.length;
  if (heavy.length + h >= 4 && h >= 1) { oldRule += 1; oldNames.push(`${k}(h${h}/hv${heavy.length})`); }
}
console.log(`ANCIENNE RÈGLE sur le graphe réel : ${oldRule} ammoniums  ${oldNames.join(' ')}`);

/* ET LE PANNEAU, TEL QUEL. */
const q = partialChargesOf({ elements, bonds, ph: 7 });
console.log(`PANNEAU pH 7 : nette ${q.net} e · méthode ${q.method} · `
  + `${q.ionisation.groups.filter((g) => g.factor > 1e-6).length}/${q.ionisation.groups.length} titrées`);
console.log(`  groupes formels : ${q.groups.map((g) => g.name).join(', ') || '—'}`);
q.ionisable.forEach((g) => console.log(`  titrable ${g.name} (${g.atoms.join('-')}) pKa ${g.pka} `
  + `facteur ${Number(g.factor).toFixed(4)}`));
const noPh = partialChargesOf({ elements, bonds, ph: null });
console.log(`PANNEAU sans pH : nette ${noPh.net} e · méthode ${noPh.method} · ${noPh.ionisable.length} titrables`);

/* ── LES AUTRES CHEMINS QUI LISENT LA MÊME MOLÉCULE ─────────────────────────────────────
   Le moteur (▶ Run, ▶ MD, ⚒, ⟳) passe par `hydrogenatedOf` : ses hydrogènes sont REPOSÉS à
   leur géométrie idéale. On regarde donc aussi ce graphe-là, et le graphe nettoyé par la
   règle des H (`enforceOneHeavyBondPerHydrogen`), tous deux sous l'ANCIENNE règle. */
const { hydrogenatedOf } = await import('./src/utils/forceFieldKcal.js');
const { enforceOneHeavyBondPerHydrogen } = await import('./src/utils/hydrogenBondRule.js');
const positions = new Array(count * 3);
for (let i = 0; i < count; i += 1) { ap.index = i; positions[i * 3] = ap.x; positions[i * 3 + 1] = ap.y; positions[i * 3 + 2] = ap.z; }
const hyd = hydrogenatedOf({ elements, positions, bonds });
const rawAtoms = elements.map((e, k) => ({ element: e, x: positions[k * 3], y: positions[k * 3 + 1], z: positions[k * 3 + 2] }));
const filtered = enforceOneHeavyBondPerHydrogen(rawAtoms, bonds);
const variants = [
  ['NGL brut', elements, bonds],
  ['NGL + règle des H', elements, filtered.length ? filtered.map((b) => (Array.isArray(b) ? { i: b[0], j: b[1], order: 1 } : b)) : bonds],
  ['hydrogéné (moteur)', hyd.elements, hyd.bonds],
];
for (const [label, els, bs] of variants) {
  const g = bondGraphOf({ bonds: bs, atomCount: els.length });
  let old = 0; let neu = 0;
  for (let k = 0; k < els.length; k += 1) {
    if (els[k] !== 'N') continue;
    const nbs = g.neighbours(k);
    const heavy = nbs.filter((m) => els[m] !== 'H');
    const h = nbs.length - heavy.length;
    if (heavy.length + h >= 4 && h >= 1) old += 1;
    const amide = heavy.some((m) => els[m] === 'C' && g.neighbours(m).some((o) => els[o] === 'O'));
    if (!amide && h >= 2 && heavy.length <= 2) neu += 1;
  }
  const r = partialChargesOf({ elements: els, bonds: bs, ph: 7 });
  console.log(`${label.padEnd(20)} : ${els.length} atomes · ANCIENNE ${old} ammoniums · NOUVELLE ${neu} · `
    + `panneau ${r.net.toFixed(2)} e (${r.ionisation.groups.length} titrables)`);
}
