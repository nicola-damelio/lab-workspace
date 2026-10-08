/* =========================================================================
   _viewer_source_drive_archive_test.mjs — « LA DIR ÉTÉ CRÉÉE EN DRIVE MAIS LES
   FILES PDB NON CI SONT » : LE PDB CHARGÉ PAR SON CODE DOIT Y ALLER.

   Le rapport de cette session, mot pour mot : « ho appena creato un nuovo
   esperimento e ho caricato due pdb con il codice pdb. la dir é stata creata in
   drive ma i files pdb non ci sono. » Mesuré sur le Drive réel le 08/10/2026 :
   l'expérience `interaction_pdbs` (projet `p53H`) portait bien
   `…/1YCR/data/Structure` et `…/3LNZ/data/Structure`, mais les deux dossiers ne
   contenaient QUE `viewer-style-snapshot.json` — aucun `.pdb`.

   La cause, et ce que cette sonde mesure :

     1. LA PORTE DU CODE N'ÉTAIT PAS LA PORTE DU FICHIER. La rangée §1 a deux
        entrées : 📂 PDB file(s) (un File du poste, archivé) et « PDB ID or URL »
        + Load (une structure que NGL lit lui-même sur le RCSB — RIEN n'était
        déposé). Les deux doivent laisser le même fichier dans le dossier de
        l'expérience.
     2. LE NOM EST CELUI DU CODE, ET IL EST STABLE —
        `sourceStructureFileStem` (« 1YCR », « rcsb:1ycr », une URL → son dernier
        segment) : un même code réécrit le même fichier au lieu d'en empiler un
        second (uploadLocalFile cherche par nom dans le dossier).
     3. LE TEXTE EST CELUI DE L'ÉCRAN — le MÊME writer NGL que ⬇ PDB, donc aucune
        requête de plus (la promesse « ce viewer n'ouvre aucun réseau de lui-même »
        reste vraie), et un échec SE DIT dans le message de la rangée §1.
     4. LA SOURCE DE LA PAGE NE DÉPOSE RIEN — son gabarit, son texte déclaré ou la
        condition relue reviennent à chaque ouverture : la marque `fromSource` n'est
        posée que par les commandes de l'utilisateur (Load, Replace, Keep both).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourceStructureFileStem } from './src/utils/viewerPdbMolecules.js';

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => { assert.deepEqual(a, b, what); passed += 1; };
const VIEWER = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => {
  assert.ok(VIEWER.includes(needle), `${what}\n  introuvable : ${needle}`);
  passed += 1;
};
const countIn = (text, needle) => String(text).split(needle).length - 1;

/* ── 1. LE NOM DU FICHIER — le code, et rien d'autre ───────────────────────── */
eq(sourceStructureFileStem('1YCR'), '1YCR', 'un code PDB garde son code');
eq(sourceStructureFileStem('1ycr'), '1YCR', '…en majuscules, comme le RCSB (le même fichier pour 1ycr et 1YCR)');
eq(sourceStructureFileStem(' 3LNZ '), '3LNZ', 'les espaces autour ne changent pas le nom');
eq(sourceStructureFileStem('rcsb:1ycr'), '1YCR', 'le préfixe rcsb: n’est pas un nom');
eq(sourceStructureFileStem('rcsb://1YCR'), '1YCR', '…ni ses barres');
eq(sourceStructureFileStem('https://files.rcsb.org/download/1ABC.pdb'), '1ABC',
  'une URL donne son dernier segment sans extension');
eq(sourceStructureFileStem('https://files.rcsb.org/download/1abc.pdb.gz'), '1ABC',
  '…même quand l’extension est répétée (.pdb.gz)');
eq(sourceStructureFileStem('https://example.org/models/my_model.cif'), 'my_model',
  '…et un CIF garde le nom du fichier (le .pdb écrit, lui, est du PDB)');
eq(sourceStructureFileStem('https://example.org/a/my model.pdb'), 'my_model',
  'un nom d’URL reste un nom de fichier lisible (aucun espace n’atteint le Drive)');
eq(sourceStructureFileStem('data:chemical/x-pdb;base64,AAAA'), '',
  'un texte engendré dans la page n’a AUCUN nom à donner — donc rien à déposer');
eq(sourceStructureFileStem('blob:http://localhost/9f2c'), '', '…ni un fichier tenu par le navigateur');
eq(sourceStructureFileStem(''), '', 'rien à nommer : rien à déposer');
eq(sourceStructureFileStem(null), '', '…même quand la source est absente');

/* ── 2. LE GESTE PAR CODE ARCHIVE VRAIMENT ─────────────────────────────────── */
has("import { joinPdbMolecules, sourceStructureFileStem } from '../utils/viewerPdbMolecules';",
  'le viewer importe le nommeur de source à côté de l’assembleur ⬇ PDB');
has('const archiveSourceStructureOnDrive = async ({ comp, rawSrc, ctx, onMessage = null } = {}) => {',
  'un seul endroit dépose la structure d’un code / d’une URL');
has('const stem = sourceStructureFileStem(rawSrc);', '…et il nomme le fichier par la source');
has('const text = new NS.PdbWriter(comp.structure).getData();',
  'le texte vient du MÊME writer NGL que ⬇ PDB (les coordonnées vraiment chargées)');
has('const name = `${stem}.pdb`;', 'le fichier déposé est un .pdb, celui du code');
has("file: new File([text], name, { type: 'chemical/x-pdb' }),", '…porté par un File (l’envoi en a besoin)');
has("suffix: 'structure'", 'le nommage passe par le même guichet que les autres fichiers');
eq(countIn(VIEWER, 'fetch(') + countIn(VIEWER, 'XMLHttpRequest') + countIn(VIEWER, 'sendBeacon'), 0,
  '…et ce viewer n’ouvre toujours aucun réseau de lui-même : le texte vient de NGL, pas d’une requête de plus');

/* ── 3. LES DEUX PORTES DE §1, ET EUX SEULS ────────────────────────────────── */
eq(countIn(VIEWER, 'fromSource: true'), 2,
  'deux gestes posent la marque : « PDB ID or URL » + Load, et le choix Replace');
has('setLoadRequest({ file: null, url: value, ts: Date.now(), fromSource: true });', '…le premier');
has('requestStructureLoad({ file: null, url: rawSrc, ts: Date.now(), fromSource: true });', '…le second');
has('setLoadRequest({ file: null, url: src, ts: Date.now() });',
  'la source que la PAGE fournit (gabarit, texte déclaré, condition relue) ne dépose RIEN');
has('if (loadRequest.fromSource) {', 'c’est le chargement PRINCIPAL qui archive, une fois la structure lue');
has('comp: component, rawSrc: loadRequest.url, ctx: driveNamingRef.current, onMessage: setPdbMsg',
  '…avec la composante chargée, la source, le dossier de la page et le message de §1');
has('archiveSourceStructureOnDrive({ comp, rawSrc, ctx: driveNamingRef.current, onMessage: setPdbMsg }).catch(() => {});',
  '« Keep both » dépose aussi la molécule venue par son code');
has('requestStructureLoad({ ...(loadRequest || {}), ts: Date.now(), fromSource: false });',
  'basculer ⚭ Disulfides recharge sans redéposer : le .pdb garde ses ponts S–S, quoi qu’on dessine');

/* ── 4. OÙ, ET QUAND ÇA ÉCHOUE ────────────────────────────────────────────── */
has('const driveNamingRef = useRef(null);', 'le contexte de nommage est lu par un REF…');
has('driveNamingRef.current = driveNaming;', '…posé à chaque rendu (la page en fabrique un nouvel objet)');
has("if (!stem || !ctx || !comp || !comp.structure || !getDriveToken()) return '';",
  'sans nom, sans dossier, sans structure ou sans Drive, on ne dépose rien');
eq(countIn(VIEWER, 'was not archived'), 2,
  'l’échec SE DIT (Drive injoignable / exception) au lieu d’un silence trompeur');
has("`⚠️ ${name} was not archived (Drive unreachable?) — it lives in this browser only.`",
  '…avec la raison, dans le message de la rangée §1');
has("`⬆ ${name} — the structure loaded by its code is now in this test's Drive folder.`",
  '…et le succès le dit aussi (on sait que le dossier de l’expérience l’a reçue)');

console.log(`_viewer_source_drive_archive_test.mjs — ${passed} vérifications OK`);
