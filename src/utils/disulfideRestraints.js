/* =========================================================================
   src/utils/disulfideRestraints.js
   ⚭ LES PONTS DISULFURE DÉCLARÉS → DES DISTANCES DE LA TABLE.

   La demande de cette session, mot pour mot : « Can you add a button “generate
   distances from disulfide” which generates distance restraints according to the
   disulfide definition in the sequence? »

   OÙ VIT LA DÉFINITION (une seule, jamais recopiée) : « Cysteine states » de la
   sous-section « Sequence and structure » range les ponts sur la CONDITION
   (`cysDisulfides`), en POSITIONS DE SÉQUENCE 1-based (`[[3, 10], …]`) — la
   même clé commune que `betaSheets`. C'est de là que la page construit le
   CONECT SG–SG de son modèle, et c'est de là que ce module part : la définition
   n'est pas relue, elle est REÇUE.

   CE QU'IL EN FAIT : il la traduit en lignes de la table des distances du 🧬
   (deux atomes, une cible), à la longueur de la liaison S–S (`SS_BOND_LENGTH`,
   2.05 Å — la MÊME constante que le repliement, l'interrupteur ⚭ et les termes
   que les quatre gestes conduisent). Une ligne ainsi écrite n'est PAS un objet à
   part : c'est une distance ORDINAIRE, donc ▶ Run, ▶ MD, ⚒ Minimise et ⟳ Energy
   la conduisent comme une ligne tapée, et leurs rapports la comptent comme
   telle.

   POURQUOI LA DÉFINITION SEULE NE SUFFIT PAS — le terme automatique de
   utils/disulfideFold.js (`stretchedDisulfideTermsOf`) ne conduit qu'un pont que
   le MODÈLE DESSINE (le CONECT SG–SG écrit par la page) et dont les deux Sγ sont
   trop loin. Un .pdb chargé (un code PDB, un fichier de l'expérience) ne dessine
   pas ce CONECT : ses ponts déclarés n'entrent donc dans AUCUN geste. Le bouton
   comble exactement ce trou — il écrit les ponts déclarés dans la table, qu'ils
   soient dessinés ou non.

   LA CORRESPONDANCE séquence → structure est la RÈGLE DE L'APPLICATION, pas une
   seconde : le numéro d'origine d'un résidu est sa position 1-based dans la
   séquence PLUS le décalage `residueOffset` de la condition (voir
   utils/residueNumbering.js, `originalResidueNumber`). C'est ce numéro-là que la
   structure porte, donc celui sur lequel les atomes sont cherchés.
   ⚠ LA RENUMÉROTATION 🔢 N'ENTRE PAS ICI : `resRenumber` est un numéro MONTRÉ,
   pas un numéro de structure — l'appariement se fait donc sur le numéro
   d'origine. Les libellés, eux, sont mis en forme par l'appelant, qui détient la
   règle d'affichage (le viewer, `displayResno`).

   Module PUR (trois imports, tous purs) : il reçoit les paires déclarées et les
   atomes de la molécule À L'ÉCRAN (tels que le viewer les lit) et rend des lignes
   prêtes à poser. Vérifié par _disulfide_restraints_test.mjs.
   ========================================================================= */
import { originalResidueNumber } from './residueNumbering.js';
import { SG_ATOM_NAME } from './disulfideBonds.js';
import { SS_BOND_LENGTH } from './disulfideFold.js';

/** LA CIBLE D'UNE LIGNE DE PONT — la longueur de la liaison S–S, réexportée pour
 *  que l'appelant (et ses tests) n'ait pas à importer deux modules pour dire la
 *  même chose. */
export const DISULFIDE_RESTRAINT_TARGET = SS_BOND_LENGTH;

/** LE DÉCALAGE DE STRUCTURE D'UNE CONDITION — lu ici comme le lit
 *  utils/residueNumbering.js (jamais NaN, jamais une chaîne). */
const offsetOf = (value) => {
  const off = Number(value);
  return Number.isFinite(off) ? off : 0;
};

const text = (v) => (v === undefined || v === null ? '' : String(v).trim());

const atomNameOf = (a) => text(
  a && (a.name !== undefined && a.name !== null ? a.name : a.atomname)
).toUpperCase();

/** LES PAIRES DÉCLARÉES, NORMALISÉES — `{ pairs, dropped }`, `pairs` = [[3, 10], …]
 *  (deux positions de séquence 1-based, la plus petite d'abord, sans doublon).
 *
 *  ⚠ CE QUI EST ÉCARTÉ L'EST PAR PRINCIPE, PAS PAR SILENCE : une entrée qui n'est
 *  pas un couple de deux positions entières ≥ 1 et différentes n'est pas un pont
 *  (une paire [7, 7] ne relie rien, une paire [0, 4] n'existe pas dans une
 *  séquence 1-based), et un pont déclaré DEUX FOIS est le même pont — la règle que
 *  « Cysteine states » tient déjà à l'écran. Le compte des écartées est RENDU
 *  (`dropped`), donc l'appelant peut le dire au lieu de le taire. */
export const disulfidePairsOf = (raw) => {
  const out = [];
  const seen = new Set();
  let dropped = 0;
  Array.from(Array.isArray(raw) ? raw : []).forEach((entry) => {
    const pair = Array.isArray(entry) ? entry : [];
    const a = Math.trunc(Number(pair[0]));
    const b = Math.trunc(Number(pair[1]));
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || b < 1 || a === b) { dropped += 1; return; }
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) { dropped += 1; return; }
    seen.add(key);
    out.push(a < b ? [a, b] : [b, a]);
  });
  return { pairs: out.sort((p, q) => (p[0] - q[0]) || (p[1] - q[1])), dropped };
};

/** ⚭ LA CONVERSION — `{ ok, reason, declared, dropped, target, residueOffset,
 *  rows, missing }`.
 *
 *  `rows` est prêt à POSER dans la table du 🧬 : `{ pair, i, j, target, residue,
 *  resname, name, element }` — les deux indices d'atomes de la molécule à l'écran,
 *  la cible (2.05 Å par défaut) et de quoi écrire le libellé de la ligne (le
 *  résidu d'ORIGINE et le nom des atomes : l'appelant y applique sa règle
 *  d'affichage, la renumérotation 🔢 comprise). `missing` dit, paire par paire, ce
 *  que la molécule à l'écran ne permet pas de convertir — jamais un silence : une
 *  paire déclarée qui ne donne pas de ligne doit pouvoir être lue.
 *
 *  `reason` :
 *    · 'no-pair' — la séquence ne déclare aucun pont (il n'y a rien à faire) ;
 *    · 'no-atom' — la molécule ne porte pas les deux Sγ attendus ;
 *    · 'ok'      — au moins une ligne est écrite.
 *
 *  Un atome « Sγ » est cherché par son NOM (SG, la règle de utils/disulfideBonds.js)
 *  et par le numéro d'ORIGINE du résidu : aucune autre supposition n'est faite, et
 *  un atome sans index entier utilisable ne compte pas (il ne peut pas être posé
 *  dans une ligne). */
export const disulfideRestraintsOf = ({
  pairs = [], atoms = [], residueOffset = 0, target = DISULFIDE_RESTRAINT_TARGET,
} = {}) => {
  const wanted = Number(target);
  const goal = Number.isFinite(wanted) && wanted > 0 ? wanted : DISULFIDE_RESTRAINT_TARGET;
  const off = offsetOf(residueOffset);
  const normalized = disulfidePairsOf(pairs);
  const list = Array.from(Array.isArray(atoms) ? atoms : []);
  const rows = [];
  const missing = [];
  const sgAt = (resno) => list.find((a) => atomNameOf(a) === SG_ATOM_NAME
    && Number(a && a.resno) === resno) || null;
  normalized.pairs.forEach(([a, b]) => {
    /* LE NUMÉRO D'ORIGINE des deux Cys — la position de séquence plus le décalage
       de la condition : c'est le numéro que la structure porte. */
    const ra = originalResidueNumber(a - 1, off);
    const rb = originalResidueNumber(b - 1, off);
    const first = sgAt(ra);
    const second = sgAt(rb);
    if (!first || !second || !Number.isInteger(first.index) || !Number.isInteger(second.index)
      || first.index === second.index) {
      missing.push({
        pair: [a, b], residue: [ra, rb],
        say: `no pair of Sγ atoms of this molecule sits on residues ${ra} and ${rb}`
          + ` (positions ${a} and ${b} of the sequence${off ? ` + offset ${off}` : ''})`,
      });
      return;
    }
    rows.push({
      pair: [a, b], i: first.index, j: second.index, target: goal,
      residue: [ra, rb],
      resname: [text(first.resname), text(second.resname)],
      name: [text(atomNameOf(first)), text(atomNameOf(second))],
      element: [text(first.element).toUpperCase(), text(second.element).toUpperCase()],
    });
  });
  rows.sort((r, s) => (r.i - s.i) || (r.j - s.j));
  const reason = !normalized.pairs.length ? 'no-pair' : (rows.length ? 'ok' : 'no-atom');
  return {
    ok: rows.length > 0, reason,
    declared: normalized.pairs.length, dropped: normalized.dropped,
    target: goal, residueOffset: off, rows, missing,
  };
};
