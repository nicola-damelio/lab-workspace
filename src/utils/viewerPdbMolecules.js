/* =========================================================================
   src/utils/viewerPdbMolecules.js
   ⬇ LE PDB DE L'ÉCRAN — TOUTES LES MOLÉCULES, ET LA PLACE DE CHACUNE.

   LA DEMANDE : « I need to be able to change the position of one molecule with
   respect to the other, (this changes the pdb). » Déplacer une molécule par
   rapport à une autre EST un contenu : l'arrangement fait partie du fichier. Or
   NGL's PdbWriter writes the ATOM records of ONE structure, and it reads the atom
   coordinates — tandis qu'une molécule placée par ✥ Move · ↻ Rotate ou superposée
   par 🎯 Fit vit dans la MATRICE de sa composante, jamais dans ses coordonnées.

   Ce module assemble donc le fichier que l'écran montre :
     • le bloc de la structure PRINCIPALE, sa tête comprise, sans son « END » ;
     • puis UN bloc par molécule ajoutée, annoncé par un REMARK qui la nomme, et
       réduit à ses records d'atomes (leur « TITLE » et leur « END » n'ont rien à
       faire au milieu du fichier) ;
     • et un seul « END » à la fin.
   Le viewer, lui, ÉCRIT les coordonnées du monde le temps de la production du texte
   (voir downloadFramePdb) : c'est ce qui fait entrer les poses dans le fichier.

   PUR (aucun NGL, aucun DOM) : la sonde _viewer_pdb_molecules_test.mjs l'exécute
   sous node. Un seul bloc rend le texte INCHANGÉ — le fichier d'aujourd'hui ne
   bouge pas tant qu'aucune molécule n'a été ajoutée.
   ========================================================================= */

/** Les records qui portent des ATOMES (le corps d'un fichier PDB). */
export const PDB_BODY_RECORD = /^(ATOM  |HETATM|MODEL |ENDMDL|TER)/;

/** Le corps d'un fichier écrit par NGL : ses records d'atomes, rien d'autre. */
export const pdbBodyOf = (text) => String(text == null ? '' : text)
  .split(/\r?\n/)
  .filter((line) => PDB_BODY_RECORD.test(line));

/**
 * UN fichier PDB pour toutes les molécules de l'écran.
 * @param {Array<{ text: string, name?: string, main?: boolean }>} blocks
 *   le bloc de la principale d'abord (son texte entier est gardé), puis un bloc par
 *   molécule ajoutée (son nom est écrit dans un REMARK).
 * @returns {string} le texte du fichier
 */
export const joinPdbMolecules = (blocks) => {
  const list = (Array.isArray(blocks) ? blocks : []).filter((b) => b && typeof b.text === 'string' && b.text.trim());
  if (!list.length) return '';
  if (list.length === 1) return list[0].text;
  const out = [];
  list.forEach((b, i) => {
    if (i === 0) {
      // Toute la tête de la principale (TITLE / REMARKs), sans son « END » : le fichier
      // n'est pas fini, les autres molécules viennent après.
      b.text.split(/\r?\n/).forEach((line) => { if (!/^END\s*$/.test(line)) out.push(line); });
      return;
    }
    const name = String(b.name == null ? '' : b.name).trim();
    out.push(`REMARK 350 MOLECULE ${name || `#${i + 1}`}`.slice(0, 80));
    pdbBodyOf(b.text).forEach((line) => out.push(line));
  });
  out.push('END');
  return out.join('\n');
};
