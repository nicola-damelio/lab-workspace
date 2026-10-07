/* =========================================================================
   _bench_pairs.mjs — COMBIEN COÛTE LA MARCHE DES COUPLES, ET QUE COÛTERAIT
   UNE PEAU (le correctif du pas de 180° : voir `structureCalc.js`).

   La marche des couples (`ffPairListOf`) est refaite à chaque « core refresh » et
   ses couples SONT le coût chaud d'un pas : `crossingOf` les filtre par charnière,
   puis la boucle lit `gap()` + le terme pour chacun. Élargir la portée (une PEAU
   qui couvre le déplacement d'un pas) élargit donc la liste, et c'est ce prix-là
   qu'il faut connaître AVANT de choisir la peau.

   Run: node _bench_pairs.mjs
   ========================================================================= */
import { ffPairListOf } from './src/utils/forceFieldKcal.js';

const rnd = (() => { let s = 12345; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; })();

/** UNE CHAÎNE « PROTÉIQUE » — 120 atomes lourds sur une marche aléatoire de pas 3.8 Å. */
const chainOf = (n) => {
  const positions = []; const elements = []; const bonds = [];
  let p = [0, 0, 0];
  for (let i = 0; i < n; i += 1) {
    positions.push(p[0], p[1], p[2]);
    elements.push(i % 3 === 0 ? 'C' : (i % 3 === 1 ? 'N' : 'O'));
    if (i) bonds.push({ i: i - 1, j: i });
    const th = rnd() * Math.PI * 2; const ph = rnd() * Math.PI * 2;
    p = [p[0] + 3.8 * Math.sin(th) * Math.cos(ph), p[1] + 3.8 * Math.sin(th) * Math.sin(ph),
      p[2] + 3.8 * Math.cos(th)];
  }
  return { positions, elements, bonds };
};

/** UNE BOÎTE « EAU » — `n` atomes dans un cube de 30 Å (0.1 atome/Å³, la densité de l'eau). */
const boxOf = (n) => {
  const positions = []; const elements = [];
  for (let i = 0; i < n; i += 1) {
    positions.push(rnd() * 30, rnd() * 30, rnd() * 30);
    elements.push(i % 3 === 0 ? 'O' : 'H');
  }
  return { positions, elements, bonds: [] };
};

const timeOf = (fn, reps = 5) => {
  fn(); // chauffe
  const t0 = process.hrtime.bigint();
  for (let k = 0; k < reps; k += 1) fn();
  return Number(process.hrtime.bigint() - t0) / 1e6 / reps;
};

const REPORT = [['chaîne 120 atomes', chainOf(120)], ['boîte 2700 atomes', boxOf(2700)]];
for (const [label, mol] of REPORT) {
  console.log(`\n── ${label} ─────────────────────────────────────────────`);
  for (const limit of [3.5, 5, 6.5, 8, 11.5]) {
    const walk = ffPairListOf({ ...mol, limit, surface: false });
    const ms = timeOf(() => ffPairListOf({ ...mol, limit, surface: false }));
    /* LE COÛT CHAUD — `crossingOf` + un `gap()` par couple qui traverse (comme un pas). */
    const moving = new Set(Array.from({ length: 60 }, (_, k) => k * 2));
    const msCross = timeOf(() => {
      const sub = walk.pairs.filter((p) => moving.has(p.i) !== moving.has(p.j));
      let v = 0;
      for (const p of sub) v += p.rmin;
      return v;
    }, 20);
    console.log(`  portée ${String(limit).padStart(4)} Å : ${String(walk.pairs.length).padStart(7)} couples`
      + ` · marche ${ms.toFixed(2)} ms · traversée+somme ${msCross.toFixed(3)} ms`);
  }
}
console.log('\n(la « traversée » compte les couples d’une charnière de 60 atomes — le coût chaud d’un pas réel)');

/* ── OÙ PASSE LE TEMPS D'UNE MARCHE — l'A/B qui décide du correctif ────────────────
   Si la TOPOLOGIE (`bonds`, les voisins jusqu'à trois liaisons) porte l'essentiel du
   prix, une marche d'essai est abordable à CHAQUE pas (sa partie fixe se garde) ; si
   c'est la liste elle-même, seule une PEAU (portée élargie) est payable. */
console.log('\n── DÉCOMPOSITION D’UNE MARCHE (portée 3.5 Å, la cible DYANA) ───────────────');
for (const [label, mol] of REPORT) {
  const full = timeOf(() => ffPairListOf({ ...mol, limit: 3.5, surface: false }));
  const noBonds = timeOf(() => ffPairListOf({ ...mol, bonds: [], limit: 3.5, surface: false }));
  const noEls = timeOf(() => ffPairListOf({ ...mol, bonds: [], elements: [], limit: 3.5, surface: false }));
  const withSurface = timeOf(() => ffPairListOf({ ...mol, limit: 3.5, surface: true }));
  console.log(`  ${label} : complet ${full.toFixed(2)} ms · sans la topologie ${noBonds.toFixed(2)} ms`
    + ` · sans éléments ni topologie ${noEls.toFixed(2)} ms · avec la liste de surface ${withSurface.toFixed(2)} ms`);
}
console.log('(l’écart « complet → sans la topologie » est le prix FIXE, identique à chaque marche)');
