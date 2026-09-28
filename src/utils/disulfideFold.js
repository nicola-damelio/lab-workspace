/* ============================================================================
   src/utils/disulfideFold.js
   « ⚭ Fold for disulfides » — LA DÉFORMATION QUI RÉUNIT DEUX Sγ À 2.05 Å.

   Ce que le bouton du viewer demande, et ce que ce module fait : prendre les
   torsions du modèle idéal fabriqué par la page (buildProteinBackbone de
   NMRSections.jsx) et les DÉTENDRE jusqu'à ce que chaque pont disulfure défini
   dans « Cysteine states » puisse se fermer — c'est-à-dire jusqu'à ce que les
   deux atomes de soufre Sγ de la paire soient à une distance de LIAISON
   (2.05 Å, la longueur S–S d'un pont réel).

   ⚠ CECI N'EST PAS UN REPLIEMENT PHYSIQUE. Il n'y a ici aucune énergie, aucun
   solvant, aucun empilement de chaînes latérales, aucun hydrogène : seulement
   une contrainte de distance sur les Sγ, une répulsion grossière pour que la
   chaîne ne se traverse pas, et une recherche locale DÉTERMINISTE (graine
   fixe) sur

     • les φ / ψ des résidus « mobiles » — ceux qui séparent les deux Cys d'une
       paire ; la fenêtre est BORNÉE (MAX_MOVABLE_RESIDUES) parce qu'un pont
       entre deux Cys très éloignées ferait sinon bouger la protéine entière ;
     • le χ1 des deux Cys de chaque paire, choisi parmi les TROIS rotamères
       décalés (−60°, +60°, 180°) : un χ1 continu serait plus facile à
       optimiser mais ne serait plus une conformation de cystéine.

   Ce que le module ne cache pas : quand la fenêtre déplacée ne suffit pas à
   réunir les deux Sγ, il rend `converged: false`, les MEILLEURES torsions
   trouvées — jamais pires que celles du départ — et la distance RÉELLEMENT
   obtenue, que la page écrit au spectateur (message du viewer). La liaison
   reste dessinée même non fermée (CONECT SG–SG écrit par
   proteinSequenceToPdbText).

   Module PUR (aucun import) : la géométrie est INJECTÉE (`sgPositions`), donc
   le test peut la remplacer par une chaîne jouet, et la page par le vrai
   constructeur NeRF. Aucune fonction d'ici ne modifie ses arguments.
   ========================================================================= */

export const SS_BOND_LENGTH = 2.05;            // Å — le S–S d'un pont réel
export const SS_BOND_TOLERANCE = 0.35;         // Å — « le pont peut se fermer »
export const SS_CLASH_MIN = 3.2;               // Å — répulsion Sγ ↔ Cα
export const MAX_MOVABLE_RESIDUES = 40;        // bornes de la fenêtre détendue
export const CHI1_ROTAMERS = [-60, 60, 180];   // degrés — g−, g+, trans
export const DEFAULT_FOLD_SEED = 0x9e3779b9;   // graine fixe : résultat stable
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// Générateur déterministe (mulberry32) : le MÊME modèle donne toujours le MÊME
// repliement, sinon un test ne pourrait rien affirmer et l'écran changerait à
// chaque clic.
const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const wrapPi = (x) => {
  let v = x;
  while (v > Math.PI) v -= TAU;
  while (v < -Math.PI) v += TAU;
  return v;
};

const dist3 = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);


/* Les résidus que la détente a le droit de bouger : la chaîne ENTRE les deux
   Cys d'une paire (φ/ψ du premier Cys vers l'aval : c'est ce qui referme la
   boucle), plus `margin` résidus après le second, le tout plafonné par
   `max / nombre de paires` — au-delà, la fenêtre ne veut plus rien dire et le
   calcul devient trop long pour un bouton. Les indices rendus sont 0-based. */
export const movableResiduesFor = (pairs, n, { margin = 2, max = MAX_MOVABLE_RESIDUES } = {}) => {
  const list = (Array.isArray(pairs) ? pairs : []).filter((p) => Array.isArray(p) && p.length === 2);
  if (!list.length || !(n > 0)) return [];
  const cap = Math.max(4, Math.ceil(max / list.length));
  const out = [];
  list.forEach(([a, b]) => {
    const lo = Math.max(1, Math.min(a, b));
    const hi = Math.max(a, b);
    const end = Math.min(n, lo + Math.min(hi - lo + margin, cap));
    for (let p = lo; p <= end; p++) if (!out.includes(p - 1)) out.push(p - 1);
  });
  return out.sort((x, y) => x - y);
};

/* L'ÉNERGIE, telle qu'elle est : (distance Sγ–Sγ − 2.05)² pour chaque pont,
   plus une répulsion carrée sous SS_CLASH_MIN entre un Sγ et les Cα qui ne
   sont pas ses voisins de séquence (le Sγ est à ~3.1 Å de son propre Cα — une
   distance normale, qui ne doit pas compter comme un choc), plus la même
   répulsion entre les Sγ de ponts différents. `model` = ce que rend
   `sgPositions(torsions)` : { sg: ([x,y,z]|null)[], ca: [x,y,z][] }. */
export const scoreFold = ({
  pairs, model, bondLength = SS_BOND_LENGTH, clashMin = SS_CLASH_MIN, clashWeight = 1,
}) => {
  const sg = (model && model.sg) || [];
  const ca = (model && model.ca) || [];
  const list = (Array.isArray(pairs) ? pairs : []).filter((p) => Array.isArray(p) && p.length === 2);
  let score = 0;
  const sgOf = (pos) => (pos >= 1 && pos <= sg.length ? sg[pos - 1] : null);
  list.forEach(([a, b]) => {
    const A = sgOf(a); const B = sgOf(b);
    if (!A || !B) return;
    const d = dist3(A, B);
    score += (d - bondLength) * (d - bondLength);
  });
  list.forEach(([a]) => {
    const A = sgOf(a);
    if (!A) return;
    for (let j = 0; j < ca.length; j++) {
      if (Math.abs(j - (a - 1)) <= 2) continue;
      const c = ca[j];
      if (!c) continue;
      const d = dist3(A, c);
      if (d < clashMin) score += clashWeight * (clashMin - d) * (clashMin - d);
    }
  });
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const sgs = [sgOf(list[i][0]), sgOf(list[i][1]), sgOf(list[j][0]), sgOf(list[j][1])].filter(Boolean);
      for (let x = 0; x < sgs.length; x++) {
        for (let y = x + 1; y < sgs.length; y++) {
          const d = dist3(sgs[x], sgs[y]);
          if (d < clashMin) score += clashWeight * (clashMin - d) * (clashMin - d);
        }
      }
    }
  }
  return score;
};

/* LE REPLIEMENT DEMANDÉ PAR LE BOUTON. Entrées :
     torsions     — [{ phi, psi, chi1 }] en RADIANS, un objet par résidu ;
     pairs        — [[posA, posB], …] en POSITIONS DE SÉQUENCE 1-based ;
     sgPositions  — (torsions) => { sg, ca } : la géométrie, INJECTÉE (la page
                    y met le vrai constructeur NeRF + placeSidechainAtoms) ;
     movable      — indices 0-based à détendre (défaut : movableResiduesFor).
   Sortie :
     { torsions, pairs: [{ a, b, distance, bonded }], converged, moved,
       evaluations, reason }
   `converged` = TOUS les ponts sont à SS_BOND_TOLERANCE de 2.05 Å. Sinon les
   torsions rendues sont celles du MEILLEUR essai (jamais autre chose), et
   `pairs[].distance` porte la distance réellement obtenue — c'est elle que la
   page écrit à l'écran. Les objets reçus ne sont jamais modifiés. */
export const foldProteinForDisulfides = ({
  torsions, pairs, sgPositions,
  movable = null, seed = DEFAULT_FOLD_SEED,
  restarts = 6, passes = 90, maxStepDeg = 28, minStepDeg = 2,
} = {}) => {
  const n = Array.isArray(torsions) ? torsions.length : 0;
  const input = (Array.isArray(torsions) ? torsions : []).map((t) => ({
    phi: wrapPi(Number.isFinite(t && t.phi) ? t.phi : Math.PI),
    psi: wrapPi(Number.isFinite(t && t.psi) ? t.psi : Math.PI),
    chi1: wrapPi(Number.isFinite(t && t.chi1) ? t.chi1 : CHI1_ROTAMERS[0] * DEG),
  }));
  const list = (Array.isArray(pairs) ? pairs : [])
    .filter((p) => Array.isArray(p) && p.length === 2 && Number.isInteger(p[0]) && Number.isInteger(p[1]))
    .filter((p) => p[0] >= 1 && p[0] <= n && p[1] >= 1 && p[1] <= n && p[0] !== p[1]);
  const moved = Array.isArray(movable)
    ? movable.filter((i) => Number.isInteger(i) && i >= 0 && i < n)
    : movableResiduesFor(list, n);

  const modelOf = (cand) => (typeof sgPositions === 'function' ? sgPositions(cand) : null);
  const reportOf = (cand) => {
    const model = modelOf(cand);
    const sg = (model && model.sg) || [];
    return list.map(([a, b]) => {
      const A = sg[a - 1]; const B = sg[b - 1];
      const d = A && B ? dist3(A, B) : null;
      return { a, b, distance: d, bonded: d !== null && Math.abs(d - SS_BOND_LENGTH) <= SS_BOND_TOLERANCE };
    });
  };
  const convergedNow = (rep) => rep.length > 0 && rep.every((p) => p.bonded);
  if (!n || !list.length || typeof sgPositions !== 'function') {
    const reason = (typeof sgPositions !== 'function' || !n) ? 'no-model' : 'no-pair';
    return { torsions: input, pairs: reportOf(input), converged: false, moved, evaluations: 0, reason };
  }
  const initial = reportOf(input);
  if (convergedNow(initial)) {
    return { torsions: input, pairs: initial, converged: true, moved, evaluations: 0, reason: 'already-bonded' };
  }

  const rnd = mulberry32(seed);
  const stepAt = (prog) => (maxStepDeg + (minStepDeg - maxStepDeg) * prog) * DEG;
  let evaluations = 0;
  const evaluate = (cand) => { evaluations += 1; return scoreFold({ pairs: list, model: modelOf(cand) }); };

  let best = input.map((t) => ({ ...t }));
  let bestScore = evaluate(best);
  let bestReport = reportOf(best);
  const pickMovable = () => (moved.length ? moved[Math.floor(rnd() * moved.length)] : 0);

  for (let r = 0; r < restarts; r++) {
    let cur = best.map((t) => ({ ...t }));
    if (r > 0) {
      /* Un « coup de pied » : la descente est gloutonne, donc chaque essai
         rejouerait exactement le même chemin et les redémarrages ne
         serviraient à rien. Quelques torsions tirées repartent ailleurs. */
      const kicks = 1 + Math.floor(rnd() * Math.min(6, Math.max(1, moved.length)));
      for (let k = 0; k < kicks; k++) {
        const i = pickMovable();
        const key = rnd() < 0.5 ? 'phi' : 'psi';
        cur[i][key] = wrapPi(cur[i][key] + (rnd() - 0.5) * 90 * DEG);
      }
    }
    let curScore = evaluate(cur);
    for (let p = 0; p < passes; p++) {
      const step = stepAt(passes > 1 ? p / (passes - 1) : 1);
      const i = pickMovable();
      const cand = cur.map((t) => ({ ...t }));      // copie : rien n'est muté en place
      if (rnd() < 0.25) {
        cand[i].chi1 = CHI1_ROTAMERS[Math.floor(rnd() * CHI1_ROTAMERS.length)] * DEG;
      } else {
        const key = rnd() < 0.5 ? 'phi' : 'psi';
        const g = (rnd() + rnd() + rnd() - 1.5) / 1.5;   // ~gaussienne bornée
        cand[i][key] = wrapPi(cand[i][key] + g * step);
      }
      const s = evaluate(cand);
      if (s < curScore) { cur = cand; curScore = s; }
      if (curScore < bestScore) {
        best = cur; bestScore = curScore; bestReport = reportOf(best);
        if (convergedNow(bestReport)) {
          return { torsions: best, pairs: bestReport, converged: true, moved, evaluations, reason: 'converged' };
        }
      }
    }
  }
  return { torsions: best, pairs: bestReport, converged: convergedNow(bestReport), moved, evaluations, reason: 'best-effort' };
};

