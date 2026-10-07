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
/* LA MÊME SÉQUENCE, coupée en deux lignes comme un champ de saisie la reçoit parfois. */
const WRAPPED = `${SEQ.slice(0, 16)}\n  ${SEQ.slice(16)}`;

const visible = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const attr = (html, name) => {
  const m = html.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
};

const CASES = [
  /* LES DEUX FAÇONS D'APPELER LA LIGNE — et elles doivent donner LE MÊME texte : */
  /*  (1) la lecture déjà faite par l'appelant (la fiche du composé, qui lit du HTML)… */
  ['free termini', { reading: proteinSequenceReadingOf(SEQ, { ph: 7 }), className: 'mb-4' }],
  ['capped termini', { reading: proteinSequenceReadingOf(SEQ, { modifications: 'Acetylation, Amidation', ph: 7 }), className: 'mt-1' }],
  /*  (2) …et les ingrédients bruts (les cases de séquence des pages NMR, MD et Docking) :
     le composant calcule alors lui-même, à pH 7, avec les modifications données. */
  ['sequence props', { sequence: SEQ, moleculeType: 'protein', modifications: '', className: 'mt-1' }],
  ['sequence capped', { sequence: SEQ, modifications: 'Acetylation, Amidation', className: 'mt-1' }],
  ['sequence wrapped', { sequence: WRAPPED, className: 'mt-1' }],
  /*  ⚠ LE PIÈGE DU HTML — la case de la Librairie est un RichTextEditor : les lettres des
      BALISES (« div ») se compteraient comme des acides aminés si l'appelant ne débalisait
      pas. Cette case EXISTE pour que la suite puisse le montrer (37 aa au lieu de 31). */
  ['html sequence', { sequence: `<div>${SEQ}</div>`, className: 'mb-4' }],
  /*  RIEN À DIRE — aucun HTML : */
  ['reading absent', { reading: null, className: 'mt-1' }],
  ['empty sequence', { reading: proteinSequenceReadingOf('', { ph: 7 }), className: 'mb-4' }],
  ['empty sequence prop', { sequence: '', className: 'mt-1' }],
  ['spaces only', { sequence: '   \n  ', className: 'mt-1' }],
  ['dna sequence', { sequence: 'ATGCATGCATGC', moleculeType: 'dna', className: 'mt-1' }],
  ['sugar sequence', { sequence: 'ATGCATGCATGC', moleculeType: 'sugar', className: 'mt-1' }],
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

