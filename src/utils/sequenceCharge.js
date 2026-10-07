/* =========================================================================
   src/utils/sequenceCharge.js — LA CHARGE D'UNE SÉQUENCE : CE QUE LE pH EN FAIT.

   LA DEMANDE DE CETTE SESSION, MOT POUR MOT : « Under the sequence field please write the
   number of each type of aminoacids, the total charge at pH 7 and the estimated molar
   extinction coefficient. Keep this information compact utilising as much horizontal space.
   In the library the compound are defined with their modification, like acetylation or
   amidation. the charge should keep this into account. If the sequence is written directly
   into the sequence space, assume free termini. this is valid not only for this writing but
   also for the calculation of the charge based on pH in the “params and constraints” section.
   In that case, to calculate the charge based on pH you need to know the pka of all
   aminoacids side chains. I guess you know them already. »

   ⚠ CE MODULE LIT UNE SÉQUENCE, PAS UNE MOLÉCULE — aucun atome, aucun graphe, aucune
   coordonnée : le nombre de chaque acide aminé, la charge que le pH donne aux fonctions
   ionisables de cette séquence, et l'ε₂₈₀ que sa composition promet. C'est la lecture que le
   panneau de la Librairie écrit SOUS LA CASE DE SÉQUENCE, et celle que le ⚙ « Params &
   Constraints » lit quand la molécule à l'écran est le modèle bâti sur cette séquence.

   ⚠⚠ DEUX LECTURES, JAMAIS CONFONDUES — l'autre lecture est celle du GRAPHE de la molécule
   (`partialChargesOf`, utils/forceFieldKcal.js : chaque groupe que le fichier montre, avec
   les pKa de famille du champ). Elle reste la seule pour un PDB CHARGÉ, pour une molécule
   organique, pour un ligand ; celle-ci répond pour une SÉQUENCE, où l'on connaît l'identité
   de chaque résidu — donc le pKa de SA chaîne latérale, y compris l'imidazole d'une
   histidine (que le graphe, lui, ne reconnaît pas). Les deux sont DITES là où elles
   s'affichent : le panneau ne présente jamais l'une pour l'autre.

   LES pKa SONT UNE TABLE NOMMÉE DE CE MODULE (aucun n'est deviné d'un fichier) : les sept
   chaînes latérales ionisables, les DEUX TERMINUS, et les deux pKa d'un phosphate. La charge
   vient de Henderson–Hasselbalch, fonction par fonction :
     · un ACIDE (Asp, Glu, Cys, Tyr, le carboxyle C-terminal, un phosphate) porte sa charge
       quand il est DÉPROTONÉ :  f◦ = 1 / (1 + 10^(pKa − pH)) ;
     · une BASE (His, Lys, Arg, l'ammonium N-terminal) la porte quand il est PROTONÉ :
       f+ = 1 / (1 + 10^(pH − pKa)).
   ⚠ SANS pH (`null`), chaque fonction garde sa FORME CHARGÉE (facteur 1) : c'est la même
   convention que le champ — « la chimie que le graphe montre » —, et pour une séquence cela
   veut dire le peptide ionisé tel qu'on l'écrit (NH₃⁺ · COO⁻).

   LES TERMINUS — la règle de la demande : « If the sequence is written directly into the
   sequence space, assume free termini. » Donc ammonium N-terminal (+1) et carboxyle
   C-terminal (−1) par DÉFAUT, et chacun se retire quand la définition du composé le dit :
     · un capuchon d'AMINE en tête (Acetylation · Acylation · Formylation) supprime
       l'ammonium N-terminal — une amide n'a aucune charge ;
     · AMIDATION en queue supprime le carboxyle C-terminal — une amide n'en a pas non plus.
   Les modifications sont lues par `parseModificationsOf` (utils/modifications.js — le MÊME
   lecteur que `parseModifications` de sequenceInfo.js, sans sa dépendance JSX : un capuchon se
   lit sans traîner un composant) : UNE seule lecture de ce texte dans tout le dossier ; et
   l'ε₂₈₀ par `analyzeProteinSequence` (components/cloningUtils.js : Pace, Trp 5500 · Tyr 1490 ·
   cystine 125) — aucune règle recopiée ici.

   ⚠ CE QUI N'EST PAS MODÉLÉ, ET DIT : les autres modifications ne changent pas la charge
   (une lysine méthylée reste un ammonium — une triméthylée aussi, elle est quaternaire) ; un
   acide aminé non standard (X, B, Z, U, O, J) est COMPTÉ dans la composition mais ne charge
   rien ; et une phosphorylation est comptée une fois par « Phosphorylation » écrite (les
   sites ne sont pas devinés d'une lettre).
   ========================================================================= */

import { parseModificationsOf, modificationMassOf } from './modifications.js';
import { analyzeProteinSequence } from '../components/cloningUtils.js';


/* ── LES pKa — LA TABLE DU MODULE ────────────────────────────────────────────────────────
   Les chaînes latérales ionisables (le pKa de la FONCTION, jamais celui du résidu entier) et
   les deux terminus d'un peptide libre. `kind` dit de quel côté du pH la charge est portée. */
export const AA_SIDECHAIN_PKA = {
  D: 3.86,    // Asp — le carboxyle de la chaîne latérale
  E: 4.25,    // Glu — le même carboxyle, un peu plus haut
  H: 6.00,    // His — l'imidazole (le seul que le graphe, lui, ne reconnaît pas)
  C: 8.33,    // Cys — le thiol
  Y: 10.07,   // Tyr — le phénol
  K: 10.50,   // Lys — l'ammonium de la chaîne latérale
  R: 12.40,   // Arg — le guanidinium
};
export const AA_SIDECHAIN_KIND = {
  D: 'acid', E: 'acid', H: 'base', C: 'acid', Y: 'acid', K: 'base', R: 'base',
};
export const AA_SIDECHAIN_CHARGE = { D: -1, E: -1, H: 1, C: -1, Y: -1, K: 1, R: 1 };
export const AA_SIDECHAIN_GROUP = {
  D: 'carboxylate (Asp)', E: 'carboxylate (Glu)', H: 'imidazole (His)', C: 'thiolate (Cys)',
  Y: 'phenolate (Tyr)', K: 'ammonium (Lys)', R: 'guanidinium (Arg)',
};
export const TERMINUS_PKA = { nTerm: 9.69, cTerm: 2.34 };
export const TERMINUS_CHARGE = { nTerm: 1, cTerm: -1 };
export const TERMINUS_KIND = { nTerm: 'base', cTerm: 'acid' };
export const TERMINUS_GROUP = { nTerm: 'ammonium (N-term)', cTerm: 'carboxylate (C-term)' };
/* UN PHOSPHATE EST UN DIACIDE : ses DEUX protons partent (pKa₁ ≈ 2,15 · pKa₂ ≈ 7,20), donc sa
   charge va de 0 à −2 — c'est le seul groupe du module qui en compte deux. */
export const PHOSPHATE_PKA = [2.15, 7.20];
export const PHOSPHATE_GROUP = 'phosphate (phospho)';
/* Le pH de la lecture d'un panneau — « the total charge at pH 7 » (la demande). */
export const SEQUENCE_PH = 7;
/* L'ALPHABET DE LA COMPOSITION — l'ordre d'affichage est celui-ci (une ligne compacte qui ne
   bouge pas d'un coup à l'autre se lit), et toute autre lettre (X, B, Z, U, O, J) vient après,
   dans l'ordre où elle apparaît. */
export const AA_ALPHABET = 'ACDEFGHIKLMNPQRSTVWY'.split('');

/* ── LES MODIFICATIONS QUI TOUCHENT UN TERMINUS ──────────────────────────────────────────
   `parseModifications` (utils/sequenceInfo.js) rend `{ label, delta, known }` — une entrée PAR
   UNITÉ, avec le LIBELLÉ CANONIQUE de la table MODIFICATIONS (un alias ou une faute de frappe
   ne devient jamais un libellé connu). Les capuchons se lisent donc sur ces libellés-là.
   ⚠ Un capuchon ne se pose QU'UNE FOIS — le terminus n'existe qu'une fois : « Acetylation:2 »
   retire l'ammonium N-terminal une fois, et rien de plus. */
export const N_TERMINUS_CAPS = ['Acetylation', 'Acylation', 'Formylation'];
export const C_TERMINUS_CAPS = ['Amidation'];
export const PHOSPHO_LABEL = 'Phosphorylation';

/** LES LETTRES D'UNE SÉQUENCE — en majuscules, espaces retirés, `*` (un codon stop) écarté,
    tout le reste GARDÉ : une lettre non standard doit se COMPTER, pas disparaître. */
export const sequenceLettersOf = (seq) => String(seq == null ? '' : seq)
  .toUpperCase()
  .replace(/\s+/g, '')
  .replace(/\*/g, '')
  .split('')
  .filter((ch) => /[A-Z]/.test(ch));

/** LE NOMBRE DE CHAQUE ACIDE AMINÉ — `{ A: 2, C: 0, … X: 1 }`, l'alphabet complet d'abord
    (un zéro est une information : « pas d'histidine » se lit), les lettres non standard
    ensuite. `length` compte TOUTES les lettres, `known` celles de l'alphabet. */
export const sequenceCompositionOf = (seq) => {
  const letters = sequenceLettersOf(seq);
  const counts = {};
  AA_ALPHABET.forEach((aa) => { counts[aa] = 0; });
  letters.forEach((ch) => { counts[ch] = (counts[ch] || 0) + 1; });
  const known = letters.filter((ch) => AA_ALPHABET.includes(ch)).length;
  return {
    counts,
    length: letters.length,
    known,
    unknown: letters.filter((ch) => !AA_ALPHABET.includes(ch)),
  };
};

/** LA FORME CHARGÉE EST-ELLE LÀ, À CE pH-LÀ ? — Henderson–Hasselbalch. Sans pH (`null`,
    `''`, illisible), le facteur vaut 1 : la forme CHARGÉE, la convention du champ. */
export const hhFactorOf = (pka, ph, kind) => {
  const listed = !(ph == null || ph === '') && Number.isFinite(Number(ph));
  if (!listed) return 1;
  const p = Number(ph);
  return kind === 'acid'
    ? 1 / (1 + 10 ** (Number(pka) - p))
    : 1 / (1 + 10 ** (p - Number(pka)));
};

/** CE QUE LES MODIFICATIONS FONT AUX DEUX TERMINUS — le seul endroit où la définition d'un
    composé parle à la charge : un capuchon d'amine en tête (`acetylated`), une amide en queue
    (`amidated`), et le NOMBRE de phosphates (`phospho`). Rien d'autre n'est deviné. */
export const modificationEffectsOf = (modifications = '') => {
  const list = parseModificationsOf(modifications);
  const has = (label) => list.some((m) => m && m.label === label);
  const acetylated = N_TERMINUS_CAPS.some(has);
  const amidated = C_TERMINUS_CAPS.some(has);
  return {
    list,
    acetylated,
    amidated,
    phospho: list.filter((m) => m && m.label === PHOSPHO_LABEL).length,
    /* LE POIDS QUE LES MODIFICATIONS AJOUTENT — la somme des deltas de la table
       (utils/modifications.js), une unité à la fois. C'est ce que la LIGNE sous
       la case ajoute à la masse des résidus : « In the description add the
       molecular weight » veut dire la masse de la MOLÉCULE décrite — un peptide
       acétylé pèse 42,01 Da de plus que ses résidus, et une amidation en enlève
       0,98. La charge, elle, s'en sert déjà (les capuchons) : les deux chiffres
       de la ligne viennent donc du même texte de modifications. */
    mass: Number(modificationMassOf(list).toFixed(2)),
    /* LES DEUX TERMINUS, EN MOTS — ce qu'une ligne de panneau peut CITER sans le
       réinterpréter : `free` (la règle de la séquence écrite directement), `acetylated`,
       `amidated`. */
    terminus: {
      nTerm: acetylated ? 'acetylated' : 'free',
      cTerm: amidated ? 'amidated' : 'free',
    },
  };
};

/** LES FONCTIONS QUE LE pH PEUT TITRER SUR CETTE SÉQUENCE — l'ammonium N-terminal, chaque
    chaîne latérale ionisable DANS L'ORDRE DE LA SÉQUENCE, le carboxyle C-terminal, puis un
    groupe par phosphate déclaré. Chaque groupe porte son pKa (une LISTE : un phosphate en a
    deux), sa FORME CHARGÉE (`charge`) et `sites` = le nombre de protons que ces pKa font
    partir. Sans résidu, aucun groupe de terminus : il n'y a pas de peptide. */
export const sequenceIonisableOf = (seq, { modifications = '' } = {}) => {
  const letters = sequenceLettersOf(seq);
  const effects = modificationEffectsOf(modifications);
  const groups = [];
  if (!letters.length) return groups;
  if (!effects.acetylated) {
    groups.push({
      name: TERMINUS_GROUP.nTerm, kind: TERMINUS_KIND.nTerm, pka: [TERMINUS_PKA.nTerm],
      charge: TERMINUS_CHARGE.nTerm, sites: 1, aa: letters[0], position: 1, terminus: 'nTerm',
    });
  }
  letters.forEach((aa, index) => {
    if (!AA_SIDECHAIN_PKA[aa]) return;
    groups.push({
      name: AA_SIDECHAIN_GROUP[aa], kind: AA_SIDECHAIN_KIND[aa], pka: [AA_SIDECHAIN_PKA[aa]],
      charge: AA_SIDECHAIN_CHARGE[aa], sites: 1, aa, position: index + 1, terminus: null,
    });
  });
  if (!effects.amidated) {
    groups.push({
      name: TERMINUS_GROUP.cTerm, kind: TERMINUS_KIND.cTerm, pka: [TERMINUS_PKA.cTerm],
      charge: TERMINUS_CHARGE.cTerm, sites: 1, aa: letters[letters.length - 1],
      position: letters.length, terminus: 'cTerm',
    });
  }
  for (let k = 0; k < effects.phospho; k += 1) {
    groups.push({
      name: PHOSPHATE_GROUP, kind: 'acid', pka: PHOSPHATE_PKA.slice(),
      charge: -1, sites: PHOSPHATE_PKA.length, aa: null, position: null, terminus: null,
    });
  }
  return groups;
};

/** LA CHARGE DE CETTE SÉQUENCE À CE pH-LÀ — la somme des contributions, plus la lecture qui
    dit POURQUOI : chaque fonction, son pKa, son facteur, sa contribution. `factor` est la
    SOMME des sites (un phosphate vaut jusqu'à 2) et `contribution = charge × factor`. Sans pH
    (`null`), chaque fonction garde sa forme chargée : le peptide ionisé tel qu'on l'écrit. */
export const sequenceChargeReportOf = (seq, ph = SEQUENCE_PH, { modifications = '' } = {}) => {
  const ionisable = sequenceIonisableOf(seq, { modifications });
  const groups = ionisable.map((g) => {
    const factor = g.pka.reduce((sum, p) => sum + hhFactorOf(p, ph, g.kind), 0);
    return {
      name: g.name, aa: g.aa, position: g.position, terminus: g.terminus,
      pka: g.pka.slice(), kind: g.kind, sites: g.sites,
      factor: Number(factor.toFixed(6)),
      contribution: Number((g.charge * factor).toFixed(6)),
    };
  });
  const net = Number(groups.reduce((sum, g) => sum + g.contribution, 0).toFixed(6));
  const listed = !(ph == null || ph === '') && Number.isFinite(Number(ph));
  return {
    ph: listed ? Number(Number(ph).toFixed(4)) : null,
    listed,
    net,
    groups,
    total: groups.length,
    ionised: groups.filter((g) => Math.abs(g.factor) > 1e-6).length,
    composition: sequenceCompositionOf(seq),
    effects: modificationEffectsOf(modifications),
  };
};

/** LA COMPOSITION EN UNE LIGNE — « A 3 · C 1 · K 3 », uniquement les lettres PRÉSENTES (un
    zéro n'apprend rien sur une ligne), dans l'ordre de l'alphabet, puis les lettres non
    standard rencontrées. `''` quand la séquence est vide. */
export const compositionTextOf = (composition) => {
  if (!composition || !composition.length) return '';
  const counts = composition.counts || {};
  const known = AA_ALPHABET.filter((aa) => Number(counts[aa]) > 0)
    .map((aa) => `${aa} ${counts[aa]}`);
  const extra = [];
  Object.keys(counts).forEach((aa) => {
    if (AA_ALPHABET.includes(aa) || !(Number(counts[aa]) > 0)) return;
    extra.push(`${aa} ${counts[aa]}`);
  });
  return [...known, ...extra].join(' · ');
};

/** LA LECTURE COMPLÈTE D'UNE SÉQUENCE PROTÉIQUE — les trois choses que la demande veut sous la
    case de séquence, réunies : la COMPOSITION, la CHARGE (au pH donné, 7 par défaut) et
    l'ε₂₈₀. `length`, `mw` et `epsilon` viennent d'`analyzeProteinSequence` (UNE seule règle
    d'ε₂₈₀ dans le dossier : Pace — Trp 5500 · Tyr 1490 · cystine 125, cystine supposée
    appariée), donc rien n'est recopié ici.
    ⚠ `mw` EST LA MASSE DE LA MOLÉCULE, MODIFICATIONS COMPRISES (« In the description add the
    molecular weight ») : les résidus (et l'eau d'un peptide libre) sont pesés par
    `analyzeProteinSequence`, et le texte des modifications ajoute ses deltas
    (`modificationEffectsOf.mass`). Un peptide « Acetylation, Amidation » pèse donc
    42,01 − 0,98 Da de plus que ses résidus, exactement comme sa charge est celle d'un
    peptide capuchonné : les deux chiffres de la ligne viennent du même texte. */
export const proteinSequenceReadingOf = (seq, { modifications = '', ph = SEQUENCE_PH } = {}) => {
  const analysis = analyzeProteinSequence(seq);
  const charge = sequenceChargeReportOf(seq, ph, { modifications });
  const modMass = Number(charge.effects && charge.effects.mass) || 0;
  return {
    ok: analysis.length > 0,
    length: analysis.length,
    mw: Number((analysis.mw + modMass).toFixed(2)),
    epsilon: analysis.eps280,
    counts: analysis.counts,
    composition: charge.composition,
    charge,
    net: charge.net,
    ph: charge.ph,
    effects: charge.effects,
  };
};
