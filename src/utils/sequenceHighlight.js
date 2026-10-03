/* =========================================================================
   src/utils/sequenceHighlight.js — LA COULEUR DES LETTRES D'UNE SÉQUENCE.

   LA DEMANDE, MOT POUR MOT : « when the sequence is inserted in the sequence
   field automatically color K and R in blue, E and D in red and C in orange
   (also in the descriptive line below where R,K, E D ad C should be in bold).
   When multiple molecules are loaded go to newline to write each new
   sequence. If the sequences are all the same then the description must refer
   to only one molecule; if they are different to each of them. In the
   description add the molecular weight. »

   ⚠ CE MODULE EST PUR (aucun React, aucun import) ET C'EST LE POINT : les deux
   endroits qui doivent PARLER LA MÊME LANGUE — la CASE de séquence qui peint
   ses lettres (components/SequenceField.jsx) et la LIGNE qui lit la séquence
   sous la case (components/SequenceReadingLine.jsx, où les mêmes lettres
   passent en gras) — lisent CETTE table. Une lettre ne peut donc pas changer
   de couleur dans l'une sans l'autre, ni une case et une ligne se contredire
   sur ce qui est « basique », « acide » ou « cystéine ».

   LES CINQ LETTRES, ET POURQUOI CELLES-LÀ. La règle de la demande est celle du
   chimiste : deux BASIQUES (K, R — les ammoniums et le guanidinium), deux
   ACIDES (E, D — les deux carboxylates), et C (la cystéine, seule lettre de la
   table qui porte un thiol, donc la seule qui puisse faire un pont disulfure)
   — c'est d'ailleurs la lettre que la page NMR peint déjà à part (le panneau
   « Cysteine states », voir utils/disulfideBonds.js). Les autres acides aminés
   gardent la couleur du texte : c'est l'ORDRE de la séquence qui se lit alors,
   et les cinq sites intéressants qui sautent aux yeux.

   LES SÉQUENCES MULTIPLES — UNE PAR LIGNE. Un champ peut recevoir PLUSIEURS
   séquences : une par molécule, une par ligne (la demande : « when multiple
   molecules are loaded go to newline to write each new sequence »). Ce module
   dit COMMENT ces lignes se relisent :
     • une ligne qui commence au bord du champ COMMENCE une molécule ;
     • une ligne INDENTÉE CONTINUE celle du dessus — c'est ce qu'un champ qui
       se replie (ou un copier-coller) donne d'une séquence un peu longue :
       « SIIGIIMGILGNIPQVIQ\n  IIMSIVKAFKGNK » reste UNE molécule (la ligne
       sous la case rend alors exactement les mêmes nombres qu'avec la
       séquence d'un seul tenant — c'est mesuré) ;
     • une ligne vide ne dit rien (ni molécule, ni continuation).
   Et, comme plusieurs chaînes peuvent porter LA MÊME séquence (un homodimère
   A · B), `moleculePlanOf` RE-GROUPE les lignes par texte : l'appelant peut
   alors décrire une molécule une seule fois — « if the sequences are all the
   same then the description must refer to only one molecule » — tout en disant
   combien de chaînes elle représente, et décrire chaque AUTRE séquence pour
   elle-même — « if they are different to each of them ».
   ========================================================================= */

/** LES CINQ LETTRES COULEURÉES — la table de la demande, et rien d'autre.
 *  Deux basiques (K · R), deux acides (E · D), la cystéine (C). */
export const RESIDUE_COLOURS = Object.freeze({
  K: 'blue',
  R: 'blue',
  E: 'red',
  D: 'red',
  C: 'orange',
});

/** Une couleur de la table, en mot, et la classe Tailwind qui la peint. Les
 *  teintes sont celles de l'application (les mêmes familles que les pastilles
 *  de charge : bleu = positif, rouge = négatif — et l'orange, seul, pour le
 *  soufre qui peut se lier). */
export const RESIDUE_COLOUR_CLASSES = Object.freeze({
  blue: 'text-blue-600',
  red: 'text-red-600',
  orange: 'text-orange-500',
});

/** Les cinq lettres, dans l'ordre de l'alphabet (une table complète se lit). */
export const MARKED_LETTERS = Object.freeze(Object.keys(RESIDUE_COLOURS).sort());

/** LA COULEUR D'UNE LETTRE — `null` pour tout le reste (qui garde la couleur
 *  du texte). Insensible à la casse : une case de séquence n'est pas obligée
 *  d'être en majuscules pour être colorée. */
export const residueColourOf = (letter) => RESIDUE_COLOURS[String(letter == null ? '' : letter).toUpperCase()] || null;

/** La classe Tailwind d'une couleur de la table (`null` reste la couleur du texte). */
export const residueColourClassOf = (letter) => {
  const colour = residueColourOf(letter);
  return colour ? RESIDUE_COLOUR_CLASSES[colour] : null;
};

/** LA LETTRE EST-ELLE BOLD DANS LA LIGNE DE LECTURE ? C'est EXACTEMENT la même
 *  table : la demande veut les cinq lettres en gras sous la case, celles que la
 *  case peint. Une seule question, donc, et une seule réponse. */
export const residueIsMarked = (letter) => residueColourOf(letter) !== null;

/** LE TEXTE DÉCOUPÉ EN PLAGES DE COULEUR — ce qu'un rendu a besoin de savoir
 *  pour peindre la case : des morceaux de texte qui se suivent et qui portent
 *  la même couleur (`colour: null` = la couleur du texte). Les espaces et les
 *  retours à la ligne SONT GARDÉS : la couche colorée doit se superposer
 *  exactement au texte du champ, trous compris.
 *
 *  Exemple : « MKWV\nDE » → [ { text: 'M', colour: null }, { text: 'KW',
 *  colour: 'blue' }, { text: 'V\n', colour: null }, { text: 'DE',
 *  colour: 'red' } ] — deux plages consécutives ne partagent jamais la même
 *  couleur : c'est ce qui rend la liste testable telle quelle. */
export const colourRunsOf = (text) => {
  const source = String(text == null ? '' : text);
  const runs = [];
  for (const ch of source) {
    const colour = residueColourOf(ch);
    const last = runs[runs.length - 1];
    if (last && last.colour === colour) last.text += ch;
    else runs.push({ text: ch, colour });
  }
  return runs;
};

/** LES LETTRES D'UNE LIGNE DE CHAMP — en majuscules, tout ce qui n'est pas une
 *  lettre écarté. `''` pour une ligne vide (ou faite d'espaces). */
export const lineLettersOf = (line) => String(line == null ? '' : line)
  .toUpperCase()
  .replace(/[^A-Z]/g, '');

/** LES SÉQUENCES D'UN CHAMP — une entrée par MOLÉCULE, dans l'ordre du champ.
 *
 *  ⚠ LA RÈGLE DE LA CONTINUATION (voir l'en-tête) : une ligne qui commence par
 *  une espace ou une tabulation CONTINUE la molécule du dessus ; une ligne qui
 *  commence au bord en COMMENCE une. C'est ce qui distingue « deux chaînes »
 *  (deux lignes au bord) de « une séquence un peu longue, repliée » (une ligne
 *  au bord, puis des lignes en retrait) — sans cette règle, une séquence
 *  coupée en deux par un champ compterait deux molécules, et la ligne sous la
 *  case se mettrait à décrire deux fois la même. Un champ VIDE (ou d'espaces)
 *  ne rend AUCUNE molécule. */
export const sequenceLinesOf = (text) => {
  const out = [];
  String(text == null ? '' : text).split(/\r?\n/).forEach((line) => {
    const letters = lineLettersOf(line);
    if (!letters) return;                              // une ligne vide ne dit rien
    const continues = /^[ \t]/.test(line) && out.length > 0;
    if (continues) out[out.length - 1] += letters;
    else out.push(letters);
  });
  return out;
};

/** LE PLAN DES MOLÉCULES D'UN CHAMP — les LIGNES re-groupées par TEXTE.
 *
 *  `{ count, molecules: [{ text, lines: [1, 2] }], distinct, identical }` :
 *    • `count`     le nombre de molécules (de lignes) du champ ;
 *    • `molecules` une entrée par TEXTE DISTINCT, dans l'ordre d'apparition,
 *                  avec les numéros (à partir de 1) des molécules qui le
 *                  portent — un homodimère A · B donne donc UNE entrée,
 *                  `lines: [1, 2]` ;
 *    • `identical` `true` quand toutes les molécules du champ portent le même
 *                  texte (la demande : « the description must refer to only
 *                  one molecule ») ;
 *    • `distinct`  le nombre d'entrées de `molecules`.
 *  Un champ vide rend `{ count: 0, molecules: [], distinct: 0, identical:
 *  false }` : rien à décrire, donc rien de « identique ». */
export const moleculePlanOf = (lines) => {
  const list = Array.isArray(lines) ? lines.filter(Boolean) : [];
  const byText = new Map();
  const molecules = [];
  list.forEach((text, i) => {
    let entry = byText.get(text);
    if (!entry) {
      entry = { text, lines: [] };
      byText.set(text, entry);
      molecules.push(entry);
    }
    entry.lines.push(i + 1);
  });
  return {
    count: list.length,
    molecules,
    distinct: molecules.length,
    identical: list.length > 0 && molecules.length === 1,
  };
};

/** LE LIBELLÉ DES MOLÉCULES QU'UNE DESCRIPTION COUVRE — « Molecule 3 », ou
 *  « Molecules 1, 2 » quand plusieurs chaînes portent la même séquence. Une
 *  seule molécule ne se nomme pas dans la ligne (c'est le cas ordinaire, et un
 *  « Molecule 1 » devant chaque case serait du bruit) : `''`. */
export const moleculeLabelOf = (molecule, count = null) => {
  const lines = (molecule && Array.isArray(molecule.lines)) ? molecule.lines : [];
  if (!lines.length) return '';
  if (lines.length === 1) return (count == null || count <= 1) ? '' : `Molecule ${lines[0]}`;
  return `Molecules ${lines.join(', ')}`;
};

/** LA COMPOSITION DÉCOUPÉE EN JETONS — « A 3 · C 1 · K 2 » devient trois jetons
 *  `{ text, letter, marked }` : `A 3` (non marqué), `C 1` (marqué, la cystéine),
 *  `K 2` (marqué, une basique). C'est ce qu'il faut pour mettre EN GRAS les cinq
 *  lettres de la demande sans toucher au reste de la ligne, et sans qu'un jeton
 *  puisse être coupé au mauvais endroit (le `·` n'appartient à personne : il est
 *  rendu entre les jetons par l'appelant).
 *  `text` reste EXACTEMENT le texte affiché : rien n'est recomposé ici. */
export const compositionTokensOf = (compositionText) => String(compositionText == null ? '' : compositionText)
  .trim()
  .split(' · ')
  .filter(Boolean)
  .map((text) => ({
    text,
    letter: text.slice(0, 1).toUpperCase(),
    marked: residueIsMarked(text.slice(0, 1)),
  }));

/** LE POIDS MOLÉCULAIRE EN MOTS — « 3 496.28 Da ». Une masse absente (ou nulle)
 *  ne s'écrit pas : `''` (une ligne ne montre jamais un « 0 Da » qui n'existe
 *  pas). Le séparateur de milliers est celui du poste, comme partout dans
 *  l'application (`toLocaleString`). */
export const massTextOf = (mass) => {
  const n = Number(mass);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} Da`;
};
