/* ============================================================================
   src/utils/betaSheetFold.js
   🧵 « β-sheet » — APPARIER DES BRINS β DÉCLARÉS DANS LA DÉFINITION DE SÉQUENCE.

   La demande, mot pour mot : « In the sequence definition, beyond, alpha helix
   right and left, coil and beta strands, add the possibility to impose turns and
   to associate beta strands to make a beta sheet, parallel or antiparallel. »

   Ce module EST la seconde moitié de cette demande. La définition de séquence
   peint une lettre par résidu (C · H · L · E · T — voir SS_META et SS_TORSIONS) ;
   elle ne dit rien de la façon dont deux brins de feuillet SE REGARDENT. Deux
   segments peints E dans la même chaîne sortent du bâtisseur côte à côte dans
   l'espace seulement quand la boucle qui les sépare se trouve être, par hasard,
   une épingle : deux brins E séparés par trois pelotes donnent deux épingles
   CÔTE À CÔTE, pas un feuillet. C'est pourquoi la déclaration « ces deux brins
   forment un feuillet, parallèle ou antiparallèle » est une DONNÉE À PART
   (`activeTest.betaSheets`) et pourquoi ce module la traduit en géométrie.

   CE QUE CE MODULE FAIT — exactement la méthode de utils/disulfideFold.js, qui a
   montré le chemin pour la même question (deux atomes que φ/ψ séparent ne se
   rejoignent jamais tout seuls) :

     · il reçoit les torsions du modèle idéal de la page (une par résidu, en
       radians) et un CONSTRUCTEUR (`build`) qui rend les coordonnées du
       squelette pour une liste de torsions — c'est ce qui le garde PUR et
       testable sans NGL, comme `sgPositions` dans le module des ponts ;
     · il DÉTEND une fenêtre bornée de φ/ψ (SHEET_MAX_MOVABLE résidus : les deux
       brins déclarés et la boucle qui les sépare) par une recherche locale
       DÉTERMINISTE (graine fixe, aucun tirage non reproductible) ;
     · l'objectif ne demande AUCUN registre écrit en dur — c'est la géométrie qui
       décide, et c'est ce qui rend la parallèle et l'antiparallèle la même
       question posée deux fois :
         ◦ chaque résidu d'un brin doit trouver un partenaire sur l'autre brin à
           la distance des CA d'un feuillet (4,85 Å, SHEET_CA_DISTANCE) ;
         ◦ ce partenaire doit porter un pont hydrogène N···O de 2,9 Å
           (SHEET_HBOND_DISTANCE) — N de l'un, O de l'autre, le sens du pont
           alternant comme dans un vrai feuillet plissé ;
         ◦ aucun CA à moins de 3,4 Å d'un CA non voisin de chaîne (les deux brins
           ne se traversent pas, et la boucle ne rentre pas dans un brin) ;
         ◦ les deux axes de brin doivent être OPPOSÉS (antiparallèle) ou de MÊME
           SENS (parallèle) — c'est le seul endroit où le mot « parallèle » de la
           demande change quelque chose, et c'est mesuré (cosinus des axes).

   CE QUE LE MODULE NE CACHE PAS. Le feuillet sort d'une recherche locale, comme
   un pont disulfure : il rend les MEILLEURES torsions trouvées — jamais pires que
   celles du départ —, la géométrie RÉELLEMENT obtenue (les échelons CA–CA, les
   ponts N···O de chaque paire) et `converged`. Quand la fenêtre déplacée ne
   suffit pas, il le DIT (`best-effort`), il n'invente rien : c'est la même
   honnêteté que le message du viewer pour un pont disulfure étiré.

   ⚠ UNE FOURCHETTE DE SÉQUENCE EST LA CLÉ, PAS UN NUMÉRO AFFICHÉ : `{ a: [5, 10],
   b: [14, 19], sense: 'antiparallel' }` se lit en POSITIONS DE SÉQUENCE 1-based
   incluses, exactement comme `cysDisulfides`. La renumérotation 🔢 du viewer ne
   réécrit donc jamais un feuillet déclaré, et la bande de séquence les marque
   avec le numéro AFFICHÉ du partenaire (voir `sheetMarkAt`).
   ========================================================================= */


/** Les deux sens d'un feuillet — l'ordre de la liste est celui des boutons du panneau. */
export const SHEET_SENSES = ['antiparallel', 'parallel'];

/** Le libellé de chaque sens, écrit UNE fois (le panneau, la bande et le rapport le lisent). */
export const SHEET_SENSE_LABELS = { antiparallel: 'Antiparallel', parallel: 'Parallel' };

/** Le glyphe de chaque sens, pour les puces du panneau et la bande de séquence. */
export const SHEET_SENSE_GLYPHS = { antiparallel: '⇄', parallel: '⇉' };

/** La distance CA–CA d'un feuillet, en Å (le chiffre des manuels : 4,85). */
export const SHEET_CA_DISTANCE = 4.85;

/** Deux CA non voisins de chaîne plus proches que ce chiffre se traversent (Å) —
 *  c'est la répulsion qui interdit aux deux brins (et à la boucle) de s'empiler. */
export const SHEET_CA_CLASH = 3.9;

/** La distance N···O d'un pont hydrogène de feuillet, en Å (un pont est à 2,9). */
export const SHEET_HBOND_DISTANCE = 2.9;

/** Un résidu est « APPARIÉ » quand son partenaire est dans la BANDE d'un feuillet :
 *  au moins SHEET_PAIRED_MIN (en dessous, les deux brins se touchent au lieu de se
 *  regarder) et au plus SHEET_PAIRED_MAX (au-dessus, ils ne se touchent plus). Deux
 *  bornes distinctes, et pas une tolérance symétrique autour de 4,85 Å : un pincement
 *  à 3,9 Å est un contact réel, et le compter comme « non apparié » ferait dire faux
 *  à un rapport qui mesure juste. */
export const SHEET_PAIRED_MIN = 3.6;
export const SHEET_PAIRED_MAX = 5.9;

/** Au-delà de cette distance N···O, il n'y a pas de pont à regarder (Å). */
export const SHEET_HBOND_MAX = 3.6;

/** Au-delà de ce CA–CA, le partenaire n'est plus un partenaire : le terme de pont
 *  ne s'applique qu'aux résidus qui se font vraiment face (Å). */
export const SHEET_HBOND_PAIR_MAX = 8;

/** Un brin déclaré doit porter au moins deux résidus (un brin d'un résidu n'apparie rien). */
export const SHEET_MIN_STRAND = 2;

/** La fenêtre détendue par paire, en résidus — bornée, comme MAX_MOVABLE_RESIDUES
 *  des ponts disulfure : au-delà, un « feuillet » voudrait dire replier la protéine
 *  entière, et la recherche locale ne le ferait pas honnêtement. */
export const SHEET_MAX_MOVABLE = 48;

/** Le nombre de résidus au-delà duquel la répulsion ne regarde plus que le voisinage
 *  court (± SHEET_CLASH_NEIGHBOURS) : le coût d'un contrôle global croît en n² et la
 *  recherche est appelée par un rendu. */
export const SHEET_CLASH_MAX_RESIDUES = 160;

/** Le demi-voisinage du contrôle de répulsion court, en résidus. */
export const SHEET_CLASH_NEIGHBOURS = 6;

/** La graine du tirage — FIXE : deux fois la même définition donnent le même modèle. */
export const SHEET_SEED = 0x5ea5eed;

/** LE LIEN ENTRE DEUX BRINS — la petite bibliothèque de conformations de boucle,
 *  c'est-à-dire les tours β des manuels (leur premier résidu, puis le second quand
 *  la boucle en a la place) et les trois conformations détendues. Chaque
 *  REDÉMARRAGE de la recherche part de l'une d'elles : le tirage local trouve le
 *  bassin beaucoup plus vite depuis un type de tour connu que depuis un tirage au
 *  hasard, et le résultat reste DÉTERMINISTE (même graine, même bibliothèque). */
export const SHEET_LOOP_LIBRARY = [
  { name: 'type I', pairs: [[-60, -30], [-90, 0]] },
  { name: "type I'", pairs: [[60, 30], [90, 0]] },
  { name: 'type II', pairs: [[-60, 120], [80, 0]] },
  { name: "type II'", pairs: [[60, -120], [-80, 0]] },
  { name: 'α', pairs: [[-57, -47]] },
  { name: 'α (left-handed)', pairs: [[57, 47]] },
  { name: 'PPII', pairs: [[-75, 145]] },
];

/** LES PALIERS DE LA RECHERCHE — un tirage local par pas, un pas qui DÉCROÎT
 *  (150° → 20°) pour finir dans le puits plutôt que de le sauter, et un
 *  redémarrage par entrée de la bibliothèque de boucles (plus un, au hasard).
 *  Le BUDGET est compté en évaluations, pas en pas : le coût d'une évaluation
 *  croît avec la longueur de la chaîne, donc un long modèle reçoit moins de pas
 *  (jamais moins de SHEET_MIN_PASSES) — sans quoi un rendu le paierait. */
export const SHEET_EVALUATION_BUDGET = 4000;
export const SHEET_MIN_PASSES = 250;
/** La longueur de chaîne que le budget vise : au-delà, les pas sont réduits (le
 *  coût d'une évaluation croît avec la chaîne). */
export const SHEET_PASSES_REFERENCE = 60;
export const SHEET_STEP_DEG = 150;
export const SHEET_MIN_STEP_DEG = 20;


/** Les couleurs des paires de brins — la même famille que DISULFIDE_PAIR_COLORS,
 *  mais une table À PART : deux paires de feuillet et deux ponts disulfure peuvent
 *  coexister sur la même bande de séquence, et ne doivent pas se confondre. */
export const SHEET_PAIR_COLORS = ['#0e7490', '#b45309', '#7c3aed', '#be123c', '#4d7c0f', '#1d4ed8'];

/** La couleur d'une paire de feuillet (cyclique, jamais hors table). */
export const sheetPairColor = (pairIndex) =>
  SHEET_PAIR_COLORS[((pairIndex % SHEET_PAIR_COLORS.length) + SHEET_PAIR_COLORS.length) % SHEET_PAIR_COLORS.length];


/* ─── LES BRINS PEINTS — les suites de E de la structure secondaire ───────────
   C'est ce que le panneau propose à l'utilisateur : « Strand 1: 5–10 ». Un brin
   est une suite CONTIGUË de E ; une lettre d'une autre sorte (C · H · L · T) ferme
   le brin. Rien n'est deviné : un E isolé est un brin d'un résidu, et le panneau
   ne le proposera pas (SHEET_MIN_STRAND). */
export const sheetStrandsOf = (secondaryStructure) => {
  const letters = String(secondaryStructure == null ? '' : secondaryStructure).toUpperCase();
  const out = [];
  let start = -1;
  for (let i = 0; i < letters.length; i += 1) {
    if (letters[i] === 'E') {
      if (start < 0) start = i;
    } else if (start >= 0) {
      out.push({ index: out.length, start: start + 1, end: i, length: i - start });
      start = -1;
    }
  }
  if (start >= 0) out.push({ index: out.length, start: start + 1, end: letters.length, length: letters.length - start });
  return out;
};

/* ─── LA DÉCLARATION, RELUE — `{ pairs, rejected, strands }` ──────────────────
   Une déclaration est DITE valide quand ses deux fourchettes sont des entiers
   dans la séquence, d'au moins SHEET_MIN_STRAND résidus, disjointes, et quand le
   sens est l'un des deux. Tout le reste est COMPTÉ (`rejected`) au lieu d'être
   deviné : une fourchette laissée par une peinture qu'on vient d'effacer ne
   replie donc jamais rien en silence. */
export const betaSheetPairsOf = ({ secondaryStructure = '', sheets = [], sequenceLength = 0 } = {}) => {
  const strands = sheetStrandsOf(secondaryStructure);
  const letters = String(secondaryStructure == null ? '' : secondaryStructure).toUpperCase();
  const n = Number.isInteger(sequenceLength) && sequenceLength > 0 ? sequenceLength : letters.length;
  const pairs = [];
  let rejected = 0;
  const seen = new Set();
  (Array.isArray(sheets) ? sheets : []).forEach((sheet) => {
    const a = Array.isArray(sheet && sheet.a) ? sheet.a : null;
    const b = Array.isArray(sheet && sheet.b) ? sheet.b : null;
    const sense = sheet && sheet.sense;
    const ok = (range) => Array.isArray(range) && range.length === 2
      && Number.isInteger(range[0]) && Number.isInteger(range[1])
      && range[0] >= 1 && range[1] <= n && range[1] - range[0] + 1 >= SHEET_MIN_STRAND;
    if (!a || !b || !ok(a) || !ok(b) || !SHEET_SENSES.includes(sense)) { rejected += 1; return; }
    /* Les deux fourchettes ne peuvent pas se recouvrir (un brin ne s'apparie pas à
       lui-même) — c'est mesuré, pas supposé. */
    if (!(a[1] < b[0] || b[1] < a[0])) { rejected += 1; return; }
    const key = `${Math.min(a[0], b[0])}-${Math.max(a[1], b[1])}-${sense}`;
    if (seen.has(key)) { rejected += 1; return; }
    seen.add(key);
    /* Le brin de SÉQUENCE le plus tôt est A : l'ordre des deux fourchettes dans la
       déclaration est sans effet (le sens du feuillet, lui, est mesuré sur les axes
       — voir `foldBetaSheets`). */
    const [first, second] = a[0] <= b[0] ? [a, b] : [b, a];
    const paintedE = (range) => {
      let count = 0;
      for (let i = range[0]; i <= range[1]; i += 1) if (letters[i - 1] === 'E') count += 1;
      return count;
    };
    const index = pairs.length;
    pairs.push({
      index,
      /* `sheetIndex` = la place de CETTE déclaration dans la liste brute : c'est par
         elle que le panneau la retire (les paires invalides ne sont pas dans la liste,
         un rang renuméroté retirerait donc la mauvaise). */
      sheetIndex: (Array.isArray(sheets) ? sheets : []).indexOf(sheet),
      label: `β${index + 1}`,
      color: sheetPairColor(index),
      sense,
      senseLabel: SHEET_SENSE_LABELS[sense],
      a: { start: first[0], end: first[1], paintedE: paintedE(first) },
      b: { start: second[0], end: second[1], paintedE: paintedE(second) },
    });
  });
  return { pairs, rejected, strands };
};

/* ─── LE REPÈRE D'UN RÉSIDU SUR LA BANDE DE SÉQUENCE ─────────────────────────
   `position` est une POSITION DE SÉQUENCE 1-based (la clé, jamais un numéro
   affiché — c'est l'appelant qui écrit le numéro du 🔢). Rend `null` quand ce
   résidu n'appartient à aucun brin déclaré. */
export const sheetMarkAt = (pairs, position) => {
  const list = Array.isArray(pairs) ? pairs : [];
  for (const pair of list) {
    for (const side of ['a', 'b']) {
      const range = pair[side];
      if (position >= range.start && position <= range.end) {
        const other = side === 'a' ? pair.b : pair.a;
        return {
          pairIndex: pair.index,
          strand: side === 'a' ? 1 : 2,
          label: pair.label,
          sense: pair.sense,
          senseLabel: pair.senseLabel,
          glyph: SHEET_SENSE_GLYPHS[pair.sense],
          color: pair.color,
          partner: `${other.start}–${other.end}`,
          /* Le dernier résidu du brin : c'est là que la bande écrit le repère. */
          last: (side === 'a' ? pair.a : pair.b).end === position,
        };
      }
    }
  }
  return null;
};

/* ─── LES HELPERS VECTORIELS, écrits localement — le module n'importe RIEN (c'est
   la règle du dossier pour ces six lignes ; elle garantit qu'un test peut le
   charger seul). */
const _sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const _norm = (v) => Math.hypot(v[0], v[1], v[2]);
const _unit = (v) => { const n = _norm(v) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };
const _dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const _dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const _wrapPi = (a) => { let v = a; while (v > Math.PI) v -= 2 * Math.PI; while (v < -Math.PI) v += 2 * Math.PI; return v; };

/** Le tirage DÉTERMINISTE du dossier (mulberry32) — même graine, même modèle. */
const _mulberry32 = (a) => {
  let t0 = a | 0;
  return () => {
    t0 = (t0 + 0x6D2B79F5) | 0;
    let t = Math.imul(t0 ^ (t0 >>> 15), 1 | t0);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** L'AXE D'UN BRIN — la MOYENNE de ses tangentes (CA(i) → CA(i+1)), jamais la corde
 *  de ses deux bouts : un brin de quatre résidus qui se courbe un peu a une corde
 *  qui s'écarte de sa direction locale, et le sens du feuillet se lirait alors faux
 *  (mesuré : cos 0,29 annoncé pour un feuillet parallèle parfaitement rangé). */
const _strandAxis = (res, from, to) => {
  let v = [0, 0, 0];
  for (let i = from; i < to - 1; i += 1) {
    v = [v[0] + res[i + 1].CA[0] - res[i].CA[0],
      v[1] + res[i + 1].CA[1] - res[i].CA[1],
      v[2] + res[i + 1].CA[2] - res[i].CA[2]];
  }
  return _unit(v);
};

/* ════════════════════════════════════════════════════════════════════════════
   LA GÉOMÉTRIE D'UN FEUILLET, MESURÉE — `sheetGeometryOf({ residues, pairs })`

   Le rapport qu'une paire déclarée mérite, lu sur des coordonnées DÉJÀ bâties :
   les échelons CA–CA (`ca` du brin A, `caB` du brin B), les ponts N···O trouvés
   (`hbonds` : `{ i, j, distance }` en positions de séquence 1-based), le cosinus
   des deux axes (`direction`) et le verdict de CETTE paire (`converged`).

   ⚠ C'EST LE MÊME LECTEUR POUR TOUT LE MONDE : `foldBetaSheets` s'en sert pour
   juger les conformations qu'il essaie, le panneau de la définition pour dire ce
   qu'un feuillet a donné, et l'écrivain PDB pour ce qu'il a écrit — aucun des trois
   ne peut donc annoncer autre chose que la géométrie réelle du modèle.

   APPARIÉ (`converged`) veut dire : au plus UN résidu à la traîne (les bouts d'un
   brin réel s'écartent, et c'est mesuré), DEUX ponts N···O au moins (deux ponts
   font un feuillet, un seul fait une rencontre), et le SENS demandé (cosinus ≥ 0,5
   pour un feuillet parallèle, ≤ −0,5 pour un antiparallèle).
   ════════════════════════════════════════════════════════════════════════════ */
export const sheetGeometryOf = ({ residues = [], pairs = [] } = {}) => {
  const res = Array.isArray(residues) ? residues : [];
  return (Array.isArray(pairs) ? pairs : []).map((pair) => {
    const a = pair.a; const b = pair.b;
    const ca = []; const caB = []; const hbonds = [];
    let paired = 0;
    const row = (i, other) => {
      let bd = Infinity; let bp = -1;
      for (let j = other.start - 1; j < other.end; j += 1) {
        if (!res[j]) continue;
        const d = _dist(res[i].CA, res[j].CA);
        if (d < bd) { bd = d; bp = j; }
      }
      return [bd, bp];
    };
    for (let i = a.start - 1; i < a.end; i += 1) {
      const [bd, bp] = row(i, b);
      ca.push(bd);
      if (bd >= SHEET_PAIRED_MIN && bd <= SHEET_PAIRED_MAX) paired += 1;
      if (bp >= 0) {
        const h = Math.min(_dist(res[i].N, res[bp].O), _dist(res[i].O, res[bp].N));
        if (h <= SHEET_HBOND_MAX) hbonds.push({ i: i + 1, j: bp + 1, distance: h });
      }
    }
    for (let j = b.start - 1; j < b.end; j += 1) {
      const [bd] = row(j, a);
      caB.push(bd);
      if (bd >= SHEET_PAIRED_MIN && bd <= SHEET_PAIRED_MAX) paired += 1;
    }
    const cos = _dot(_strandAxis(res, a.start - 1, a.end), _strandAxis(res, b.start - 1, b.end));
    const senseOk = pair.sense === 'parallel' ? cos >= 0.5 : cos <= -0.5;
    const registers = ca.length + caB.length;
    return {
      index: pair.index, label: pair.label, color: pair.color,
      sense: pair.sense, senseLabel: pair.senseLabel,
      a: { start: a.start, end: a.end }, b: { start: b.start, end: b.end },
      ca, caB, direction: cos, senseOk, registers, paired, hbonds,
      converged: paired >= registers - 1 && hbonds.length >= 2 && senseOk,
    };
  });
};

/* ════════════════════════════════════════════════════════════════════════════
   LE REPLIEMENT — `foldBetaSheets({ sequence, torsions, pairs, build, … })`

   Rend `{ torsions, pairs, converged, moved, truncated, evaluations, seed, reason }` :

     · `torsions` — la liste de torsions à donner au bâtisseur (`opts.torsions` de
       proteinSequenceToPdbText, ou le second argument de buildProteinBackbone) ;
       elle fait la MÊME longueur que la séquence, et les résidus hors fenêtre y
       gardent EXACTEMENT leurs φ/ψ d'entrée ;
     · `pairs` — le rapport d'une entrée de `pairs` : les échelons CA–CA mesurés
       (`ca`, `caB`), les ponts N···O trouvés (`hbonds` : `{ i, j, distance }` en
       positions de séquence 1-based), le cosinus des deux axes (`direction`), et
       si CETTE paire est appariée (`converged`) ;
     · `converged` — vrai quand TOUTES les paires le sont ;
     · `truncated` — vrai quand la fenêtre demandée dépassait SHEET_MAX_MOVABLE
       (la recherche n'a alors pas déplacé ses deux bouts : c'est dit) ;
     · `reason` — `'no-pair'` (rien de valide à replier), `'no-model'` (pas de
       constructeur ou séquence vide), `'already-sheeted'` (le modèle d'entrée
       satisfaisait déjà la déclaration : aucune évaluation), `'converged'`,
       `'best-effort'` (le meilleur trouvé, sans mentir).

   CE QUI EST DÉPLACÉ : les φ/ψ de la fenêtre `[premier brin … dernier brin]`
   (les brins eux-mêmes ET la boucle qui les sépare). Les résidus peints H ou L
   avant/après la fenêtre ne bougent pas — un feuillet déclaré ne défait donc
   jamais une hélice qui vit ailleurs.
   ════════════════════════════════════════════════════════════════════════════ */
export const foldBetaSheets = ({
  sequence = '',
  torsions = [],
  pairs = [],
  build = null,
  seed = SHEET_SEED,
  restarts = 0,
  passes = 0,
  maxMovable = SHEET_MAX_MOVABLE,
} = {}) => {
  const seq = String(sequence || '');
  const n = seq.length;
  const base = Array.from({ length: n }, (_, i) => {
    const t = Array.isArray(torsions) ? torsions[i] : null;
    return {
      phi: Number.isFinite(t && t.phi) ? t.phi : 0,
      psi: Number.isFinite(t && t.psi) ? t.psi : 0,
    };
  });
  const list = (Array.isArray(pairs) ? pairs : [])
    .filter((p) => p && p.a && p.b
      && Number.isInteger(p.a.start) && Number.isInteger(p.a.end)
      && Number.isInteger(p.b.start) && Number.isInteger(p.b.end)
      && p.a.start >= 1 && p.a.end <= n && p.b.start >= 1 && p.b.end <= n
      && SHEET_SENSES.includes(p.sense));
  const head = { torsions: base, pairs: [], converged: false, moved: [], truncated: false, evaluations: 0, seed };
  if (!list.length) return { ...head, reason: 'no-pair' };
  if (typeof build !== 'function' || !n) return { ...head, reason: 'no-model' };

  /* LA FENÊTRE DÉTENDUE — du premier au dernier résidu déclaré, bornée. */
  const windowStart = Math.min(...list.map((p) => Math.min(p.a.start, p.b.start))) - 1;
  const windowEnd = Math.max(...list.map((p) => Math.max(p.a.end, p.b.end))) - 1;
  const full = [];
  for (let i = windowStart; i <= windowEnd; i += 1) full.push(i);
  const truncated = full.length > maxMovable;
  const half = Math.floor(maxMovable / 2);
  const centre = Math.floor((windowStart + windowEnd) / 2);
  const moved = truncated ? full.filter((i) => Math.abs(i - centre) <= half) : full;

  const slices = list.map((p) => ({
    pair: p, ia: p.a.start - 1, ja: p.a.end, ib: p.b.start - 1, jb: p.b.end,
  }));

  const DEG = Math.PI / 180;
  /* LES BOUCLES — les résidus ENTRE les deux fourchettes : ce sont eux qui se
     replient (un brin peint reste un brin). C'est sur eux que se sème la
     bibliothèque des tours β, un redémarrage par tour. */
  const linkers = slices
    .map((s) => [s.ja, s.jb - 2])
    .filter(([from, to]) => to >= from && from >= 0);
  const seedWith = (cand, entry) => {
    linkers.forEach(([from, to]) => {
      for (let m = from; m <= to; m += 1) {
        const [phi, psi] = entry.pairs[(m - from) % entry.pairs.length];
        cand[m] = { phi: phi * DEG, psi: psi * DEG };
      }
    });
  };

  /* ── LA RÉPULSION — deux CA non voisins de chaîne ne se touchent pas (les deux
     brins ne se traversent pas, et la boucle ne rentre dans aucun des deux). Le
     contrôle porte sur la FENÊTRE déplacée (élargie du voisinage court) : c'est la
     seule région que la recherche peut faire bouger, et le coût reste ainsi
     proportionnel à ce qu'elle déplace, pas à la taille de la molécule. Au-delà de
     SHEET_CLASH_MAX_RESIDUES, le reste de la chaîne n'est plus regardé (le coût en
     n² est dit dans la constante). */
  const clashOf = (res) => {
    let s = 0;
    const lo = Math.max(0, windowStart - SHEET_CLASH_NEIGHBOURS);
    const hi = Math.min(res.length - 1, windowEnd + SHEET_CLASH_NEIGHBOURS);
    const whole = res.length <= SHEET_CLASH_MAX_RESIDUES;
    for (let i = lo; i <= hi; i += 1) {
      const end = whole ? res.length : hi + 1;
      for (let j = i + 2; j < end; j += 1) {
        const d = _dist(res[i].CA, res[j].CA);
        if (d < SHEET_CA_CLASH) s += 50 * (SHEET_CA_CLASH - d) ** 2;
      }
    }
    return s;
  };

  /* ── L'ALIGNEMENT DES DEUX BRINS — le registre n'est PAS écrit en dur : il est
     TROUVÉ, comme un alignement de séquences, par programmation dynamique sur les
     distances (l'appariement monotone qui rapproche le plus du feuillet idéal). Un
     feuillet CISAILLÉ — chaque résidu face à un résidu décalé — coûte alors cher,
     ce qu'un simple « partenaire le plus proche » ne voyait pas (mesuré : c'était
     exactement le défaut des cas non convergés de la sonde). */
  const registerCost = (res, ia, ja, ib, jb, reverse) => {
    const idxA = [];
    for (let i = ia; i < ja; i += 1) idxA.push(i);
    const idxB = [];
    for (let j = reverse ? jb - 1 : ib; reverse ? j >= ib : j < jb; reverse ? (j -= 1) : (j += 1)) idxB.push(j);
    const na = idxA.length; const nb = idxB.length;
    if (!na || !nb) return 0;
    /* GAP — un résidu sans partenaire coûte : un feuillet les apparie tous (les
       deux bouts d'un brin réel s'écartent, et c'est le rapport qui le dit). */
    const GAP = 1.2;
    const cell = (i, j) => {
      const a = idxA[i]; const b = idxB[j];
      const d = _dist(res[a].CA, res[b].CA);
      let c = (d - SHEET_CA_DISTANCE) ** 2;
      if (d < SHEET_HBOND_PAIR_MAX) {
        const h = Math.min(_dist(res[a].N, res[b].O), _dist(res[a].O, res[b].N));
        c += 4 * Math.min(9, (h - SHEET_HBOND_DISTANCE) ** 2);
      }
      return c;
    };
    let prev = new Array(nb + 1);
    for (let j = 0; j <= nb; j += 1) prev[j] = j * GAP;
    for (let i = 1; i <= na; i += 1) {
      const row = new Array(nb + 1);
      row[0] = i * GAP;
      for (let j = 1; j <= nb; j += 1) {
        row[j] = Math.min(prev[j - 1] + cell(i - 1, j - 1), prev[j] + GAP, row[j - 1] + GAP);
      }
      prev = row;
    }
    return prev[nb];
  };

  /* ── L'ATTRACTION — tant que les deux brins sont LOIN, le score doit DIMINUER
     quand ils se rapprochent. Sans ce terme, la recherche refuse de traverser la
     vallée qui les sépare : chaque pas d'approche paie (d − 4,85)² et la descente
     préfère laisser les deux brins à 35 Å en payant des trous d'alignement
     (mesuré : c'était le sort de TOUS les feuillets parallèles de la sonde). Un
     simple 1/d entre les deux centres de masse fait le chemin ; dans le bassin
     final il ne varie presque plus et ne déforme donc pas la géométrie trouvée
     (c'est le terme d'échelons et la répulsion qui la tiennent). */
  const centroid = (res, from, to) => {
    let x = 0; let y = 0; let z = 0;
    for (let i = from; i < to; i += 1) { x += res[i].CA[0]; y += res[i].CA[1]; z += res[i].CA[2]; }
    const k = Math.max(1, to - from);
    return [x / k, y / k, z / k];
  };
  const attractionOf = (res, ia, ja, ib, jb) => {
    const d = _dist(centroid(res, ia, ja), centroid(res, ib, jb));
    return -40 * SHEET_CA_DISTANCE / Math.max(SHEET_CA_DISTANCE, d);
  };
  /* L'AXE D'UN BRIN — la MOYENNE de ses tangentes (voir `_strandAxis`, le lecteur
     partagé) : le rapport et le score lisent donc le même axe. */

  const scoreOf = (res) => {
    let s = clashOf(res);
    for (const { pair, ia, ja, ib, jb } of slices) {
      const cos = _dot(_strandAxis(res, ia, ja), _strandAxis(res, ib, jb));
      /* Le SENS — le seul endroit où « parallèle » et « antiparallèle » diffèrent.
         La fenêtre (± 0,5 du cosinus) vaut mieux qu'un ± 1 absolu : elle laisse le
         premier bassin se former (les échelons d'abord, le sens ensuite), au lieu de
         faire payer 480 points une orientation que deux torsions corrigeront. */
      s += 30 * Math.max(0, pair.sense === 'parallel' ? 0.5 - cos : cos + 0.5) ** 2;
      s += attractionOf(res, ia, ja, ib, jb);
      s += registerCost(res, ia, ja, ib, jb, pair.sense !== 'parallel');
      s += registerCost(res, ib, jb, ia, ja, pair.sense !== 'parallel');
    }
    return s;
  };

  /* ── LE RAPPORT — le MÊME lecteur que le panneau et l'écrivain PDB
     (`sheetGeometryOf`) : la géométrie réelle de chaque paire, chiffres en main. */
  const reportOf = (res) => sheetGeometryOf({ residues: res, pairs: list });

  /* ── LA RECHERCHE — le motif de utils/disulfideFold.js : un tirage local (un
     résidu mobile, φ ou ψ, un pas qui décroît), gardé quand il fait baisser le
     score, quelques redémarrages « secoués » pour ne pas rejouer le même chemin.
     C'est la forme qui a convergé dans la sonde ; une descente par coordonnée,
     essayée d'abord, se bloquait sur les échelons mal rangés. On s'arrête dès
     qu'une conformation satisfait TOUTES les paires. */
  const rnd = _mulberry32(seed);
  let evaluations = 0;
  const coordsOf = (cand) => { evaluations += 1; return build(cand); };
  const convergedNow = (rep) => rep.length > 0 && rep.every((p) => p.converged);
  const initialReport = reportOf(coordsOf(base));
  if (convergedNow(initialReport)) {
    return { torsions: base, pairs: initialReport, converged: true, moved, truncated, evaluations, seed, reason: 'already-sheeted' };
  }
  /* LES DÉPARTS — le premier est la peinture elle-même, puis un par tour β de la
     bibliothèque, puis un « secoué » au hasard : la recherche rejoue depuis chacun
     et garde le meilleur modèle (le résultat est donc au moins celui du premier). */
  const starts = [null, ...SHEET_LOOP_LIBRARY];
  const totalRestarts = restarts > 0 ? Math.max(1, restarts) : starts.length + 1;
  const passCount = passes > 0
    ? Math.max(1, passes)
    : Math.max(SHEET_MIN_PASSES, Math.round((SHEET_EVALUATION_BUDGET / totalRestarts) * Math.min(1, SHEET_PASSES_REFERENCE / Math.max(1, n))));
  let best = base.map((t) => ({ ...t }));
  let bestScore = scoreOf(coordsOf(base));
  let bestReport = initialReport;
  for (let r = 0; r < totalRestarts; r += 1) {
    let cur = best.map((t) => ({ ...t }));
    const start = starts[r];
    if (start) {
      /* Un redémarrage sur un TOUR CONNU (la bibliothèque) : la boucle entre les
         deux brins commence à la conformation d'un tour β des manuels, et la
         descente part de là. */
      seedWith(cur, start);
    } else if (r > 0) {
      /* Un « coup de pied » : la descente est gloutonne, donc deux redémarrages
         partis du même point rejoueraient exactement le même chemin. */
      const kicks = 1 + Math.floor(rnd() * Math.min(6, Math.max(1, moved.length)));
      for (let k = 0; k < kicks; k += 1) {
        const i = moved[Math.floor(rnd() * moved.length)];
        const key = rnd() < 0.5 ? 'phi' : 'psi';
        cur[i][key] = _wrapPi(cur[i][key] + (rnd() - 0.5) * SHEET_STEP_DEG * DEG);
      }
    }
    let curScore = scoreOf(coordsOf(cur));
    for (let p = 0; p < passCount; p += 1) {
      const step = (SHEET_STEP_DEG - (SHEET_STEP_DEG - SHEET_MIN_STEP_DEG) * (p / passCount)) * DEG;
      const i = moved[Math.floor(rnd() * moved.length)];
      const key = rnd() < 0.5 ? 'phi' : 'psi';
      const cand = cur.map((t) => ({ ...t }));
      if (rnd() < 0.3) {
        /* UN MOUVEMENT DE SEGMENT — toute une suite de résidus mobiles tourne du
           même angle sur le même angle de chaîne. Un seul φ déplace un seul
           résidu ; c'est ce mouvement-là qui BASCULE un brin entier vers l'autre,
           et sans lui la recherche reste dans les épingles à moitié ouvertes
           (mesuré : trois des huit cas de la sonde s'arrêtaient là). */
        const k = moved[Math.floor(rnd() * moved.length)];
        const lo = Math.min(i, k); const hi = Math.max(i, k);
        const off = (rnd() + rnd() - 1) * step;
        for (let m = moved.indexOf(lo); m <= moved.indexOf(hi); m += 1) {
          if (m < 0) break;
          cand[moved[m]][key] = _wrapPi(cand[moved[m]][key] + off);
        }
      } else {
        cand[i][key] = _wrapPi(cand[i][key] + (rnd() + rnd() - 1) * step);
      }
      const candRes = coordsOf(cand);
      const sc = scoreOf(candRes);
      if (sc < curScore) { cur = cand; curScore = sc; }
      if (sc < bestScore) {
        best = cand; bestScore = sc; bestReport = reportOf(candRes);
        if (convergedNow(bestReport)) {
          return { torsions: best, pairs: bestReport, converged: true, moved, truncated, evaluations, seed, reason: 'converged' };
        }
      }
    }
  }
  const converged = convergedNow(bestReport);
  return {
    torsions: best, pairs: bestReport, converged, moved, truncated, evaluations, seed,
    reason: converged ? 'converged' : 'best-effort',
  };
};

/* ─── LA PHRASE DU RAPPORT — écrite UNE fois : le panneau de la définition, la
   note du modèle et les REMARK du PDB lisent celle-ci. */
export const sheetFoldSentenceOf = (fold) => {
  const pairs = fold && Array.isArray(fold.pairs) ? fold.pairs : [];
  if (!pairs.length) return '';
  const r1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');
  const per = pairs.map((p) => {
    const ladder = [...p.ca, ...p.caB].map(r1).join(' ');
    return `${p.label} ${p.a.start}–${p.a.end} ${SHEET_SENSE_GLYPHS[p.sense]} ${p.b.start}–${p.b.end}`
      + ` (${String(p.senseLabel).toLowerCase()}) · CA–CA ${ladder} Å · ${p.hbonds.length} H-bond${p.hbonds.length === 1 ? '' : 's'}`
      + `${p.senseOk ? '' : ' · ⚠ wrong direction'}`;
  }).join(' · ');
  const verdict = !fold ? ''
    : fold.reason === 'already-sheeted' ? 'the conformation of the sequence already satisfied the declaration'
      : fold.converged ? 'folded'
        : `best conformation found (${fold.reason})`;
  return `${per} — ${verdict}`;
};
