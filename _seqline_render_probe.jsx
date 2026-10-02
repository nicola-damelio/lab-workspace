/* Sonde de rendu (SSR) pour _sequence_line_render_test.mjs — LA LIGNE SOUS UNE CASE DE
   SÉQUENCE, rendue pour de vrai, cas par cas. Une ligne par cas, lisible par la suite :

     ok | <cas> | <longueur du HTML> | <a une bulle d'aide (0/1)> | <texte visible> | <classes du div> | <bulle d'aide>

   Le texte visible est le HTML débalisé : c'est EXACTEMENT ce qu'un écran montre. Les deux
   dernières colonnes sortent du HTML (l'attribut class et l'attribut title) pour que la suite
   puisse les lire : la mise en page compacte et l'explication du chiffre, elles aussi. */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SequenceReadingLine } from './src/components/SequenceReadingLine.jsx';
import { proteinSequenceReadingOf } from './src/utils/sequenceCharge.js';

/* LE PEPTIDE DU RAPPORT — 31 résidus, trois lysines, ni Trp ni Tyr ni Cys (ε₂₈₀ = 0). */
const SEQ = 'SIIGIIMGILGNIPQVIQIIMSIVKAFKGNK';

const visible = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const attr = (html, name) => {
  const m = html.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
};

const CASES = [
  ['free termini', { reading: proteinSequenceReadingOf(SEQ, { ph: 7 }), className: 'mb-4' }],
  ['capped termini', { reading: proteinSequenceReadingOf(SEQ, { modifications: 'Acetylation, Amidation', ph: 7 }), className: 'mt-1' }],
  ['reading absent', { reading: null, className: 'mt-1' }],
  ['empty sequence', { reading: proteinSequenceReadingOf('', { ph: 7 }), className: 'mb-4' }],
];

CASES.forEach(([label, props]) => {
  let html = '';
  try {
    html = renderToStaticMarkup(<SequenceReadingLine {...props} />);
  } catch (e) {
    console.log(`threw | ${label} | ${e.message}`);
    return;
  }
  const hasTitle = html.includes('THE SEQUENCE READ AS A MOLECULE') ? 1 : 0;
  console.log(`ok | ${label} | ${html.length} | ${hasTitle} | ${visible(html)} | ${attr(html, 'class')} | ${attr(html, 'title')}`);
});

console.log('RENDER PROBE OK');

