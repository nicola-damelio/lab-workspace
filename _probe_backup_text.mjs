/* _probe_backup_text.mjs — QUE PORTE VRAIMENT LE FICHIER DE SAUVEGARDE ?
   Question posée : « le json de sauvegarde est en chinois, est-ce normal ? »
   Ce qu'on regarde : le document écrit par le code de l'app (buildBackupDocument
   + backupDocumentText, exactement les fonctions d'App.jsx), décomposé entre
   ce qui se lit (l'en-tête) et ce qui ne se lit pas (la charge compressée).
   Lecture seule : rien n'est écrit, rien n'est envoyé. */
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url); /* même crochet que les tests du dépôt */

const LZString = (await import('lz-string')).default;
const { buildBackupDocument, backupDocumentText, parseBackupText } = await import('./src/utils/backupFile.js');

const STATE = {
  datasetTitle: 'p53H',
  tests: [
    { id: 't1', name: 'interaction_pdbs', kind: 'Docking', molecule: '1YCR' },
    { id: 't2', name: 'binding assay', kind: 'NMR' }
  ],
  projects: [{ id: 'p1', title: 'p53 interaction study', datasetId: 'dsCafe9' }],
  molecules: { '1YCR': { name: '1YCR' } }
};

const payload = LZString.compressToUTF16(JSON.stringify(STATE));
const doc = buildBackupDocument({
  payload, title: STATE.datasetTitle, subtitle: 'studio', datasetId: 'dsCafe9', savedAt: 1_700_000_000_000
});
const body = backupDocumentText(doc);

const cjk = (body.match(/[\u2E80-\u9FFF\uAC00-\uD7AF]/g) || []).length;
const latin = (body.match(/[A-Za-z0-9]/g) || []).length;
console.log('=== ce que l’app écrit (les 900 premiers caractères) ===');
console.log(body.slice(0, 900));
console.log('\n=== mesure ===');
console.log('longueur du fichier      :', body.length);
console.log('caractères latins/chiffres:', latin);
console.log('caractères CJK (chinois)  :', cjk, `(${Math.round((cjk / body.length) * 100)} % du fichier)`);
console.log('la charge compressée      :', `${JSON.stringify(payload.slice(0, 40))}…`);
console.log('\n=== relecture (ce que l’app fait pour restaurer) ===');
const back = parseBackupText(body);
console.log('valide :', back.ok, '| format :', back.kind, '| comptes :', JSON.stringify(back.counts && back.counts.tests));
console.log('la charge rendue par le document est la charge donnée :', doc.payload === payload);
console.log('la charge commence par une espace (alphabet lz-string) :', payload.startsWith(' '));
console.log('la charge relue redonne l’état :', LZString.decompressFromUTF16(payload) === JSON.stringify(STATE));
console.log('la charge TELLE QUE STOCKÉE redonne l’état :', LZString.decompressFromUTF16(doc.payload) === JSON.stringify(STATE));
const first = payload[0];
console.log('premier caractère de la charge :', JSON.stringify(first), '| code', first.charCodeAt(0), '| tel que stocké :', JSON.stringify(doc.payload[0]));
