/* =========================================================================
   _project_drive_doc_test.mjs — LE TEXTE DU PROJET SUR LE DRIVE, DANS LE DOSSIER
   DU PROJET. Et l'import d'un manuscrit qui se fait TOUT SEUL.

   Quatre reproches, un seul fichier de vérification :

     1. « il faut ajouter les références à la main dans la Project bibliography
        puis les lier au texte » → l'import retient D'OFFICE toutes les
        références trouvées (les cases servent à en retirer une) et le plan
        d'import RÉEL (buildManuscriptPlan) est exécuté : chaque « [12] » du
        manuscrit doit ressortir relié ;
     2. « pourquoi garder le manuscrit dans le cache du navigateur ? il devrait
        être sur le Drive, dans le dossier du projet » → le document (texte,
        en-tête, bibliographie, références numérotées — JAMAIS les pixels des
        figures) part dans
          Lab Workspace/<dataset>/projects/<projet>/<projet>_document.json
        et sait revenir (`restoreProjectDocument`) ;
     3. une référence dont le TITRE n'était pas trouvé :
        « Lu, W.-J. et al. Mortalin-p53 interaction in cancer cells is stress
          dependent and constitutes a selective target for cancer therapy.
          Cell Death Differ 18, 1046-1056 (2011). »
        (les initiales composées « W.-J. » cassaient la lecture) ;
     4. « les références n'ont pas d'auteurs » — même cause : la liste d'auteurs
        s'arrêtait avant le « -J. ».

   Le faux Drive est branché sur le module RÉEL (src/utils/projectDocumentDrive.js)
   via le bouchon de _esm_test_hook.mjs : l'aller-retour est EXÉCUTÉ, pas relu
   dans le source.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

/* ── LE FAUX DRIVE : il retient ce qu'on lui envoie, et le rend ───────────── */
const drive = new Map();   // id → { name, folder, text }
let nextId = 0;
globalThis.__driveTestMocks = {
  driveToken: 'jeton-de-test',
  driveRootName: 'Dataset A',
  uploadWorkspaceFile: async ({ name, folder, file }) => {
    nextId += 1;
    const id = `file_${nextId}`;
    drive.set(id, { name, folder, text: await file.text() });
    return { id, name };
  },
  downloadDriveFileText: async (id) => (drive.get(id) || {}).text || ''
};

const DOC = await import('./src/utils/projectDocumentDrive.js');
const MS = await import('./src/utils/manuscriptImport.js');
const REF = await import('./src/utils/referenceImport.js');
const PAGE = readFileSync('./src/components/AppModules/projectDetailModule.jsx', 'utf8');

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };

/* ── 3. LA RÉFÉRENCE SIGNALÉE : titre, auteurs, revue ─────────────────────── */
const LU = '\tLu, W.-J. et al. Mortalin-p53 interaction in cancer cells is stress '
  + 'dependent and constitutes a selective target for cancer therapy. '
  + 'Cell Death Differ 18, 1046\u20131056 (2011).';
const lu = REF.parseReferences(LU, { split: 'line', keepAll: true })[0];
eq(lu.title, 'Mortalin-p53 interaction in cancer cells is stress dependent and constitutes a selective target for cancer therapy',
  'le TITRE de « Lu, W.-J. … » est trouvé (le « -J. » n’est plus pris pour le titre)');
eq(lu.authors, 'Lu W-J, et al.', '…et la référence A ses auteurs (« W.-J. » survit au trait d’union)');
eq([lu.journal, lu.volume, lu.pages, lu.year], ['Cell Death Differ', '18', '1046-1056', '2011'],
  '…revue, volume, pages et année');
eq(REF.parseReferences(`12.${LU}`, { split: 'line' })[0].number, 12,
  'le numéro écrit devant l’entrée est gardé (c’est lui que le texte cite)');

/* Le trait d'union ne doit JAMAIS réunir deux auteurs différents. */
const pair = REF.parseReferences('Rossi M, Bianchi A. Characterization of a potyvirus. J Virol 2018;12:345-356.',
  { split: 'line', keepAll: true })[0];
eq(pair.authors, 'Rossi M, Bianchi A', 'deux auteurs séparés par une virgule restent deux auteurs');
const initialsFirst = REF.parseReferences(
  'J.-P. Rossi, M. Bianchi. Title of a paper about membranes. Biochim. Biophys. Acta 1860, 1234-1245 (2018).',
  { split: 'line', keepAll: true }
)[0];
eq(initialsFirst.authors, 'Rossi J-P, Bianchi M', '« J.-P. Rossi » (initiales en tête) devient « Rossi J-P »');
eq(initialsFirst.title, 'Title of a paper about membranes', '…et son titre n’est pas ses initiales');
eq(REF.parseReferences('Lu WJ, Lee NP, Kaul SC, et al. Mortalin-p53 interaction in cancer cells. Cell Death Differ. 2011;18(6):1046-56.',
  { split: 'line', keepAll: true })[0].authors, 'Lu WJ, Lee NP, Kaul SC, et al.',
  'le style Vancouver (initiales sans points) garde sa liste complète');

/* ── 1. LE MANUSCRIT ENTIER : citations liées, sans rien cocher ───────────── */
const MANUSCRIPT = [
  'Mortalin-p53 interaction in cancer cells',
  '',
  'Wen-Jing Lu, Nicola-Paolo Lee',
  '',
  'Introduction',
  '',
  'Mortalin is a selective target in cancer cells [12].',
  '',
  'Discussion',
  '',
  'The stress-dependent interaction is confirmed [12,3].',
  '',
  'References',
  '',
  `12.${LU}`,
  '3. Rossi M, Bianchi A. Characterization of a potyvirus infecting pepper. J Virol 2018;12:345-356.',
  ''
].join('\n');
const manuscript = MS.splitManuscript(MS.blocksFromText(MANUSCRIPT));
const plan = MS.buildManuscriptPlan(manuscript, { existingReferences: [] });
eq(plan.entries.length, 2, 'les deux entrées de la bibliographie du document sont lues');
eq(plan.entries.map((e) => e.entry.title), [
  'Mortalin-p53 interaction in cancer cells is stress dependent and constitutes a selective target for cancer therapy',
  'Characterization of a potyvirus infecting pepper'
], 'chacune avec son TITRE (la référence « Lu, W.-J. … » comprise)');
eq(plan.entries.map((e) => e.entry.authors), ['Lu W-J, et al.', 'Rossi M, Bianchi A'], '…et ses AUTEURS');
eq(plan.entries.map((e) => e.number), [1, 2], 'le projet numérote les deux références');
eq(plan.citations.length, 2, 'les deux citations du texte sont vues');
eq(plan.unresolved.length, 0, 'AUCUNE citation ne reste non résolue : [12] et [3] désignent les entrées du document');
const bodyText = manuscript.body.map((b) => b.text).join('\n\n');
const conv = MS.convertCitationsInText(bodyText, plan.numberByKey);
eq(conv.unresolved, [], 'la conversion ne laisse rien en clair');
ok(conv.text.includes('[1]') && conv.text.includes('[1,2]'), 'les citations deviennent les numéros du PROJET ([12] → [1], [12,3] → [1,2])');
ok(!conv.text.includes('[12]'), 'plus aucun « [12] » (numéro du document) ne subsiste');
eq(MS.citedNumbersInText(conv.text).size, 2, 'les deux numéros cités sont retrouvés (compte rendu de l’import)');

/* Le contrôle exercé par la PAGE : toutes les entrées trouvées sont cochées. */
ok(PAGE.includes('const picks = plan.entries.map((_, i) => i);'),
  'la page projet retient D’OFFICE toutes les références trouvées (plus rien à cocher)');
ok(PAGE.includes('picked.length} imported)'), 'la fenêtre annonce « imported », pas « to add »');
ok(PAGE.includes('Untick a line here to leave that paper out'),
  '…et dit que les cases servent à RETIRER une référence');

/* ── 2. LE TEXTE SUR LE DRIVE, DANS LE DOSSIER DU PROJET ──────────────────── */
const PIXELS = 'data:image/png;base64,' + 'A'.repeat(2000000);
const project = {
  id: 'p1',
  name: 'Mortalin study',
  scientist: 'Nicol',
  background: '<p>Mortalin is a selective target [1].</p>',
  discussion: '',
  conclusions: '<p>The interaction is stress dependent [1].</p>',
  funding: '',
  paperTitle: 'Mortalin-p53 interaction in cancer cells',
  paperAuthors: 'Lu W-J\nLee N-P',
  paperAffiliations: '1. Naples',
  bibliography: [{ id: 'bib_1', title: 'Mortalin-p53 interaction', authors: 'Lu W-J', year: '2011' }],
  references: [{ id: 'r1', number: 1, title: 'Mortalin-p53 interaction', authors: 'Lu W-J' }],
  msImports: [{ hash: 'ms1', at: '2026-01-01T00:00:00.000Z' }],
  /* Les pixels des figures : 2 Mo. Ils ne doivent JAMAIS entrer dans le fichier. */
  figures: { background: [{ id: 'f1', url: PIXELS, full: PIXELS, name: 'image1.png' }] }
};

eq(DOC.projectDocumentFileName(project), 'Mortalin_study_document.json', 'le fichier porte le nom du projet');
eq(DOC.projectDocumentFolder('Dataset A', project), 'Dataset_A/projects/Mortalin_study',
  '…et se range dans le DOSSIER DU PROJET du dataset (« <dataset>/projects/<projet> »)');

const payload = DOC.projectDocumentPayload(project, { at: '2026-09-15T10:00:00.000Z' });
const json = DOC.projectDocumentJson(payload);
ok(!json.includes('data:image') && !json.includes('AAAA'),
  'les pixels des figures n’entrent JAMAIS dans le fichier Drive (2 Mo de data:image ignorés)');
ok(json.length < 20000, `le fichier reste minuscule : ${json.length} octets pour un texte + 2 Mo de figures`);
eq(Object.keys(payload.sections), ['background', 'conclusions'],
  'seules les sections QUI ONT DU TEXTE partent (une section vide ne part pas)');
eq(payload.header, {
  title: 'Mortalin-p53 interaction in cancer cells',
  authors: 'Lu W-J\nLee N-P',
  affiliations: '1. Naples'
}, 'l’en-tête de l’article part avec le document');
eq([payload.references.length, payload.bibliography.length, payload.msImports.length], [1, 1, 1],
  'références numérotées, bibliographie et empreinte des imports partent aussi');
eq(DOC.PROJECT_DOCUMENT_SECTIONS.map((s) => s.id), MS.PROJECT_TEXT_SECTIONS.map((s) => s.id),
  'les sections archivées sont EXACTEMENT celles de la page projet');

const archived = await DOC.archiveProjectDocument({ project, datasetName: 'Dataset A' });
ok(!!archived && !!archived.id, 'le document part bien sur le Drive (faux Drive branché)');
eq(archived.folder, 'Dataset_A/projects/Mortalin_study', '…dans le dossier du projet');
eq(archived.name, 'Mortalin_study_document.json', '…sous son nom de fichier');
eq(archived.provider, 'drive', '…par le connecteur Google Drive');
ok(archived.bytes > 100 && archived.bytes === json.length, '…et sa taille est celle du fichier écrit');
const stored = JSON.parse((drive.get(archived.id) || {}).text || '{}');
eq(stored.kind, DOC.PROJECT_DOCUMENT_KIND, 'le faux Drive a reçu un document de l’application');
eq([stored.project.name, stored.sections, stored.bibliography], [project.name, payload.sections, payload.bibliography],
  '…avec le nom du projet, le texte des sections et la bibliographie');
ok((drive.get(archived.id) || {}).text.length === archived.bytes,
  'le fichier reçu fait exactement la taille annoncée dans le compte rendu');
ok(!!archived.url && archived.url.includes(archived.id), 'le lien Drive du fichier est disponible');

const restored = await DOC.restoreProjectDocument(archived);
ok(restored.ok, 'le fichier archivé se relit (« ♻ Load the Drive copy »)');
eq(restored.patch.background, project.background, '…le texte de « Background » revient');
eq(restored.patch.conclusions, project.conclusions, '…celui de « Conclusions » aussi');
eq(restored.patch.paperAuthors, 'Lu W-J\nLee N-P', '…l’en-tête (auteurs) revient');
eq(restored.patch.references, project.references, '…les références numérotées reviennent');
eq(restored.patch.bibliography, project.bibliography, '…la bibliographie aussi');
eq(restored.patch.msImports, project.msImports, '…et l’empreinte de l’import');
eq(restored.counts, { sections: 2, header: 3, references: 1, bibliography: 1 },
  'le compte rendu annonce ce qui est revenu');
ok(!('funding' in restored.patch),
  'une section restée vide ne revient PAS écraser celle du jour (le fichier n’en parle pas)');

/* Un fichier étranger, tronqué ou d'une version inconnue n'est jamais appliqué. */
eq(DOC.parseProjectDocument('pas du json'), { ok: false, reason: 'not-json' }, 'un fichier illisible est refusé');
eq(DOC.parseProjectDocument(JSON.stringify({ kind: 'autre', version: 1 })).reason, 'not-a-project-document',
  'un JSON d’un autre programme est refusé');
eq(DOC.parseProjectDocument(JSON.stringify({ ...payload, version: 99 })).reason, 'newer-version',
  'un fichier d’une version plus récente est refusé');
eq(DOC.parseProjectDocument(JSON.stringify({ ...payload, sections: {} })).reason, 'no-section-text',
  'un fichier sans texte de section est refusé');
eq(DOC.projectDocumentPatch(null), { ok: false, reason: 'empty' }, 'un patch sans document est refusé');

/* Sans Drive connecté : l'archivage rend null (l'import continue). */
const keepToken = globalThis.__driveTestMocks.driveToken;
globalThis.__driveTestMocks.driveToken = null;
eq(await DOC.archiveProjectDocument({ project, datasetName: 'Dataset A' }), null,
  'sans Drive connecté, l’archivage ne fait rien et ne fait PAS échouer l’import');
globalThis.__driveTestMocks.driveToken = keepToken;

/* ── Les branchements dans la page projet ────────────────────────────────── */
ok(PAGE.includes('await archiveProjectDocument({'), 'l’import dépose le document dans le dossier Drive du projet');
ok(PAGE.includes('commitProjectVerified({ driveDocument: driveCopy }, {})'),
  '…et garde l’identifiant du fichier dans le projet (pour le relire ensuite)');
ok(PAGE.includes('The text is also filed on Drive'), '…le compte rendu le dit');
ok(PAGE.includes('♻ Load the Drive copy'), '…et « ♻ Load the Drive copy » peut le remettre dans la page');
ok(PAGE.includes('☁ File the text on Drive'),
  'un projet jamais archivé (ou importé avant) offre « ☁ File the text on Drive »');
ok(PAGE.includes('const loadProjectDriveCopy = async () => {')
  && PAGE.includes('const saveProjectDriveCopy = async () => {'),
  'les deux gestes existent (relire la copie du Drive / l’y déposer)');
ok(PAGE.includes('const res = await restoreProjectDocument(ref);'),
  'la restauration passe par le module testé ici (aucune logique dupliquée dans la page)');

console.log(`✅ ${passed} tests passés (références « W.-J. » · import automatique · document du projet sur le Drive)`);



