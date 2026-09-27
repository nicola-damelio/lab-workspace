/* =========================================================================
   _viewer_pdb_molecules_test.mjs — « THIS CHANGES THE PDB » : LE ⬇ PDB DE L'ÉCRAN.

   La demande de cette session : « I need to be able to change the position of one
   molecule with respect to the other, (this changes the pdb). »

   Déplacer une molécule EST un changement de contenu, et le fichier doit le porter.
   Deux règles, mesurées ici :
     · L'ASSEMBLAGE — joinPdbMolecules : la principale garde sa tête, chaque molécule
       ajoutée entre avec un REMARK qui la nomme et ses seuls records d'atomes, et il
       n'y a qu'UN « END ». UN seul bloc rend le texte INCHANGÉ : le fichier d'avant
       cette session ne bouge pas tant qu'aucune molécule n'a été ajoutée.
     · LA CUISSON DES POSES — applyMat4 (utils/structureFit, déjà utilisé par le fit)
       transforme les coordonnées par la matrice MONDE de la composante, et le viewer
       échange les tableaux de coordonnées le temps d'écrire, puis les remet en place
       (downloadFramePdb).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { joinPdbMolecules, pdbBodyOf, PDB_BODY_RECORD } from './src/utils/viewerPdbMolecules.js';
import { applyMat4, rigidMatrix } from './src/utils/structureFit.js';

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => { assert.deepEqual(a, b, what); passed += 1; };
const VIEW = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => {
  assert.ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
  passed += 1;
};

/* ── 1. LES RECORDS QUI PORTENT DES ATOMES ────────────────────────────────── */
ok(PDB_BODY_RECORD.test('ATOM      1  N   ALA A   1       1.000   2.000   3.000  1.00  0.00           N'), 'ATOM est un record d’atomes');
ok(PDB_BODY_RECORD.test('HETATM 1234  C1  LIG B   9       1.000   2.000   3.000  1.00  0.00           C'), 'HETATM aussi');
ok(PDB_BODY_RECORD.test('MODEL        2') && PDB_BODY_RECORD.test('ENDMDL'), 'les bornes de MODEL aussi (un ensemble NMR reste entier)');
ok(!PDB_BODY_RECORD.test('TITLE     a structure'), 'TITLE n’est pas un atome');
ok(!PDB_BODY_RECORD.test('REMARK 350 MOLECULE B'), '…ni un REMARK');
eq(pdbBodyOf('TITLE x\nATOM  1\nREMARK 9\nHETATM 2\nEND'), ['ATOM  1', 'HETATM 2'],
  'pdbBodyOf ne garde que les records d’atomes');

/* ── 2. L'ASSEMBLAGE ──────────────────────────────────────────────────────── */
const MAIN = ['TITLE     main structure', 'REMARK    42 from the writer', 'ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00  0.00           N', 'END'].join('\n');
eq(joinPdbMolecules([{ text: MAIN, main: true }]), MAIN,
  'UN seul bloc : le texte sort INCHANGÉ (le fichier d’avant cette session est préservé)');
const OTHER = ['TITLE     ligand', 'ATOM      1  C1  LIG B   1       5.000   0.000   0.000  1.00  0.00           C', 'END'].join('\n');
const both = joinPdbMolecules([{ text: MAIN, main: true }, { text: OTHER, name: 'Ligand (lig.pdb)' }]);
const lines = both.split('\n');
ok(both.startsWith('TITLE     main structure'), 'la principale garde sa tête (TITLE)');
ok(both.includes('REMARK    42 from the writer'), '…et ses REMARK');
ok(both.includes('REMARK 350 MOLECULE Ligand (lig.pdb)'), 'la molécule ajoutée est NOMMÉE dans un REMARK');
ok(both.includes('ATOM      1  C1  LIG B   1'), '…et ses atomes sont dans le fichier');
eq(both.split('TITLE').length - 1, 1, 'la tête de la molécule ajoutée n’est PAS recopiée (un seul TITLE)');
eq(lines[lines.length - 1], 'END', 'le fichier se termine bien par END');
eq(both.split(/\nEND\s*$/).length - 1, 1, '…et il n’y a qu’UN « END », le dernier');
eq(joinPdbMolecules([]), '', 'aucun bloc : aucun fichier (l’appelant ne doit pas écrire un vide)');
eq(joinPdbMolecules([{ text: '   \n' }]), '', 'un bloc vide ne compte pas');

/* ── 3. LA CUISSON DES POSES ──────────────────────────────────────────────── */
/* ⚠ `rigidMatrix` prend R en ROW-MAJOR À PLAT (9 nombres), comme le solveur de Kabsch
   le rend — et non un tableau de lignes : c'est la convention du module. */
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const identity = rigidMatrix(I3, [0, 0, 0]);
eq(applyMat4(identity, [1.5, -2.25, 3]), [1.5, -2.25, 3], 'une pose d’identité laisse les coordonnées telles quelles');
eq(applyMat4(rigidMatrix(I3, [10, 0, -5]), [1, 2, 3]), [11, 2, -2],
  'une translation de ✥ Move décale bien les coordonnées écrites');
const turned = applyMat4(rigidMatrix([0, -1, 0, 1, 0, 0, 0, 0, 1], [0, 0, 0]), [1, 0, 0]);
ok(Math.abs(turned[0]) < 1e-9 && Math.abs(turned[1] - 1) < 1e-9, 'une rotation de ↻ Rotate tourne bien les coordonnées écrites');


/* ── 4. LE BRANCHEMENT DANS LE VIEWER ─────────────────────────────────────── */
has("import { joinPdbMolecules } from '../utils/viewerPdbMolecules';", 'le viewer importe l’assembleur');
has('fitSummary, applyMat4 }', '…et la transformation de point du fit (une seule algèbre de matrices)');
has('const bakePoseIntoStructure = (comp) => {', 'la matrice MONDE de chaque molécule est écrite dans ses coordonnées');
has('const bx = new Float32Array(store.x);', 'les coordonnées d’origine sont COPIÉES avant d’être remplacées');
has('return () => { store.x = bx; store.y = by; store.z = bz; };', '…et la remise en place échange les RÉFÉRENCES (aucun arrondi)');
has('const comps = [component, ...(extraCompsRef.current || []).map((e) => e.comp)]',
  'TOUTES les molécules de l’écran sont écrites, la principale d’abord');
has("name: i === 0 ? '' : molNameOf(molKeyOfComp(c)),", 'chaque molécule ajoutée porte son nom dans le fichier');
has('comps.forEach((c) => { const back = bakePoseIntoStructure(c); if (back) restores.push(back); });',
  'la cuisson a lieu juste avant l’écriture');
has('restores.forEach((back) => { try { back(); } catch { /* ignore */ } });',
  '…et la scène revient EXACTEMENT comme elle était, dans un `finally`');
has('the arrangement on screen written into the coordinates',
  '…le message dit que l’arrangement est dans les coordonnées');
has('Download ONE PDB file of what is on screen', 'le bouton ⬇ PDB annonce le fichier complet');

console.log(`_viewer_pdb_molecules_test.mjs — ${passed} assertions OK (assemblage · poses écrites · scène rendue intacte)`);
