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
   ========================================================================= */
import React, { useMemo } from 'react';
import { proteinSequenceReadingOf, compositionTextOf, AA_SIDECHAIN_PKA, TERMINUS_PKA } from '../utils/sequenceCharge';

export const SequenceReadingLine = ({
  reading, sequence, moleculeType = 'protein', modifications = '', ph = 7, className = '',
}) => {
  /* LA LECTURE — celle de l'appelant, ou celle d'ici : LE MÊME MODULE ET LE MÊME pH 7 pour
     toutes les cases de séquence de l'application. La nature du composé est la porte d'entrée
     des DEUX chemins : seul un type qui a des acides aminés a une lecture à dire. */
  const resolved = useMemo(() => {
    if (moleculeType !== 'protein') return null;
    if (reading !== undefined) return reading;
    return proteinSequenceReadingOf(sequence, { modifications, ph });
  }, [reading, sequence, moleculeType, modifications, ph]);
  if (!resolved || !resolved.ok) return null;
  const { terminus } = resolved.effects;
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 font-mono text-[11px] text-emerald-900 ${className}`.trim()}
      title={`🧬 THE SEQUENCE READ AS A MOLECULE — how many of each amino acid it holds (only those present: a zero teaches nothing), the TOTAL CHARGE AT pH 7, and the ESTIMATED MOLAR EXTINCTION COEFFICIENT ε₂₈₀ (the Pace rule of the cloning panel: Trp 5500 · Tyr 1490 · cystine 125, so a sequence with no Trp, no Tyr and no Cys reads 0 — it really absorbs nothing at 280 nm). ⚠ THIS CHARGE IS NOT THE BOND GRAPH'S: it is utils/sequenceCharge.js — the pKa of EVERY side chain (${Object.keys(AA_SIDECHAIN_PKA).map((aa) => `${aa} ${AA_SIDECHAIN_PKA[aa]}`).join(' · ')}) and of the two termini (N-term ${TERMINUS_PKA.nTerm} · C-term ${TERMINUS_PKA.cTerm}), which is what knows about a histidine's imidazole. TERMINI ARE FREE BY DEFAULT — the rule of this feature: « If the sequence is written directly into the sequence space, assume free termini » — and each one is removed when the Modifications box says so: Acetylation / Acylation / Formylation cap the N-terminus (an amide carries no charge), Amidation caps the C-terminus. Phosphorylation adds one phosphate per unit written (−1,39 e at pH 7). ⚠ THIS LINE IS THE SAME ONE EVERYWHERE — the compound card of the Library and EVERY sequence box of the application (the « … Sequence (1-letter code) » field of the NMR, MD and Docking pages) render this component, from the same module and the same modifications text, and the ⚙ Params & Constraints panel reads that model at the pH you set there.`}
    >
      <span className="font-bold">{resolved.length} aa</span>
      <span>{compositionTextOf(resolved.composition)}</span>
      <span className="font-bold">
        net {resolved.net >= 0 ? '+' : ''}{resolved.net.toFixed(2)} e at pH 7
      </span>
      <span className="text-emerald-700">
        {terminus.nTerm === 'free' ? 'free N-term' : terminus.nTerm}
        {' · '}
        {terminus.cTerm === 'free' ? 'free C-term' : terminus.cTerm}
      </span>
      <span>ε₂₈₀ {Math.round(resolved.epsilon).toLocaleString()} M⁻¹cm⁻¹</span>
    </div>
  );
};

export default SequenceReadingLine;
