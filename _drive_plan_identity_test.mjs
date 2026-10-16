/* =========================================================================
   _drive_plan_identity_test.mjs — L'IDENTITÀ NEL PIANO DEL DRIVE.

   PERCHÉ ESISTE (16/10/2026). Sul Drive reale una rinomina lenta NON ha lasciato
   cartelle del nome parziale, mentre il harnais ne creava. La causa non era
   «mancava il gesto di uscita dal campo» (misurato: non cambia nulla, fattore
   `renommage-champ` di `_drive_two_pc_random_test.mjs`) ma QUESTO: l'identità
   dell'oggetto (`extra.id`, quella che `pickRenamedSibling` usa per adottare e
   rinominare un dossier esistente) è scritta **solo sull'ULTIMO livello** del
   piano (`driveStructure.js:643-646`, `isLast ? extra : null`). Quindi:

     • un'esperienza SENZA istanza né sezione → il suo dossier porta l'identità →
       la rinomina lo ADOTTA e lo rinomina SUL POSTO (un solo dossier) ;
     • un'esperienza CON istanza o sezione → il dossier dell'esperienza NON ha
       identità (l'id finisce sul dossier dell'INSTANZA) → ogni nome pubblicato
       crea un dossier NUOVO e lascia il vecchio.

   ESEGUIRE
     node _drive_plan_identity_test.mjs            → racconta e rende 0
     node _drive_plan_identity_test.mjs --strict   → exit 1 finché il difetto c'è
   (la FASE 1, punto A, è ciò che lo toglie).
   ========================================================================= */
import { createHarness } from './_harness/two-pc.mjs';

const STRICT = process.argv.includes('--strict');
const DATASET = { datasetName: 'IDENTITY DATASET', datasetId: 'ds_id' };
let fails = 0;
const must = (cond, label) => {
  if (!cond) { fails += 1; console.log(`   ✖ ${label}`); } else console.log(`   ✓ ${label}`);
};
const exp = ({ id, name, instance = '', section = false }) => ({
  id, name, date: '2026-01-01', projectNames: ['Proj'], instanceName: instance,
  sections: section ? [{ title: 'data', html: '<p>x</p>' }] : []
});
const dataOf = (tests) => ({ datasetTitle: DATASET.datasetName, projects: [{ id: 'p1', name: 'Proj' }], tests });

const h = await createHarness({ ...DATASET, seed: 5 });
const pc = h.byLabel('PC A');
const drive = h.drive;

/* ── 1. LE PIANO: chi porta l'identità ────────────────────────────────────── */
const plan = await pc.do(async (M) => {
  const data = dataOf([
    exp({ id: 'e1', name: 'Alpha', instance: 'i1', section: true }),
    exp({ id: 'e2', name: 'Gamma' })
  ]);
  await M.structure.publishDatasetStructure({ datasetId: DATASET.datasetId, datasetName: DATASET.datasetName, data });
  const p = M.structure.datasetMirrorPlan({ datasetId: DATASET.datasetId, datasetName: DATASET.datasetName, data });
  return p.folders.map((f) => ({ path: f.path.join('/'), type: f.type, extraId: (f.extra && f.extra.id) || '' }));
});
const entryOf = (p) => plan.find((x) => x.path === p) || { extraId: '?' };
console.log('\n═══ PIANO (extraId = identità scritta nel _meta.json del dossier) ═══');
plan.filter((f) => f.path.includes('projects')).forEach((f) => console.log(`   ${f.path.padEnd(30)} ${f.type.padEnd(10)} extraId=${f.extraId || '—'}`));

console.log('\n▶ Q1 — chi porta l’identità');
must(entryOf('projects/Proj').extraId === 'p1', 'il dossier del PROGETTO porta l’identità (p1)');
must(entryOf('projects/Proj/Gamma').extraId === 'e2', 'l’esperienza SENZA istanza/sezione porta l’identità (e2)');
must(entryOf('projects/Proj/Alpha/i1').extraId === 'e1', 'l’ID DELL’ESPERIENZA finisce sul dossier dell’ISTANZA (e1)');
must(entryOf('projects/Proj/Alpha').extraId === '', '⚠ il dossier dell’esperienza CON istanza+sezione NON ha identità (difetto: driveStructure.js:645)');

/* ── 2. RINOMINARE: chi si rinomina sul posto, chi duplica ────────────────── */
await pc.do(async (M) => {
  const data = dataOf([
    exp({ id: 'e1', name: 'Beta', instance: 'i1', section: true }),
    exp({ id: 'e2', name: 'Delta' })
  ]);
  await M.structure.publishDatasetStructure({ datasetId: DATASET.datasetId, datasetName: DATASET.datasetName, data });
});
const live = drive.live().filter((n) => n.mimeType === drive.FOLDER_MIME);
const names = live.map((n) => n.name);
const underProj = (n) => drive.pathOf(n.id).slice(1).join('/').includes('/projects/Proj');
const expFoldersFor = (name) => live.filter((n) => n.name === name && underProj(n));
console.log('\n▶ Q2 — rinominare Alpha→Beta (con istanza+sezione) e Gamma→Delta (senza)');
console.log(`   albero sotto projects/ : ${JSON.stringify(live.filter(underProj).map((n) => n.name))}`);
must(names.includes('Delta') && !names.includes('Gamma'),
  'Gamma→Delta: il dossier è stato RINOMINATO SUL POSTO (nessun resto dell’anziano)');
must(names.includes('Alpha') && names.includes('Beta'),
  '⚠ Alpha→Beta: il dossier dell’anziano RESTA e ne nasce uno nuovo (difetto: l’oggetto non ha identità da adottare)');
must(expFoldersFor('Beta').length === 1 && expFoldersFor('Alpha').length === 1,
  'i due dossier di Alpha/Beta sono vivi insieme (2 dossier per un solo oggetto)');
must(drive.twins().length === 0, 'nessun JUMEAU (due dossier dello stesso nome): il difetto è «resto + nuovo», non un doppione omonimo');
must(drive.stats.permanentDeletes === 0, 'nessuna cancellazione DEFINITIVA emessa (corbeilla solo, o nulla)');

console.log(`\n═══ ESITO : ${fails === 0 ? 'i fatti misurati sono quelli attesi' : `${fails} verifica(i) non corrispondono`} ═══`);
console.log(`   il difetto è dichiarato nel rapporto: docs/DRIVE-SYNC-FASE0.md §8.2 (causa: driveStructure.js:643-646)`);
console.log(`   e la sua correzione è la FASE 1, punto A.`);
if (STRICT && entryOf('projects/Proj/Alpha').extraId === '') {
  console.log('   MODE STRICT : exit 1 — l’identità manca ancora sul dossier dell’esperienza.');
  process.exit(1);
}
process.exit(fails ? 2 : 0);
