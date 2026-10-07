/* =========================================================================
   src/components/SequenceField.jsx — LA CASE DE SÉQUENCE, LETTRES COLORÉES.

   LA DEMANDE, MOT POUR MOT : « when the sequence is inserted in the sequence
   field automatically color K and R in blue, E and D in red and C in orange
   (also in the descriptive line below where R,K, E D ad C should be in bold) ».

   ⚠ POURQUOI UNE COUCHE SOUS LA CASE, ET PAS UNE CASE RICHE. Le champ d'une
   page est un `<textarea>` : un vrai champ de saisie, avec son curseur, sa
   sélection, son collage, son annuler/rétablir et ses raccourcis. On ne le
   remplace donc PAS (un `contenteditable` perdrait tout cela, et le champ est
   aujourd'hui ce que les trois pages écrivent dans la condition) : on le laisse
   tel quel, on rend son TEXTE transparent (`text-transparent`, le curseur
   gardant sa couleur par `caret-*`) et on peint les lettres DERRIÈRE lui, dans
   une couche au MÊME texte, aux MÊMES classes de police — mêmes marges, même
   interligne, même `tracking-widest`, même `uppercase`, même `break-all`, donc
   les lettres tombent EXACTEMENT sous celles du champ. Les couleurs viennent de
   utils/sequenceHighlight.js : la ligne de lecture, sous la case, lit la même
   table (ces lettres-là y sont en gras), donc la case et sa lecture ne peuvent
   pas diverger.
   ⚠ LA SÉLECTION RESTE LISIBLE : la surbrillance du navigateur se pose SUR la
   couche colorée, donc elle doit laisser passer les lettres — c'est la règle
   `.lab-seq-field::selection` de src/index.css (un bleu translucide), pas un
   aplat opaque qui cacherait le texte sélectionné.
   ⚠ LE DÉFILEMENT SUIT : une séquence plus longue que la case défile ; la
   couche est recollée au champ à chaque `scroll` (sans quoi les couleurs
   glisseraient d'une ligne à l'autre sur une longue séquence).
   ⚠ LE CONTRAT DE `onChange` EST LA VALEUR TAPÉE, PAS L'ÉVÉNEMENT — et c'est
   `emitValue`, ci-dessous, qui le tient. Le champ est un VRAI `<textarea>` :
   React lui donne un Événement, alors que les trois pages qui posent cette case
   écrivent `updateActiveTest(sequencePatchForMoleculeType(activeTest,
   d.moleculeType, v))` — elles attendent donc le TEXTE. Tant que l'événement
   descendait jusqu'au patch, `String(événement)` y écrivait « [object Object] » :
   la case affichait ce texte à la place de la séquence (la saisie était perdue)
   et le bandeau 🖌️ de la structure secondaire, qui lit `parsedSeq`, n'avait plus
   rien à peindre. Une seule conversion, ici, pour les trois pages.
   ========================================================================= */
import React, { useRef } from 'react';
import { colourRunsOf, RESIDUE_COLOUR_CLASSES } from '../utils/sequenceHighlight';

/** Les invites de la case — celles des pages, au même endroit pour les trois. */
export const SEQUENCE_PLACEHOLDERS = Object.freeze({
  protein: 'e.g. MKWVTFISLL...',
  dna: 'e.g. ATGCGTAC...',
  rna: 'e.g. AUGCGUAC...',
});

/** La classe de la CASE elle-même (la couche colorée, elle, a la sienne) :
 *  toutes les pages partagent ce dessin, `className` ne fait que l'étendre. */
const FIELD_BASE_CLS = 'relative w-full border border-slate-300 rounded-lg p-3 font-mono text-sm '
  + 'tracking-widest outline-none focus:border-blue-500 uppercase bg-transparent text-transparent '
  + 'caret-slate-900 placeholder:text-slate-400 whitespace-pre-wrap break-all shadow-inner';
/* La couche : la MÊME boîte (`inset-0`, mêmes marges, même police) — voir
   l'en-tête. `pointer-events-none` : c'est le champ qui reçoit le clic et le
   clavier, jamais la couche. */
const MIRROR_CLS = 'absolute inset-0 overflow-hidden rounded-lg p-3 font-mono text-sm '
  + 'tracking-widest uppercase whitespace-pre-wrap break-all pointer-events-none select-none';

export const SequenceField = ({
  value = '',
  onChange,
  moleculeType = 'protein',
  readOnly = false,
  className = 'h-24 custom-scrollbar',
  placeholder = null,
  ariaLabel = null,
}) => {
  const areaRef = useRef(null);
  const mirrorRef = useRef(null);
  /* LE DÉFILEMENT — la couche est une copie : elle doit regarder au même
     endroit que le champ, sinon les couleurs d'une longue séquence glissent. */
  const followScroll = () => {
    const area = areaRef.current;
    const mirror = mirrorRef.current;
    if (!area || !mirror) return;
    mirror.scrollTop = area.scrollTop;
    mirror.scrollLeft = area.scrollLeft;
  };
  /* LE TEXTE, JAMAIS L'ÉVÉNEMENT — le champ est un `<textarea>` : React lui
     donne un Événement, les appelants (NMR · MD · Docking) attendent la valeur
     tapée. La conversion se fait ICI, une seule fois pour les trois cases. Un
     appelant qui donne déjà un texte (une sonde, un banc) reste servi : la garde
     `e && e.target` le laisse passer tel quel. */
  const emitValue = (e) => {
    if (typeof onChange !== 'function') return;
    onChange(e && e.target ? e.target.value : e);
  };
  const runs = colourRunsOf(value);
  return (
    <div className="relative bg-white rounded-lg">
      <div ref={mirrorRef} aria-hidden="true" className={MIRROR_CLS}>
        {runs.map((run, i) => (run.colour
          ? <span key={i} className={RESIDUE_COLOUR_CLASSES[run.colour]}>{run.text}</span>
          : <span key={i}>{run.text}</span>))}
      </div>
      <textarea
        ref={areaRef}
        value={value}
        onChange={emitValue}
        onScroll={followScroll}
        readOnly={readOnly}
        spellCheck={false}
        aria-label={ariaLabel || undefined}
        placeholder={placeholder || SEQUENCE_PLACEHOLDERS[moleculeType] || SEQUENCE_PLACEHOLDERS.protein}
        className={`lab-seq-field ${FIELD_BASE_CLS} ${className}`.trim()}
      />
    </div>
  );
};

export default SequenceField;
