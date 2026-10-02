/* =========================================================================
   src/components/SequenceReadingLine.jsx — LA LIGNE SOUS UNE CASE DE SÉQUENCE.

   LA DEMANDE, MOT POUR MOT : « Under the sequence field please write the number
   of each type of aminoacids, the total charge at pH 7 and the estimated molar
   extinction coefficient. Keep this information compact utilising as much
   horizontal space. In the library the compound are defined with their
   modification, like acetylation or amidation. the charge should keep this into
   account. »

   ⚠ UN SEUL RENDU POUR TOUTES LES CASES DE SÉQUENCE — les DEUX cases où l'on
   écrit une séquence protéique rendent CE composant :
     • la fiche du composé de la Librairie (AppModules/compoundDefinitionSection,
       la case « One-letter sequence », sa case Modifications juste à côté) ;
     • la case « … Sequence (1-letter code) » de la page NMR
       (NMRSections › MolecularStructureSection).
   Les deux lisent le MÊME module pur — utils/sequenceCharge.js —, avec le MÊME
   texte de modifications et le MÊME pH 7 : deux copies du JSX ne peuvent pas
   diverger, et la ligne ne peut pas contredire le ⚙ Params & Constraints, qui
   lit ce module-là au pH de sa case.

   `reading` est le retour de `proteinSequenceReadingOf(seq, { modifications,
   ph: 7 })` : `ok` (la séquence n'est pas vide), `length`, `composition`,
   `net`, `effects.terminus`, `epsilon`. RIEN n'est recalculé ici, et un
   `reading` absent — ou vide — ne rend RIEN (jamais une ligne muette).
   ========================================================================= */
import React from 'react';
import { compositionTextOf, AA_SIDECHAIN_PKA, TERMINUS_PKA } from '../utils/sequenceCharge';

export const SequenceReadingLine = ({ reading, className = '' }) => {
  if (!reading || !reading.ok) return null;
  const { terminus } = reading.effects;
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 font-mono text-[11px] text-emerald-900 ${className}`.trim()}
      title={`🧬 THE SEQUENCE READ AS A MOLECULE — how many of each amino acid it holds (only those present: a zero teaches nothing), the TOTAL CHARGE AT pH 7, and the ESTIMATED MOLAR EXTINCTION COEFFICIENT ε₂₈₀ (the Pace rule of the cloning panel: Trp 5500 · Tyr 1490 · cystine 125, so a sequence with no Trp, no Tyr and no Cys reads 0 — it really absorbs nothing at 280 nm). ⚠ THIS CHARGE IS NOT THE BOND GRAPH'S: it is utils/sequenceCharge.js — the pKa of EVERY side chain (${Object.keys(AA_SIDECHAIN_PKA).map((aa) => `${aa} ${AA_SIDECHAIN_PKA[aa]}`).join(' · ')}) and of the two termini (N-term ${TERMINUS_PKA.nTerm} · C-term ${TERMINUS_PKA.cTerm}), which is what knows about a histidine's imidazole. TERMINI ARE FREE BY DEFAULT — the rule of this feature: « If the sequence is written directly into the sequence space, assume free termini » — and each one is removed when the Modifications box says so: Acetylation / Acylation / Formylation cap the N-terminus (an amide carries no charge), Amidation caps the C-terminus. Phosphorylation adds one phosphate per unit written (−1,39 e at pH 7). ⚠ THIS LINE IS THE SAME ONE EVERYWHERE — the compound card of the Library and this page's sequence box render it from the same module and the same modifications text, and the ⚙ Params & Constraints panel reads that model at the pH you set there.`}
    >
      <span className="font-bold">{reading.length} aa</span>
      <span>{compositionTextOf(reading.composition)}</span>
      <span className="font-bold">
        net {reading.net >= 0 ? '+' : ''}{reading.net.toFixed(2)} e at pH 7
      </span>
      <span className="text-emerald-700">
        {terminus.nTerm === 'free' ? 'free N-term' : terminus.nTerm}
        {' · '}
        {terminus.cTerm === 'free' ? 'free C-term' : terminus.cTerm}
      </span>
      <span>ε₂₈₀ {Math.round(reading.epsilon).toLocaleString()} M⁻¹cm⁻¹</span>
    </div>
  );
};

export default SequenceReadingLine;
