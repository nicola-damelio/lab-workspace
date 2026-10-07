/* =========================================================================
   src/components/SequenceReadingLine.jsx — LA LIGNE SOUS UNE CASE DE SÉQUENCE.

   LA DEMANDE, MOT POUR MOT : « Under the sequence field please write the number
   of each type of aminoacids, the total charge at pH 7 and the estimated molar
   extinction coefficient. Keep this information compact utilising as much
   horizontal space. In the library the compound are defined with their
   modification, like acetylation or amidation. the charge should keep this into
   account. »

   ⚠ UN SEUL RENDU POUR TOUTES LES CASES DE SÉQUENCE — la ligne apparaît sous
   CHACUNE des cases où l'on écrit une séquence protéique, et toutes rendent CE
   composant, avec les mêmes ingrédients :
     • la fiche du composé de la Librairie (AppModules/compoundDefinitionSection,
       la case « One-letter sequence », sa case Modifications juste à côté) ;
     • la case « … Sequence (1-letter code) » de la page NMR
       (NMRSections › MolecularStructureSection) ;
     • la même case de la page MD (MDSections › MolecularStructureSection) ;
     • la même case de la page Docking (DockingSections).
   ⚠ ET LE CALCUL VIT ICI AUSSI — c'est le point de ce composant : `sequence` +
   `modifications` (+ `moleculeType`) suffisent, et le composant lit LUI-MÊME
   utils/sequenceCharge.js à pH 7. Une case de séquence n'a donc rien à savoir
   du modèle : elle ne peut ni oublier les modifications du composé, ni prendre
   un autre pH, ni oublier que seules les protéines ont une composition
   d'acides aminés. La ligne ne peut pas non plus contredire le ⚙ Params &
   Constraints, qui lit ce même module-là au pH de sa case.

   DEUX FAÇONS DE L'APPELER (l'une ou l'autre, jamais les deux) :
     • `<SequenceReadingLine sequence={…} modifications={…}
        moleculeType={…} />` — le cas NORMAL : le composant calcule ;
     • `reading={proteinSequenceReadingOf(seq, { modifications, ph })}` — pour
       un appelant qui a DÉJÀ la lecture (la fiche de la Librairie lit du HTML,
       elle passe donc `stripHtml(sequence)`).
   `reading` : `ok` (la séquence n'est pas vide), `length`, `composition`,
   `net`, `effects.terminus`, `epsilon`. Une lecture absente, vide, ou d'un
   type qui n'a pas d'acides aminés ne rend RIEN (jamais une ligne muette).

   ⚠ CE QUE CETTE SESSION AJOUTE À LA LIGNE (la demande, mot pour mot : « also in
   the descriptive line below where R,K, E D ad C should be in bold … If the
   sequences are all the same then the description must refer to only one
   molecule; if they are different to each of them. In the description add the
   molecular weight. ») :
     • LES CINQ LETTRES EN GRAS dans la composition — K · R (basiques), E · D
       (acides), C (cystéine). C'est utils/sequenceHighlight.js qui les nomme, le
       MÊME module que la case de séquence colorée (components/SequenceField.jsx) :
       la case les PEINT, la ligne les met en GRAS, et une seule table décide
       desquelles il s'agit ;
     • LA MASSE MOLÉCULAIRE (« MW 3 496.28 Da ») — `reading.mw`, qui est la masse
       de la molécule ENTIÈRE : les résidus (et l'eau d'un peptide libre) plus les
       deltas des modifications (voir proteinSequenceReadingOf) ;
     • PLUSIEURS MOLÉCULES, UNE PAR LIGNE — le champ peut porter plusieurs
       séquences ; elles sont toutes la même → UNE SEULE description (avec
       « ×N identical »), elles diffèrent → une description PAR séquence, étiquetée
       des molécules qu'elle couvre. La règle de lecture des lignes (ligne au bord
       = une molécule, ligne INDENTÉE = la suite de la précédente) vit dans
       utils/sequenceHighlight.js — une séquence simplement repliée reste donc UNE
       molécule, et la ligne continue de rendre les mêmes nombres.
   ========================================================================= */
import React, { useMemo } from 'react';
import { proteinSequenceReadingOf, compositionTextOf, AA_SIDECHAIN_PKA, TERMINUS_PKA } from '../utils/sequenceCharge';
/* 🎨 LES CINQ LETTRES (K · R en bleu, E · D en rouge, C en orange) ET LES SÉQUENCES MULTIPLES
   (une par ligne, voir l'en-tête) : c'est utils/sequenceHighlight.js qui les définit — le MÊME
   module que la case colorée, donc les lettres en gras d'ici sont celles qui sont peintes
   là-bas, et une molécule décrite ici est une ligne du champ. */
import {
  sequenceLinesOf, moleculePlanOf, moleculeLabelOf, compositionTokensOf, massTextOf,
} from '../utils/sequenceHighlight';

/* LA MISE EN PAGE COMPACTE — « utilising as much horizontal space » : la ligne ET la rangée
   d'une molécule portent exactement la même recette. */
const ROW_CLS = 'flex flex-wrap items-center gap-x-3 gap-y-1';

export const SequenceReadingLine = ({
  reading, sequence, moleculeType = 'protein', modifications = '', ph = 7, className = '',
}) => {
  /* LES MOLÉCULES À DÉCRIRE — une par ligne du champ, dans l'ordre du champ.
     ⚠ LE CALCUL VIT ICI (le module pur), et le CAS ORDINAIRE NE CHANGE PAS : une molécule (ou
     une séquence simplement repliée, que la règle de la continuation reconnaît) donne UNE
     description, rendue exactement comme avant — plus la masse (la demande : « In the
     description add the molecular weight », modifications comprises, voir
     proteinSequenceReadingOf). Quand le champ porte PLUSIEURS séquences (une par molécule),
     elles sont toutes la même → UNE SEULE description, précédée de « ×N identical » (la
     demande : « If the sequences are all the same then the description must refer to only one
     molecule ») ; elles diffèrent → une description PAR séquence, chacune étiquetée des
     molécules qu'elle couvre (« Molecule 2 », « Molecules 1, 3 ») — « if they are different to
     each of them ». Une lecture absente, vide, ou d'un type qui n'a pas d'acides aminés ne rend
     RIEN (jamais une ligne muette). */
  const plan = useMemo(() => {
    if (moleculeType !== 'protein') return null;
    /* (1) LA LECTURE DÉJÀ FAITE (la fiche du composé de la Librairie lit du HTML) : une seule
       molécule, et rien d'autre à décider — le rendu d'avant, au caractère près. */
    if (reading !== undefined) {
      if (!reading || !reading.ok) return null;
      return { molecules: [{ label: '', reading, identicalCount: 0 }] };
    }
    /* (2) LES INGRÉDIENTS BRUTS (les cases de séquence des pages NMR, MD et Docking) : le
       composant lit lui-même le module pur, à pH 7 par défaut. */
    const lines = sequenceLinesOf(sequence);
    const shape = moleculePlanOf(lines);
    if (!shape.count) return null;
    const molecules = shape.molecules.map((entry) => ({
      /* ⚠ UNE SEULE DESCRIPTION QUAND TOUTES SE RESSEMBLENT : pas de numéro (c'est la phrase
         de la demande), le compte des molécules est dit à côté. */
      label: shape.identical ? '' : moleculeLabelOf(entry, shape.count),
      reading: proteinSequenceReadingOf(entry.text, { modifications, ph }),
      identicalCount: shape.identical ? shape.count : 0,
    })).filter((entry) => entry.reading && entry.reading.ok);
    if (!molecules.length) return null;
    return { molecules };
  }, [reading, sequence, moleculeType, modifications, ph]);
  if (!plan) return null;
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 font-mono text-[11px] text-emerald-900 ${className}`.trim()}
      title={`🧬 THE SEQUENCE READ AS A MOLECULE — how many of each amino acid it holds (only those present: a zero teaches nothing), the TOTAL CHARGE AT pH 7, and the ESTIMATED MOLAR EXTINCTION COEFFICIENT ε₂₈₀ (the Pace rule of the cloning panel: Trp 5500 · Tyr 1490 · cystine 125, so a sequence with no Trp, no Tyr and no Cys reads 0 — it really absorbs nothing at 280 nm). ⚠ THIS CHARGE IS NOT THE BOND GRAPH'S: it is utils/sequenceCharge.js — the pKa of EVERY side chain (${Object.keys(AA_SIDECHAIN_PKA).map((aa) => `${aa} ${AA_SIDECHAIN_PKA[aa]}`).join(' · ')}) and of the two termini (N-term ${TERMINUS_PKA.nTerm} · C-term ${TERMINUS_PKA.cTerm}), which is what knows about a histidine's imidazole. TERMINI ARE FREE BY DEFAULT — the rule of this feature: « If the sequence is written directly into the sequence space, assume free termini » — and each one is removed when the Modifications box says so: Acetylation / Acylation / Formylation cap the N-terminus (an amide carries no charge), Amidation caps the C-terminus. Phosphorylation adds one phosphate per unit written (−1,39 e at pH 7). ⚠ THIS LINE IS THE SAME ONE EVERYWHERE — the compound card of the Library and EVERY sequence box of the application (the « … Sequence (1-letter code) » field of the NMR, MD and Docking pages) render this component, from the same module and the same modifications text, and the ⚙ Params & Constraints panel reads that model at the pH you set there. ⚠ THE MASS IS THE WHOLE MOLECULE — the demand: « In the description add the molecular weight »: the residue masses AND the water of a free peptide (the usual reading of a sequence written by hand) PLUS the deltas of the Modifications box (42.01 Da for an Acetylation, −0.98 for an Amidation…), so an acetylated · amidated peptide reads its real mass, exactly as its charge already reads its real caps. ⚠ SEVERAL MOLECULES, ONE PER LINE — a line that starts at the edge of the box BEGINS a molecule, an INDENTED line CONTINUES the one above (that is what a wrapped field, or a paste, gives a single long sequence); when every molecule of the box carries the SAME sequence the description below speaks of ONE molecule and says how many it stands for (×N identical), otherwise each sequence is described for itself and labelled with the molecules it covers (Molecule 2 · Molecules 1, 3). ⚠ THE FIVE BOLD LETTERS ARE THE FIVE COLOURED ONES of the sequence box — K · R (the two basic ones), E · D (the two acidic ones), C (the cysteine) — see utils/sequenceHighlight.js: the box paints them, this line bolds them, and the two readings come from one table.`}
    >
      {plan.molecules.length > 1
        ? plan.molecules.map((entry, i) => (
          <div key={i} className={`${ROW_CLS} w-full`}>{fieldsOf(entry, i)}</div>
        ))
        : fieldsOf(plan.molecules[0], 0)}
    </div>
  );
};

/** LES CHAMPS D'UNE DESCRIPTION — les mêmes que la ligne d'avant (la longueur, la composition,
    la charge à pH 7, les deux terminus dits en mots, l'ε₂₈₀), plus la MASSE, plus ce que le
    multi-molécules ajoute : l'étiquette des molécules couvertes et, quand toutes se
    ressemblent, le compte (« ×N identical »). Les cinq lettres de la demande sont EN GRAS dans
    la composition — exactement les cinq que la case de séquence peint (les deux lectures
    lisent utils/sequenceHighlight.js). */
function fieldsOf(entry, i) {
  const r = entry.reading;
  const { terminus } = r.effects;
  const out = [];
  if (entry.label) {
    out.push(<span key={`label${i}`} className="font-bold text-emerald-700">{entry.label}</span>);
  }
  out.push(<span key={`len${i}`} className="font-bold">{r.length} aa</span>);
  if (entry.identicalCount > 1) {
    out.push(
      <span key={`same${i}`} className="font-bold text-emerald-700">×{entry.identicalCount} identical</span>,
    );
  }
  compositionTokensOf(compositionTextOf(r.composition)).forEach((token, k) => {
    if (k) out.push(<span key={`sep${i}-${k}`}> · </span>);
    out.push(<span key={`aa${i}-${k}`} className={token.marked ? 'font-bold' : undefined}>{token.text}</span>);
  });
  out.push(
    <span key={`net${i}`} className="font-bold">
      net {r.net >= 0 ? '+' : ''}{r.net.toFixed(2)} e at pH 7
    </span>,
  );
  out.push(
    <span key={`term${i}`} className="text-emerald-700">
      {terminus.nTerm === 'free' ? 'free N-term' : terminus.nTerm}
      {' · '}
      {terminus.cTerm === 'free' ? 'free C-term' : terminus.cTerm}
    </span>,
  );
  const mass = massTextOf(r.mw);
  if (mass) out.push(<span key={`mw${i}`} className="font-bold">MW {mass}</span>);
  out.push(<span key={`eps${i}`}>ε₂₈₀ {Math.round(r.epsilon).toLocaleString()} M⁻¹cm⁻¹</span>);
  return out;
}

export default SequenceReadingLine;
