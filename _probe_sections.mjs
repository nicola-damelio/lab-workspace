/* _probe_sections.mjs — DIAGNOSTIC (comme _probe_hdr.mjs / _probe_cites.mjs) :
     • ce que l'import COMPREND de l'en-tête (titre / auteurs / affiliations,
       ligne par ligne, avec leur rôle) ;
     • la SECTION que chaque partie va remplir (Scientific background,
       Results and Discussion, 🧪 Materials & Methods…) ;
     • où tombe la ligne de l'auteur CORRESPONDANT (e-mails).
   Usage : node _probe_sections.mjs [fichier.docx|.html|.txt]
   La sortie est écrite dans _probe_sections.txt (UTF-8). */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
register('./_esm_test_hook.mjs', import.meta.url);

const MI = await import('./src/utils/manuscriptImport.js');

const DOCS = {};
DOCS['revue-numerotee'] = `Aphid transmission of a new potyvirus infecting pepper crops in southern Italy
Mario Rossi1, Anna Bianchi1,2, Jean Dupont2
1 Dipartimento di Agraria, Università degli Studi di Napoli Federico II, Portici, Italy
2 INRAE, UMR Biologie du Fruit et Pathologie, Villenave d'Ornon, France
*Corresponding authors: Mario Rossi (mario.rossi@unina.it), Jean Dupont (jean.dupont@inrae.fr)
Abstract
The potyvirus was transmitted by aphids in a persistent manner.
1. Introduction
Pepper crops are affected by several viruses [1].
2. Materials and Methods
Plants were grown in a greenhouse.
3. Results and Discussion
Aphids transmitted the virus efficiently.
4. Conclusions
The new potyvirus spreads in southern Italy.
References
Rossi M, Bianchi A. A new potyvirus. J Virol 12, 34-40 (2021).`;

DOCS['intitules-point-final'] = `Aphid transmission of a new potyvirus infecting pepper crops
Mario Rossi1, Anna Bianchi1, Jean Dupont2
1 Dipartimento di Agraria, Universita di Napoli, Portici, Italy
2 INRAE, Villenave d'Ornon, France
Correspondence: mario.rossi@unina.it
1. Introduction.
Pepper crops are affected by several viruses [1].
2. Materials and Methods.
Plants were grown in a greenhouse.
3. Results and Discussion.
Aphids transmitted the virus efficiently.
4. Conclusions.
The new potyvirus spreads in southern Italy.`;

DOCS['auteurs-exposants-unicode'] = `Aphid transmission of a new potyvirus infecting pepper crops
Mario Rossi\u00b9, Anna Bianchi\u00b9\u00b2, Jean Dupont\u00b2
\u00b9 Dipartimento di Agraria, Universita di Napoli, Portici, Italy
\u00b2 INRAE, Villenave d'Ornon, France
*Corresponding authors: mario.rossi@unina.it; jean.dupont@inrae.fr
Abstract
The potyvirus was transmitted by aphids.
1. Introduction
Pepper crops are affected by several viruses [1].
2. Materials and Methods
Plants were grown in a greenhouse.
3. Results
Aphids transmitted the virus efficiently.
4. Discussion
The results confirm the transmission.
5. Conclusions
The new potyvirus spreads in southern Italy.`;

DOCS['auteurs-and-amp'] = `Aphid transmission of a new potyvirus infecting pepper crops
Mario Rossi, Anna Bianchi and Jean Dupont
Dipartimento di Agraria, Universita di Napoli, Portici, Italy
INRAE, Villenave d'Ornon, France
Correspondence: mario.rossi@unina.it
Abstract
The potyvirus was transmitted by aphids.
1. Introduction
Pepper crops are affected by several viruses [1].
2. Materials and Methods
Plants were grown in a greenhouse.`;

DOCS['mm-experimental'] = `Aphid transmission of a new potyvirus infecting pepper crops
Mario Rossi1, Anna Bianchi1
1 Dipartimento di Agraria, Universita di Napoli, Portici, Italy
1. Introduction
Pepper crops are affected by several viruses [1].
2. Experimental part
2.1 Plant material
Plants were grown in a greenhouse.
2.2 DNA extraction
Total RNA was extracted.
3. Statistical analysis
Data were analysed with R.
4. Results and Discussion
Aphids transmitted the virus efficiently.
5. Conclusions
The virus spreads in southern Italy.`;

DOCS['entete-long'] = `Journal of Plant Pathology
Received: 12 January 2024
Accepted: 3 March 2024
Published: 20 March 2024
https://doi.org/10.1007/s42161-024-0001-2
Aphid transmission of a new potyvirus infecting pepper crops
Mario Rossi1, Anna Bianchi1, Jean Dupont2
1 Dipartimento di Agraria, Universita di Napoli Federico II, Portici, Italy
2 INRAE, UMR Biologie du Fruit, Villenave d'Ornon, France
3 Department of Plant Pathology, North Carolina State University, Raleigh, USA
4 Laboratoire de Virologie, Institut Pasteur, Paris, France
5 Centre for Plant Health, Agroscope, Nyon, Switzerland
*Corresponding authors: Mario Rossi (mario.rossi@unina.it), Anna Bianchi (anna.bianchi@unina.it), Jean Dupont (jean.dupont@inrae.fr)
Abstract
The potyvirus was transmitted by aphids in a persistent manner.
Keywords: potyvirus, aphids, pepper
1. Introduction
Pepper crops are affected by several viruses [1].
2. Materials and Methods
Plants were grown in a greenhouse.
3. Results and Discussion
Aphids transmitted the virus efficiently.
4. Conclusions
The new potyvirus spreads in southern Italy.`;

DOCS['material-and-methods'] = `Aphid transmission of a new potyvirus infecting pepper crops
Mario Rossi1, Anna Bianchi1, Jean Dupont2
1 Dipartimento di Agraria, Universita di Napoli, Portici, Italy
2 INRAE, Villenave d'Ornon, France
Corresponding author: mario.rossi@unina.it
Scientific background
Pepper crops are affected by several viruses [1].
Material and methods
Plants were grown in a greenhouse.
Results and discussion
Aphids transmitted the virus efficiently.
Conclusions
The new potyvirus spreads in southern Italy.`;

DOCS['majuscules-romain'] = `APHID TRANSMISSION OF A NEW POTYVIRUS IN PEPPER CROPS
MARIO ROSSI1, ANNA BIANCHI1, JEAN DUPONT2
1 DIPARTIMENTO DI AGRARIA, UNIVERSITA DI NAPOLI, PORTICI, ITALY
2 INRAE, VILLENAVE D'ORNON, FRANCE
* CORRESPONDING AUTHORS: MARIO.ROSSI@UNINA.IT, JEAN.DUPONT@INRAE.FR
I. INTRODUCTION
PEPPER CROPS ARE AFFECTED BY SEVERAL VIRUSES [1].
II. MATERIALS AND METHODS
PLANTS WERE GROWN IN A GREENHOUSE.
III. RESULTS AND DISCUSSION
APHIDS TRANSMITTED THE VIRUS EFFICIENTLY.
IV. CONCLUSIONS
THE NEW POTYVIRUS SPREADS IN SOUTHERN ITALY.`;

DOCS['background-and-aims'] = `Aphid transmission of a new potyvirus infecting pepper crops
Mario Rossi1, Anna Bianchi1, Jean Dupont2
1 Dipartimento di Agraria, Universita di Napoli, Portici, Italy
2 INRAE, Villenave d'Ornon, France
Correspondence: mario.rossi@unina.it
Background and aims
Pepper crops are affected by several viruses [1].
Methods
Plants were grown in a greenhouse.
Results
Aphids transmitted the virus efficiently.
Discussion
The results confirm the transmission.
Conclusions
The new potyvirus spreads in southern Italy.`;

DOCS['keywords-avant-correspondant'] = `Aphid transmission of a new potyvirus infecting pepper crops
Mario Rossi1, Anna Bianchi1, Jean Dupont2
1 Dipartimento di Agraria, Universita di Napoli, Portici, Italy
2 INRAE, Villenave d'Ornon, France
Keywords: potyvirus, aphids, pepper
*Corresponding authors: mario.rossi@unina.it; jean.dupont@inrae.fr
Abstract
The potyvirus was transmitted by aphids.
1. Introduction
Pepper crops are affected by several viruses [1].
2. Materials and Methods
Plants were grown in a greenhouse.
3. Conclusions
The new potyvirus spreads in southern Italy.`;

DOCS['intitule-avant-introduction'] = `Aphid transmission of a new potyvirus infecting pepper crops
Mario Rossi1, Anna Bianchi1
1 Dipartimento di Agraria, Universita di Napoli, Portici, Italy
Highlights
A new potyvirus was found in pepper.
Introduction
Pepper crops are affected by several viruses [1].
Materials and Methods
Plants were grown in a greenhouse.
Results
Aphids transmitted the virus efficiently.
Conclusions
The new potyvirus spreads in southern Italy.`;

const out = [];
const say = (line) => out.push(line);
const show = (label, value) => say(`  ${label} : ${value}`);

const report = (name, text) => {
  const ms = MI.splitManuscript(MI.blocksFromText(text));
  const header = MI.parseManuscriptHeader(ms.body);
  const parts = MI.withDocumentSections(MI.groupManuscriptParts(ms.body, { header }));
  say(`\n==== ${name}`);
  show('titre ', `« ${header.title} »`);
  show('auteur', `« ${header.authors} »`);
  show('affil.', `« ${(header.affiliations || '').replace(/\n/g, ' | ')} »`);
  const missing = ['title', 'authors', 'affiliations'].filter((f) => !String(header[f] || '').trim());
  say(`  -- MANQUANT : ${missing.length ? missing.join(', ') : 'aucun'}`);
  say('  -- LIGNES D EN-TETE');
  (header.lines || []).forEach((l) => say(`     [${l.role}] ${l.text.slice(0, 110)}`));
  say('  -- PARTIES -> SECTION');
  parts.forEach((p) => {
    const dest = p.id === MI.METHODS_DEST.id ? 'MATERIALS & METHODS' : (p.id || '-- a choisir --');
    const guess = p.autoSection ? ` (position: ${p.autoSection})` : '';
    say(`     « ${(p.heading || '(sans intitule)').slice(0, 46)} » -> ${dest}${guess}`);
    say(`        texte : ${(p.text || '').replace(/\n/g, ' / ').slice(0, 90)}`);
  });
};

Object.entries(DOCS).forEach(([name, text]) => report(name, text));

/* Un fichier passé en argument : VOTRE document, ligne par ligne. */
const fileArg = process.argv[2];
if (fileArg) {
  const buf = readFileSync(fileArg);
  const fake = {
    name: fileArg,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    text: async () => buf.toString('utf8')
  };
  const doc = await MI.readManuscriptDocument(fake);
  report(`FICHIER ${fileArg}`, doc.text);
}

/* ── Les ÉCRITURES d'une liste d'auteurs, une par une : la ligne est-elle
   reconnue quand elle est EXACTEMENT à sa place (juste sous le titre, avant les
   affiliations) ? C'est le défaut signalé. ───────────────────────────────── */
const AUTHOR_LINES = [
  'Mario Rossi1, Anna Bianchi1, Jean Dupont2',
  'Maria Grazia Rossi1, Anna Bianchi1',
  'Mario Rossi¹, Anna Bianchi¹, Jean Dupont²',
  'Mario Rossiᵃ, Anna Bianchiᵇ',
  'Mario Rossi1*, Anna Bianchi1, Jean Dupont2',
  'Mario Rossi, Anna Bianchi',
  'Mario Rossi, Anna Bianchi and Jean Dupont',
  'Mario Rossi1, Anna Bianchi2, and Jean Dupont3',
  'ROSSI, M., BIANCHI, A.',
  'Rossi M, Bianchi A, et al.',
  'M. Rossi, A. Bianchi',
  'Jan van der Berg1, Anna de la Cruz2',
  'Jean-Luc Dupont1, Anna O’Brien2',
  'Mario Rossi (1), Anna Bianchi (2)',
  '1 Mario Rossi, 2 Anna Bianchi',
  'Mario Rossi a, Anna Bianchi b, Jean Dupont c',
  'Mario Rossi[1], Anna Bianchi[1,2]',
  'Mario Rossi1, Anna Bianchi1, Jean Dupont2, Lucia Bianchi3',
  'Mario Rossi1†, Anna Bianchi1‡'
];
say('\n==== ÉCRITURES D UNE LISTE D AUTEURS (titre, AUTEURS, affiliation, e-mail)');
AUTHOR_LINES.forEach((line) => {
  const doc = `Aphid transmission of a new potyvirus in pepper crops\n${line}\n1 Dipartimento di Agraria, Universita di Napoli, Portici, Italy\n*Corresponding author: mario.rossi@unina.it`;
  const header = MI.parseManuscriptHeader(MI.blocksFromText(doc));
  const ok = header.authors ? 'OK  ' : 'VIDE';
  say(`  ${ok} « ${line} »`);
  if (header.authors) say(`        -> « ${header.authors} » | affil. ${(header.affiliations || '').split('\n').length} ligne(s)`);
});

/* La sortie va sur la console (comme _probe_hdr.mjs) : `node _probe_sections.mjs`
   affiche les dix documents d'essai, les dix-neuf écritures d'une liste
   d'auteurs, et — avec un argument — VOTRE manuscrit, ligne par ligne. */
out.forEach((line) => console.log(line));

