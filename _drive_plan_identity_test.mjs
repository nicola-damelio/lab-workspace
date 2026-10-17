/* =========================================================================
   _drive_plan_identity_test.mjs — L'IDENTITÀ NEL PIANO DEL DRIVE.

   STATO (17/10/2026) : il difetto descritto qui sotto è CORRETTO (FASE 1,
   punto A). Il banco resta perché è la prova che non torna.

   PERCHÉ ESISTE (16/10/2026). Sul Drive reale una rinomina lenta NON ha lasciato
   cartelle del nome parziale, mentre il harnais ne creava. La causa non era
   « mancava il gesto di uscita dal campo » (misurato: non cambia nulla, fattore
   `renommage-champ` di `_drive_two_pc_random_test.mjs`) ma QUESTO: l'identità
   dell'oggetto (`extra.id`, quella che `pickRenamedSibling` usa per adottare e
   rinominare un dossier esistente) era scritta **solo sull'ULTIMO livello** del
   piano (`isLast ? extra : null`). Quindi:

     • un'esperienza SENZA istanza né sezione → il suo dossier porta l'identità →
       la rinomina lo ADOTTA e lo rinomina SUL POSTO (un solo dossier) ;
     • un'esperienza CON istanza o sezione → il dossier dell'esperienza NON aveva
       identità (l'id finiva sul dossier dell'INSTANZA) → ogni nome pubblicato
       creava un dossier NUOVO e lasciava il vecchio.

   IL RIMEDIO. `addLevels` mette l'identità su OGNI livello dell'oggetto
   (esperienza, istanza, sezione, sotto-sezione) — mai sul progetto, che tiene la
   sua. E i testi di sezione passano l'identità (`addLevels(sLevels, { id })`),
   quindi il dossier di sezione non è più orfano.

   ESEGUIRE
     node _drive_plan_identity_test.mjs            → racconta e rende 0
     node _drive_plan_identity_test.mjs --strict   → exit 1 se il difetto torna
   ========================================================================= */
import { createHarness } from './_harness/two-pc.mjs';

const STRICT = process.argv.includes('--strict');
const DATASET = { datasetName: 'IDENTITY DATASET', datasetId: 'ds_id' };
let fails = 0;
const must = (cond, label) => {
  if (!cond) { fails += 1; console.log(`   ✖ ${label}`); } else console.log(`   ✓ ${label}`);
};
const exp = ({ id, name, instance = '', sections = [] }) => ({
  id, name, date: '2026-01-01', projectNames: ['Proj'], instanceName: instance, sections
});
const dataOf = (tests) => ({ datasetTitle: DATASET.datasetName, projects: [{ id: 'p1', name: 'Proj' }], tests });

const h = await createHarness({ ...DATASET, seed: 5 });
const pc = h.byLabel('PC A');
const drive = h.drive;

/* ── 1. LE PIANO: chi porta l'identità ────────────────────────────────────── */
const plan = await pc.do(async (M) => {
  const data = dataOf([
    exp({ id: 'e1', name: 'Alpha', instance: 'i1', sections: [{ title: 'data', html: '<p>x</p>' }] }),
    exp({ id: 'e2', name: 'Gamma' })
  ]);
  await M.structure.publishDatasetStructure({ datasetId: DATASET.datasetId, datasetName: DATASET.datasetName, data });
  const p = M.structure.datasetMirrorPlan({ datasetId: DATASET.datasetId, datasetName: DATASET.datasetName, data });
  return p.folders.map((f) => ({ path: f.path.join('/'), type: f.type, extraId: (f.extra && f.extra.id) || '' }));
});
const entryOf = (p) => plan.find((x) => x.path === p) || { extraId: '?' };
console.log('\n═══ PIANO (extraId = identità scritta nel _meta.json del dossier) ═══');
plan.filter((f) => f.path.includes('projects')).forEach((f) => console.log(`   ${f.path.padEnd(30)} ${f.type.padEnd(10)} extraId=${f.extraId || '—'}`));

console.log('\n▶ Q1 — l’identità su OGNI livello dell’oggetto');
must(entryOf('projects/Proj').extraId === 'p1', 'il dossier del PROGETTO porta la sua identità (p1)');
must(entryOf('projects/Proj/Gamma').extraId === 'e2', 'l’esperienza SENZA istanza/sezione porta l’identità (e2)');
must(entryOf('projects/Proj/Alpha').extraId === 'e1',
  'l’esperienza CON istanza+sezione porta l’identità (e1) — il difetto di FASE 1 A');
must(entryOf('projects/Proj/Alpha/i1').extraId === 'e1', 'il dossier dell’ISTANZA la porta anche lui (e1)');
must(entryOf('projects/Proj/Alpha/i1/data').extraId === 'e1', 'il dossier di SEZIONE non è più orfano (e1)');

/* ── 2. RINOMINARE: chi si rinomina sul posto, chi duplica ────────────────── */
await pc.do(async (M) => {
  const data = dataOf([
    exp({ id: 'e1', name: 'Beta', instance: 'i1', sections: [{ title: 'data', html: '<p>x</p>' }] }),
    exp({ id: 'e2', name: 'Delta' })
  ]);
  await M.structure.publishDatasetStructure({ datasetId: DATASET.datasetId, datasetName: DATASET.datasetName, data });
});
const live = drive.live().filter((n) => n.mimeType === drive.FOLDER_MIME);
const names = live.map((n) => n.name);
const rel = (n) => drive.pathOf(n.id).slice(1).join('/');
const underProj = (n) => rel(n).includes('/projects/Proj');
const expFoldersFor = (name) => live.filter((n) => n.name === name && underProj(n));
console.log('\n▶ Q2 — rinominare Alpha→Beta (con istanza+sezione) e Gamma→Delta (senza)');
console.log(`   albero sotto projects/ : ${JSON.stringify(live.filter(underProj).map((n) => n.name))}`);
must(names.includes('Delta') && !names.includes('Gamma'),
  'Gamma→Delta: il dossier è stato RINOMINATO SUL POSTO (nessun resto dell’anziano)');
must(names.includes('Beta') && !names.includes('Alpha'),
  'Alpha→Beta: il dossier è stato RINOMINATO SUL POSTO (l’anziano non resta)');
must(expFoldersFor('Beta').length === 1, 'un solo dossier per l’oggetto Beta (nessun « resto + nuovo »)');
must(drive.twins().length === 0, 'nessun JUMEAU (due dossier dello stesso nome)');
must(drive.stats.permanentDeletes === 0, 'nessuna cancellazione DEFINITIVA emessa (corbeille solo, o nulla)');

/* ── 3. SEZIONI SORELLE: stesso id, dossier distinti ──────────────────────── */
await pc.do(async (M) => {
  const data = dataOf([
    exp({ id: 'e1', name: 'Beta', instance: 'i1', sections: [
      { title: 'data', html: '<p>x</p>' },
      { title: 'results', html: '<p>y</p>' }
    ] }),
    exp({ id: 'e2', name: 'Delta' })
  ]);
  await M.structure.publishDatasetStructure({ datasetId: DATASET.datasetId, datasetName: DATASET.datasetName, data });
});
const pathsNow = () => drive.live()
  .filter((n) => n.mimeType === drive.FOLDER_MIME)
  .map((n) => rel(n));
const at = (p) => pathsNow().some((x) => x.endsWith(p));
console.log('\n▶ Q3 — due sezioni sorelle sotto un’istanza');
must(at('/projects/Proj/Beta/i1/data') && at('/projects/Proj/Beta/i1/results'),
  'le due sezioni hanno due dossier distinti (data, results)');
must(!at('/projects/Proj/Alpha'), 'aucun dossier « Alpha » n’est réapparu');

/* ── 4. RINOMINARE UNA SEZIONE: l'altra resta al suo posto ───────────────── */
await pc.do(async (M) => {
  const data = dataOf([
    exp({ id: 'e1', name: 'Beta', instance: 'i1', sections: [
      { title: 'data', html: '<p>x</p>' },
      { title: 'results2', html: '<p>y</p>' }
    ] }),
    exp({ id: 'e2', name: 'Delta' })
  ]);
  await M.structure.publishDatasetStructure({ datasetId: DATASET.datasetId, datasetName: DATASET.datasetName, data });
});
console.log('\n▶ Q4 — rinominare results→results2 (data non si tocca)');
must(at('/projects/Proj/Beta/i1/results2') && !at('/projects/Proj/Beta/i1/results'),
  'results→results2: dossier rinominato SUL POSTO');
must(at('/projects/Proj/Beta/i1/data'), 'il dossier della sezione sorella « data » est intact');
must(expFoldersFor('Beta').length === 1, 'toujours un seul dossier Beta (rien n’a été dupliqué)');
must(drive.stats.permanentDeletes === 0, 'toujours aucune suppression DEFINITIVE');

console.log(`\n═══ ESITO : ${fails === 0 ? 'i fatti misurati sono quelli attesi' : `${fails} verifica(i) non corrispondono`} ═══`);
console.log('   FASE 1, punto A : l’identité est écrite sur CHAQUE niveau de l’objet');
console.log('   (docs/DRIVE-SYNC-FASE0.md §8.2 → docs/DRIVE-SYNC-FASE1.md §5.1).');
if (STRICT && fails) {
  console.log('   MODE STRICT : exit 1 — l’identité manque encore quelque part.');
  process.exit(1);
}
process.exit(fails ? 2 : 0);

