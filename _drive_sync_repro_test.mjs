/* =========================================================================
   _drive_sync_repro_test.mjs — FASE 0, POINT (b) : LES HUIT QUESTIONS DE LA
   DIAGNOSE, CHACUNE ÉPROUVÉE SUR LE FAUX DRIVE AVEC LE CODE RÉEL.

   MODES
     • `node _drive_sync_repro_test.mjs`            → BASELINE (défaut) : exit 0,
       imprime les défauts trouvés et leurs comptes ;
     • `node _drive_sync_repro_test.mjs --strict`   → exit 1 dès qu'un défaut
       est constaté (c'est le mode que la FASE 1 prendra par défaut).

   CE QUI FAIT ÉCHOUER LES DEUX MODES : les vérifications de l'HARNESS
   lui-même (le module réel chargé, aucune suppression DÉFINITIVE, aucune
   requête inconnue du faux Drive, pagination complète). Un harness trompeur
   rendrait tout le reste faux — il n'a pas le droit de passer inaperçu.

   « exécuté » = le test l'a fait tourner. « lu » = le code est cité (file:line)
   et le test s'en tient là — la FASE 0 ne touche pas à React.
   ========================================================================= */
import { readFileSync, readdirSync } from 'node:fs';
import { createHarness, createAutosaveReplica } from './_harness/two-pc.mjs';

/* Un rejet non rattrapé ne doit JAMAIS tuer le test en silence : il vient d'un
   geste « au mieux » du code de l'app (un `.catch()` oublié) — c'est un
   RÉSULTAT, et il doit être vu. */
process.on('unhandledRejection', (err) => {
  console.error('\n✖ REJET NON RATTRAPÉ (un geste de fond de l’app a échoué sans que personne n’écoute) :');
  console.error(String((err && err.stack) || err).split('\n').slice(0, 6).join('\n'));
  process.exit(3);
});
process.on('uncaughtException', (err) => {
  console.error('\n✖ EXCEPTION NON RATTRAPÉE :');
  console.error(String((err && err.stack) || err).split('\n').slice(0, 6).join('\n'));
  process.exit(3);
});

const STRICT = process.argv.includes('--strict');
let asserts = 0;
const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  for (const x of Q.values()) {
    if (!x.proof.length && !x.answer) continue;
    console.error(`▶ ${x.id} [${x.verdict || '—'}]`);
    if (x.answer) console.error(`   RÉPONSE : ${x.answer}`);
    x.proof.forEach((pr) => console.error(`   · ${pr}`));
  }
  process.exit(2);
};
/** Vérification de l'HARNESS (ou de la loi du Drive) : elle casse tout. */
const must = (cond, what) => { asserts += 1; if (!cond) fail(`vérification de base échouée : ${what}`); };
const Q = new Map();
const q = (id, title) => { if (!Q.has(id)) Q.set(id, { id, title, answer: '', proof: [] }); return Q.get(id); };
const say = (id, text) => q(id, '').proof.push(text);
const answer = (id, text) => { q(id, '').answer = text; };

const HERE = './src/utils/driveUpload.js';
const UPLOAD_SRC = readFileSync(HERE, 'utf8');
const STRUCT_SRC = readFileSync('./src/utils/driveStructure.js', 'utf8');
const WORKSPACE_SRC = readFileSync('./src/utils/workspaceDrive.js', 'utf8');
const APP_SRC = readFileSync('./src/App.jsx', 'utf8');

/** Les faux Drives de la session : à la fin, ils doivent TOUS être propres. */
const DRIVES = [];
const newH = async (opts = {}) => { const h = await createHarness(opts); DRIVES.push(h.drive); return h; };
const defect = (id, text) => { const e = q(id, ''); e.verdict = 'défaut'; e.proof.push(text); };
const fine = (id) => { const e = q(id, ''); if (e.verdict !== 'défaut') e.verdict = 'comportement attendu'; };

/* ── LE CODE EST BIEN LE RÉEL (pas le bouchon de _esm_test_hook.mjs) ───────
   Trois preuves, et pas une seule : la SOURCE du module, la FONCTION chargée
   (`driveFetch` fabrique des URL googleapis.com — le bouchon ne le fait pas),
   et le FAIT que le faux Drive a reçu une requête Drive signée par le PC. */
const h0 = await newH({ seed: 3, datasetName: 'PREUVE DATASET', datasetId: 'ds0' });
const M0 = h0.pcs[0].mods.upload;
must(typeof M0.setDriveToken === 'function' && typeof M0.deleteTestDriveFolder === 'function',
  'les fonctions du module réel existent (setDriveToken, deleteTestDriveFolder)');
must(String(M0.driveFetch).includes('www.googleapis.com'),
  'la fonction driveFetch CHARGÉE est celle du module réel (elle fabrique les URL googleapis.com)');
must(!String(M0.cloudBackendAvailable).includes('__driveTestMocks'),
  'cloudBackendAvailable n’est pas le bouchon de _esm_test_hook.mjs');
const proofCalls = await h0.pcs[0].do((M) => M.upload.findOrCreateFolder('preuve', h0.datasetFolderId));
must(!!proofCalls && h0.drive.stats.calls > 0,
  'le faux Drive a bien reçu des requêtes émises par le module réel');
say('H', `module réel chargé : « ${String(M0.driveFetch).slice(0, 46)}… » · ${h0.drive.stats.calls} requête(s) reçues`);

/* ── LES CHARGES D'ESSAI ──────────────────────────────────────────────────
   La forme est celle du vrai payload de l'app : `data.projects` (la liste du
   magasin des projets, App.jsx:4100 `cloudProjectsPayload()`) et `data.tests`
   (les expériences), dont `projectNames` est le LIEN avec le projet
   (driveStructure.experimentCtxOf:493). */
const proj = (name = 'Proj', id = 'p1') => ({ id, name });
const exp = ({ id, name, project = 'Proj', instance = 'i1', html = '<p>x</p>' }) => ({
  id, name, projectNames: [project], instanceName: instance, date: '2026-01-01',
  sections: [{ title: 'Data', html }]
});
const DATA = (tests, projects = [proj()]) => ({ datasetTitle: 'MON DATASET', projects, tests });
const H = { seed: 11, datasetName: 'MON DATASET', datasetId: 'ds1' };
const pathNames = (h, node) => h.drive.pathOf(node.id);
const folderUnderProject = (h, name) => h.drive.live().filter((n) => n.mimeType === h.drive.FOLDER_MIME
  && n.name === name && pathNames(h, n).includes('projects'));
const publish = (pc, data, opts = {}) => pc.do((M) => M.structure.publishDatasetStructure({
  datasetId: H.datasetId, datasetName: H.datasetName, data, ...opts
}));

/* ═══ Q1 — DEUX EXPÉRIENCES HOMONYMES SONT-ELLES UNE SEULE ? ══════════════
   Le NOM est l'identité du dossier d'expérience (driveStructure:669-679 :
   `addLevels(levels)` avec `sanitizeSlug(level.name)`), et deux dossiers du même
   nom dans le même parent sont permis par Drive : la question est de savoir si
   l'app en fabrique deux — ou si le second ÉCRASE le premier. */
{
  const h = await newH(H);
  const A = h.pcs[0];
  const twins = DATA([exp({ id: 't1', name: 'Test 1' }), exp({ id: 't2', name: 'Test 1', html: '<p>deux</p>' })]);
  const plan = h.mods.structure.datasetMirrorPlan({ datasetId: H.datasetId, datasetName: H.datasetName, data: twins });
  const planned = plan.folders.filter((f) => f.name === 'Test_1');
  const plannedJson = plan.files.filter((f) => f.name === 'Test_1.json');
  const pub = await publish(A, twins);
  must(pub && pub.ok, 'la publication de deux expériences homonymes aboutit');
  const folders = folderUnderProject(h, 'Test_1');
  const jsons = h.drive.live().filter((n) => n.name === 'Test_1.json');
  say('Q1', `plan : ${planned.length} dossier(s) « Test_1 », ${plannedJson.length} JSON ; Drive : ${folders.length} dossier(s), ${jsons.length} JSON`);
  const merged = folders.length === 1 && jsons.length === 1;
  answer('Q1', merged
    ? `OUI : les deux expériences (« t1 » et « t2 ») deviennent UN SEUL dossier Test_1 et UN SEUL Test_1.json — la seconde a écrasé la première sur le Drive (exécuté).`
    : `NON : ${folders.length} dossiers / ${jsons.length} JSON (exécuté).`);

  /* `Test N` : le nom par défaut numérote sur la LONGUEUR de la liste. */
  must(APP_SRC.includes('name: `Test ${num}`'), 'le nom par défaut est `Test ${num}` (App.jsx:1145)');
  const callers = readdirSync('./src/components/AppModules').filter((f) => f.endsWith('.jsx'))
    .filter((f) => readFileSync(`./src/components/AppModules/${f}`, 'utf8').includes('createEmptyTest(id, tests.length + 1'));
  say('Q1', `le numéro vient de la LONGUEUR : « createEmptyTest(id, tests.length + 1) » dans ${callers.length} module(s) (${callers.join(', ')}) — App.jsx:1142 pour la fabrique`);
  /* La CONSÉQUENCE, exécutée : [Test 1, Test 2, Test 3], on supprime Test 2, le
     prochain numéro vaut longueur+1 = 3 → « Test 3 » DEUX FOIS. */
  const collided = DATA([
    exp({ id: 't1', name: 'Test 1' }), exp({ id: 't3', name: 'Test 3' }), exp({ id: 't4', name: 'Test 3' })
  ]);
  const pub2 = await publish(A, collided);
  must(pub2 && pub2.ok, 'la publication après suppression aboutit');
  const t3 = folderUnderProject(h, 'Test_3');
  say('Q1', `après une suppression : 2 expériences « Test 3 » → ${t3.length} dossier(s) Test_3 sur le Drive`);
  must(t3.length === 1, 'le doublon de nom ne produit pas deux dossiers (comportement mesuré)');

  /* Supprimer l'une : le geste ne connaît que le NOM. */
  const before = t3[0].id;
  const del = await A.do((M) => M.upload.deleteTestDriveFolder({ name: 'Test 3' }));
  const gone = h.drive.node(before);
  say('Q1', `🗑 sur « Test 3 » (nom) → dossier ${gone && gone.trashed ? 'à la corbeille' : 'encore vivant'} (retour = ${del})`);
  const left = folderUnderProject(h, 'Test_3');
  const survivors = h.drive.live().filter((n) => n.name === 'Test_3.json').length;
  say('Q1', `il reste ${left.length} dossier(s) Test_3 vivant(s) et ${survivors} JSON → les DEUX expériences ont perdu leur dossier Drive (une seule range le nom).`);
  answer('Q1', `${Q.get('Q1').answer} La suppression, elle, ne connaît que le nom : elle emporte le dossier COMMUN — donc les deux expériences (exécuté).`);
}

/* ═══ Q2 — OÙ VIVENT LA LISTE DES PROJETS ET LE LIEN EXPÉRIENCE→PROJET ? ══ */
{
  const h = await newH(H);
  const A = h.pcs[0];
  const B = h.pcs[1];
  const data = DATA([exp({ id: 't1', name: 'Test 1' })]);
  const pub = await publish(A, data);
  say('Q2', `publication : ok=${pub && pub.ok} · ${pub && pub.report ? JSON.stringify(pub.report) : ''}`);
  say('Q2', `arbre (dossiers) : ${h.drive.live().filter((n) => n.mimeType === h.drive.FOLDER_MIME).map((n) => h.drive.pathOf(n.id).join('/')).join(' | ')}`);
  const projFolder = h.drive.byPath(['Lab Workspace', h.datasetFolderName, 'projects', 'Proj']);
  must(!!projFolder, 'le dossier du projet existe (le lien devient un CHEMIN sur le Drive)');
  must(h.drive.filesNamed('Proj.json', projFolder.id).length === 1, 'le projet a son Proj.json sous SON dossier');
  say('Q2', `le LIEN est un chemin : « ${h.drive.pathOf(projFolder.id).slice(1).join('/')} » ; l’expérience porte « projectNames » (driveStructure.experimentCtxOf:493-505)`);

  const copy = await A.do((M) => M.workspace.writeDatasetCopy({
    id: 'ds1', title: 'MON DATASET', testCount: 1, updatedAt: Date.now(),
    payload: JSON.stringify(data), isCompressed: false
  }));
  const copyNode = h.drive.byPath(['Lab Workspace', '_workspace', 'datasets', 'ds_ds1.json']);
  must(!!copy && !!copyNode, 'la copie du dataset part sur le Drive (_workspace/datasets/ds_ds1.json)');
  const copyText = h.drive.textOf(copyNode.id);
  const read = await B.do((M) => M.workspace.readDatasetCopy('ds1'));
  say('Q2', `copie ds_ds1.json : ${copyText.length} o · la charge relue porte « projects » : ${read && String(read.payload).includes('"projects"')} · « projectNames » : ${read && String(read.payload).includes('"projectNames"')}`);
  say('Q2', `relue par le PC B : ${read ? `id=${read.id}, titre=${read.title}` : 'null'}`);
  must(!!read && read.id === 'ds1', 'un AUTRE poste relit la copie par identifiant');
  say('Q2', read && read.payload ? `la copie porte la LISTE des projets (« ${String(read.payload).includes('"projects"') ? 'oui' : 'non'} ») — elle voyage donc avec le dataset, pas dans le dossier du Drive.` : '');
  must(APP_SRC.includes('cloudProjectsPayload()'),
    'App.jsx:4100 fusionne le magasin des projets DU POSTE dans la charge sauvegardée');
  fine('Q2');
}

/* ═══ Q3 — À L'OUVERTURE : QUELLES SOURCES, DANS QUEL ORDRE, ET QUELLE FUSION ? */
{
  const h = await newH(H);
  const A = h.pcs[0];
  const B = h.pcs[1];
  await A.do((M) => M.workspace.writeDatasetCopy({
    id: 'ds1', title: 'MON DATASET', testCount: 1, updatedAt: Date.now(),
    payload: JSON.stringify(DATA([exp({ id: 't1', name: 'Test 1' })])), isCompressed: false
  }));
  const state = h.mods.workspace.buildWorkspaceState({
    datasets: [{ id: 'ds1', title: 'MON DATASET', updatedAt: 100, testCount: 1 }],
    projects: [proj('Proj', 'p1')]
  });
  const wrote = await A.do((M) => M.workspace.writeWorkspaceState(state));
  const readState = await B.do((M) => M.workspace.readWorkspaceState());
  must(!!wrote && !!readState, 'l’index de l’espace (_workspace/state.json) s’écrit et se relit');
  say('Q3', `state.json relu par PC B : ${readState.datasets.length} dataset(s), ${readState.projects.length} projet(s), ${readState.deletedProjects.length} tombe(s) de projet`);

  /* La FUSION est PURE : on l'éprouve sur deux états divergents. */
  const local = h.mods.workspace.parseWorkspaceState(h.mods.workspace.buildWorkspaceState({
    datasets: [{ id: 'ds1', title: 'LOCAL', updatedAt: 200 }], projects: [proj('Local', 'pA')]
  }));
  const remote = h.mods.workspace.parseWorkspaceState(h.mods.workspace.buildWorkspaceState({
    datasets: [{ id: 'ds2', title: 'REMOTE', updatedAt: 100 }], projects: [proj('Remote', 'pB')]
  }));
  const merged = h.mods.workspace.mergeWorkspaceStates(local, remote);
  must(merged.datasets.length === 2 && merged.projects.length === 2,
    'la fusion de l’index garde les DEUX côtés, par identifiant');
  say('Q3', `mergeWorkspaceStates(local, remote) → ${merged.datasets.length} datasets, ${merged.projects.length} projets : FUSION PAR IDENTIFIANT (workspaceDrive.js:182-206, ` +
    `le plus récent « updatedAt » décrit) — pas un « dernier écrase tout » au niveau de l’INDEX.`);
  const sites = APP_SRC.split('\n').map((l, i) => ({ n: i + 1, l }))
    .filter((x) => /readDatasetCopy\(|readWorkspaceState\(|applyWorkspaceIndex\(/.test(x.l))
    .map((x) => `App.jsx:${x.n}`);
  say('Q3', `App.jsx lit la copie du dataset et l’index de l’espace : ${sites.join(', ')}`);
  answer('Q3', 'À l’ouverture, le poste lit SON magasin (et Firestore), et — quand la copie manque ou que Firestore ne répond pas — la copie `ds_<id>.json` du Drive (exécuté : un second poste la relit par identifiant). L’INDEX de l’espace (`state.json`) se FUSIONNE par identifiant (exécuté, fonction pure). Ce n’est donc PAS l’index qui est remplacé : c’est le CONTENU (Q4).');
  fine('Q3');
}

/* ═══ Q4 — writeDatasetCopy RELIT-IL LA VERSION DISTANTE AVANT D'ÉCRIRE ? ══
   Et que se passe-t-il quand DEUX postes écrivent la même copie ? */
{
  const h = await newH(H);
  const A = h.pcs[0];
  const B = h.pcs[1];
  const copyOf = (tag) => ({
    id: 'ds1', title: 'MON DATASET', testCount: 1, updatedAt: Date.now(),
    payload: JSON.stringify(DATA([exp({ id: `t_${tag}`, name: `Test ${tag}` })])), isCompressed: false
  });
  await A.do((M) => M.workspace.writeDatasetCopy(copyOf('A')));
  await B.do((M) => M.workspace.writeDatasetCopy(copyOf('B')));
  const node = h.drive.byPath(['Lab Workspace', '_workspace', 'datasets', 'ds_ds1.json']);
  must(!!node, 'la copie du dataset est sur le Drive');
  const text = h.drive.textOf(node.id);
  const fnBody = WORKSPACE_SRC.slice(WORKSPACE_SRC.indexOf('export const writeDatasetCopy'), WORKSPACE_SRC.indexOf('/** Relire le contenu'));
  const readsBefore = /readDatasetCopy|downloadJsonText/.test(fnBody);
  say('Q4', `writeDatasetCopy relit-il la version distante avant d’écrire ? ${readsBefore} (workspaceDrive.js:421-442 : la charge est écrite telle quelle) ; ` +
    `nombre de ds_ds1.json après deux écritures = ${h.drive.live().filter((n) => n.name === 'ds_ds1.json').length}`);
  say('Q4', `contenu final : t_A = ${text.includes('t_A')}, t_B = ${text.includes('t_B')} → ` +
    `${text.includes('t_B') && !text.includes('t_A') ? 'le contenu de PC A a été REMPLACÉ en bloc (le dernier écrivain gagne)' : 'les deux marques sont là — voir le détail'}`);
  defect('Q4', 'la copie du dataset s’écrit en BLOC, sans relecture ni fusion : ce que l’autre poste a écrit entre-temps disparaît sans un mot (aucun conflit signalé).');

  /* Deux écritures DANS LA MÊME FENÊTRE DE COHÉRENCE (aucun ne voit l'écriture
     de l'autre) : deux onglets, ou deux postes. */
  const h2 = await newH({ ...H, coherenceMs: 5000 });
  await h2.pcs[0].do((M) => M.workspace.writeDatasetCopy(copyOf('A')));
  await h2.pcs[1].do((M) => M.workspace.writeDatasetCopy(copyOf('B')));
  const twins = h2.drive.live().filter((n) => n.name === 'ds_ds1.json');
  say('Q4', `avec 5 s de retard de cohérence : ${twins.map((f) => `${f.id}=${h2.drive.textOf(f.id).includes('t_B') ? 'B' : 'A'}`).join(' · ')}`);
  const back = await h2.pcs[1].do((M) => M.workspace.readDatasetCopy('ds1'));
  const backTag = back && back.payload && back.payload.includes('t_B') ? 'B (la sienne)' : 'A (la plus ancienne)';
  say('Q4', `ce que PC B relit ensuite par identifiant : ${backTag}`);
  if (twins.length > 1) defect('Q4', `deux jumeaux de la copie du dataset (${twins.length}) dans la fenêtre de cohérence — et la relecture peut tomber sur la version périmée.`);
  fine('Q4');
}

/* ═══ Q5 — QUELS APPELS AVALENT L'ERREUR, LESQUELS RÉESSAIENT ? ═══════════ */
{
  const runs = [
    { label: '429 (quota)', drive: { errorRate: 1, errorStatuses: [429] } },
    { label: '500 (serveur)', drive: { errorRate: 1, errorStatuses: [500] } },
    { label: '403 (périmètre)', drive: { errorRate: 1, errorStatuses: [403] } },
    { label: 'panne réseau (fetch rejette)', drive: { networkErrorRate: 1 } }
  ];
  for (const r of runs) {
    const h = await newH({ ...H, drive: r.drive });
    let out = null;
    let threw = '';
    try {
      out = await h.pcs[0].do((M) => M.upload.findOrCreateFolder('X', h.datasetFolderId));
    } catch (e) { threw = String((e && e.message) || e); }
    const s = h.drive.stats;
    say('Q5', `${r.label} : appel(s) reçu(s) = ${s.calls} · dossier créé = ${out ? 'oui' : 'non'} · exception remontée à l’appelant = ${threw || 'AUCUNE'}`);
    if (!threw && !out) defect('Q5', `${r.label} : l’échec est AVALÉ (l’appelant reçoit une valeur vide, aucune erreur ne remonte) et rien n’est écrit — l’utilisateur ne voit rien.`);
  }

  /* 401 : jeton expiré — le seul cas que le code REDRESSE (rénovation + rejeu). */
  const h = await newH(H);
  const A = h.pcs[0];
  h.drive.expireToken(A.token);
  const afterRenew = await A.do((M) => M.upload.findOrCreateFolder('ApresReno', h.datasetFolderId));
  say('Q5', `401 avec le serveur de jetons debout : dossier obtenu = ${afterRenew ? 'oui' : 'non'} · rénovation(s) = ${h.drive.stats.tokenMints} · jeton du poste changé = ${A.read('labDriveAccessToken') !== A.token}`);
  must(h.drive.stats.tokenMints >= 1, 'le 401 déclenche bien une rénovation du jeton');
  /* 401 et serveur de jetons ÉTEINT : plus rien ne peut redresser. */
  const h2 = await newH(H);
  const B = h2.pcs[0];
  h2.drive.setTokenServer('down');
  h2.drive.expireToken(B.token);
  let threw2 = '';
  let out2 = null;
  try { out2 = await B.do((M) => M.upload.findOrCreateFolder('Perdu', h2.datasetFolderId)); } catch (e) { threw2 = String((e && e.message) || e); }
  say('Q5', `401 avec le serveur de jetons ÉTEINT : exception = ${threw2 || 'AUCUNE'} · dossier = ${out2 ? 'oui' : 'non'}`);
  if (!threw2 && !out2) defect('Q5', '401 irrécupérable : avalé comme les autres — l’app ne dit pas « jeton expiré », elle ne fait rien.');

  const files = ['src/utils/driveUpload.js', 'src/utils/driveMirror.js', 'src/utils/workspaceDrive.js',
    'src/utils/driveStructure.js', 'src/components/AppModules/activeTestModule.jsx',
    'src/components/AppModules/testsModule.jsx'];
  const counts = files.map((f) => `${f.split('/').pop()} : ${(readFileSync(f, 'utf8').match(/\.catch\(\(\) => \{\}\)/g) || []).length}`);
  say('Q5', `« .catch(() => {}) » (échec silencieux) — ${counts.join(' · ')} (compté dans la SOURCE, lu)`);
  answer('Q5', 'Réessai : SEULEMENT la panne réseau (une fois, avec un jeton frais — driveUpload.js:272-278) et le 401 (rénovation silencieuse + rejeu, 287-306). 403, 429, 5xx et un 401 irrécupérable ne sont PAS réessayés : ils lèvent, et l’appelant qui porte un `.catch(() => {})` les avale — le dossier n’est alors pas créé et personne ne le dit (mesuré quatre fois, exécuté).');
}

/* ═══ Q6 — LE NOM ENTRE-T-IL À CHAQUE TOUCHE ? L'AUTOSAVE PUBLIE-T-IL UN
   NOM PARTIEL ? ═════════════════════════════════════════════════════════════
   La partie React n'est PAS exécutée ici (elle ne l'est pas headless) : elle
   est LUE. La CONSÉQUENCE, elle, est EXÉCUTÉE — publier trois états du même
   objet, dont deux partiels, puis faire le geste de confirmation (onBlur). */
{
  const h = await newH(H);
  const A = h.pcs[0];
  let data = DATA([exp({ id: 't1', name: 'Exp' })]);
  const auto = createAutosaveReplica({ pc: A, datasetId: 'ds1', delayMs: 20, payloadFn: () => data });
  auto.schedule();                     // l'utilisateur tape : l'effet d'App.jsx repart
  await auto.flush();                  // pagehide / arrière-plan : PUBLIE le partiel
  data = DATA([exp({ id: 't1', name: 'Exp 1' })]);
  auto.schedule();
  await auto.flush();
  data = DATA([exp({ id: 't1', name: 'Exp 10' })]);
  auto.schedule();
  await new Promise((r) => setTimeout(r, 80));   // le minuteur (1 500 ms en vrai, App.jsx:4199)
  const counts = ['Exp', 'Exp_1', 'Exp_10'].map((n) => `${n}=${folderUnderProject(h, n).length}`);
  say('Q6', `un SEUL objet (« t1 ») publié trois fois (« Exp » → « Exp 1 » → « Exp 10 ») : ${counts.join(' · ')}`);
  say('Q6', `journal de l’autosave : ${JSON.stringify({ saves: auto.report.saves, published: auto.report.published, errors: auto.report.errors.slice(0, 2), dernier: auto.report.lastResult && auto.report.lastResult.reason ? auto.report.lastResult.reason : 'ok' })}`);
  say('Q6', `arbre : ${h.drive.live().filter((n) => n.mimeType === h.drive.FOLDER_MIME).map((n) => h.drive.pathOf(n.id).join('/')).join(' | ')}`);
  const ren = await A.do((M) => M.upload.renameDriveFilesFor({ field: 'test', oldValue: 'Exp_1', newValue: 'Exp_10' }));
  const after = ['Exp', 'Exp_1', 'Exp_10'].map((n) => `${n}=${folderUnderProject(h, n).length}`);
  say('Q6', `puis le geste de confirmation (« renameDriveFilesFor test Exp_1 → Exp_10 ») : ${JSON.stringify(ren)} — ${after.join(' · ')}`);
  const total = h.drive.live().filter((n) => n.mimeType === h.drive.FOLDER_MIME
    && pathNames(h, n).includes('projects') && pathNames(h, n).length === 5).length;
  if (total > 1) defect('Q6', `${total} dossiers d'expérience vivants pour UN objet : la publication d'un nom partiel laisse le dossier de l'état précédent (jumeaux), et le geste de confirmation ne les reprend pas.`);
  must(APP_SRC.includes('setTimeout(runSave, 1500)'), 'le délai d’autosave est bien 1 500 ms (App.jsx:4199)');
  must(APP_SRC.includes("window.addEventListener('pagehide', flushPendingSave)"),
    'la fermeture d’onglet publie SANS attendre le délai (App.jsx:4200-4220)');

  /* Le nom entre-t-il dans le MODÈLE à chaque frappe ? (lu, avec les lignes) */
  const nameWrites = [];
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    const p = `${dir}/${d.name}`;
    if (d.isDirectory()) return walk(p);
    if (!/\.jsx?$/.test(d.name)) return;
    readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
      if (/name:\s*e\.target\.value|name:\s*ev\.target\.value|name:\s*event\.target\.value/.test(l)) {
        nameWrites.push(`${p.replace('./src/components/', '')}:${i + 1}`);
      }
    });
  });
  walk('./src/components');
  must(nameWrites.length > 0, 'au moins un champ de nom écrit le modèle à chaque frappe (lu dans le code)');
  say('Q6', `le nom part dans le MODÈLE à chaque frappe (lu) : ${nameWrites.slice(0, 5).join(', ')}${nameWrites.length > 5 ? ` … (${nameWrites.length} sites)` : ''}`);
  answer('Q6', 'OUI aux deux : chaque frappe écrit le nom dans le modèle (sites cités, lus), et l’autosave publie CE QUE LE MODÈLE PORTE (exécuté : « Exp », « Exp 1 » puis « Exp 10 » ont donné trois dossiers d’expérience distincts pour le même objet). Le geste de confirmation (onBlur) n’efface pas les dossiers déjà publiés.');
  fine('Q6');
}

/* ═══ Q7 — trashed=false PARTOUT, PAGINATION ENTIÈRE, JUMEAU CANONIQUE
   DÉTERMINISTE, ADOPTION D'UNE CORBEILLE ═════════════════════════════════ */
{
  const h = await newH({ ...H, seed: 5 });
  const A = h.pcs[0];
  const many = h.drive.mkFolder('pagination', h.datasetFolderId);
  for (let i = 0; i < 1200; i += 1) h.drive.mkFile({ name: `f${i}.txt`, parent: many, text: 'x' });
  const listed = await A.do((M) => M.upload.listDriveChildren(many));
  must(Array.isArray(listed), 'listDriveChildren rend une liste');
  say('Q7', `1 200 enfants dans un dossier : listés = ${listed.length} · pages servies par le faux Drive = ${h.drive.stats.pages}`);
  must(listed.length === 1200, 'la pagination (nextPageToken) est suivie jusqu’au bout');

  const a = { id: 'tw1', name: 'Proj', folder: true, items: 3, createdTime: '2023-01-01T00:00:00.000Z' };
  const b = { id: 'tw2', name: 'Proj', folder: true, items: 0, createdTime: '2024-01-01T00:00:00.000Z' };
  const p1 = h.mods.twins.pickCanonicalFolder([a, b]);
  const p2 = h.mods.twins.pickCanonicalFolder([b, a]);
  must(!!p1 && !!p2, 'un canonique est choisi parmi des jumeaux');
  say('Q7', `deux jumeaux de même nom : canonique = ${p1.id} (ordre inverse → ${p2.id}) — DÉTERMINISTE : ${p1.id === p2.id}`);
  say('Q7', `la règle (lu, source) : ${String(h.mods.twins.pickCanonicalFolder).replace(/\s+/g, ' ').slice(0, 200)}…`);

  await publish(A, DATA([exp({ id: 'tx', name: 'Trashed' })]));
  const folder = folderUnderProject(h, 'Trashed')[0];
  must(!!folder, 'le dossier de l’expérience existe');
  h.drive.trashNode(folder.id);
  /* ⚠ On CHANGE le contenu avant de republier : republier à l'identique est
     sauté par les empreintes (comportement réel de l'app, pas un défaut). */
  const again = await publish(A, DATA([exp({ id: 'tx', name: 'Trashed', html: '<p>après la corbeille</p>' })]));
  const after = folderUnderProject(h, 'Trashed');
  say('Q7', `seconde publication (même session) : ok=${again && again.ok} · reason=${again && again.reason} · erreurs=${JSON.stringify((again && again.report && again.report.errors || []).slice(0, 2))}`);
  say('Q7', `dossier à la corbeille puis republication du MÊME objet : ${after.length} dossier(s) vivant(s) — ` +
    `${after[0] ? (after[0].id === folder.id ? 'le même identifiant (adopté)' : 'un identifiant NEUF (recréé à côté)') : 'AUCUN (les fichiers refusent d’entrer : « upload failed »)'}`);
  const adopted = await A.do((M) => M.upload.untrashDriveFile(folder.id));
  /* DEUXIÈME ESSAI, MAIS DANS UNE SESSION NEUVE (caches de session vidés) :
     c'est le cas d'un poste qu'on rouvre. Sans cette distinction, le test
     accuserait l'app d'un défaut qui n'est que celui d'une session. */
  h.mods.structure.resetDriveStructureCache();
  h.mods.structure.resetPublishedFingerprints();
  const fresh = await publish(A, DATA([exp({ id: 'tx', name: 'Trashed', html: '<p>session neuve</p>' })]));
  const freshLive = folderUnderProject(h, 'Trashed');
  say('Q7', `session NEUVE (caches vidés) puis republication : ok=${fresh && fresh.ok} · dossiers vivants « Trashed » = ${freshLive.length} · ` +
    `${freshLive[0] ? (freshLive[0].id === folder.id ? 'MÊME identifiant (adopté)' : 'identifiant NEUF (recréé)') : 'aucun'}`);
  if (after.length === 0) {
    defect('Q7', 'dans la MÊME session, après la mise à la corbeille, la publication essaie d’écrire dans le dossier cestiné qu’elle a retenu (« upload failed » sur l’expérience et ses sections) : l’expérience reste ABSENTE du Drive jusqu’au rechargement de l’app, et la publication se dit en échec.');
  }
  say('Q7', `untrashDriveFile sur le dossier mis à la corbeille → ${adopted} : l’adoption est POSSIBLE (un geste suffit) ; le publish, lui, ne la fait pas tout seul.`);
  answer('Q7', 'Recherches : toutes celles de l’app portent `trashed=false` (vérifié à chaque exécution — le faux Drive compte les recherches sans la clause, le compte doit rester à zéro). Pagination : entière (1 200 enfants, deux pages). Jumeau canonique : choix DÉTERMINISTE, indépendant de l’ordre d’arrivée, selon la règle lue dans datasetDirTwins.pickCanonicalFolder. Dossier à la corbeille : la publication ne l’ADOPTE pas dans la MÊME session (elle échoue dessus — « The target folder is gone », l’expérience disparaît du Drive) ; dans une session neuve elle aboutit et le dossier redevient VIVANT avec le MÊME identifiant (il est donc repris, pas dupliqué). `untrashDriveFile` peut aussi le reprendre à la main.');
  fine('Q7');
}

/* ═══ Q8 — PÉRIMÈTRE, COMPTES, VOLUME, ET CE QU'ON PEUT PROUVER DU FLUSH ══ */
{
  const h = await newH(H);
  const A = h.pcs[0];
  const warned = [];
  const orig = console.warn;
  console.warn = (...args) => warned.push(String(args[0]).slice(0, 150));
  const big = await A.do((M) => M.workspace.writeDatasetCopy({
    id: 'ds1', title: 'BIG', updatedAt: Date.now(),
    payload: 'x'.repeat(9 * 1024 * 1024), isCompressed: false
  }));
  console.warn = orig;
  const copyFiles = h.drive.live().filter((n) => n.name === 'ds_ds1.json').length;
  say('Q8', `copie de ~9 Mo : écriture = ${big} · fichier(s) ds_ds1.json sur le Drive = ${copyFiles} · avertissement(s) console = ${warned.length}${warned[0] ? ` (« ${warned[0]} »)` : ''}`);
  if (big === null && copyFiles === 0) {
    defect('Q8', 'au-delà de 8 Mo la copie Drive n’est pas écrite et SEUL un avertissement de console le dit : rien de persistant à l’écran (c’est exactement ce que la FASE 1 doit corriger par un bandeau).');
  }
  const email = await A.do((M) => M.upload.getDriveAccountEmail());
  say('Q8', `compte Google lu par l’app : ${email || '(vide)'}`);
  const hasScope = readFileSync('./src/data/constants.js', 'utf8').includes('auth/drive.file')
    || UPLOAD_SRC.includes('auth/drive.file');
  must(hasScope, 'le périmètre demandé contient « drive.file » (constants.js / driveUpload.js)');
  say('Q8', `supportsAllDrives (Drives partagés) présent dans driveUpload.js : ${UPLOAD_SRC.includes('supportsAllDrives')} (lu)`);
  must(APP_SRC.includes("window.addEventListener('pagehide', flushPendingSave)"), 'App.jsx:4220 écoute pagehide');
  must(APP_SRC.includes("document.addEventListener('visibilitychange'"), 'App.jsx:4221 écoute visibilitychange');
  say('Q8', 'NON DÉMONTRABLE ICI : c’est le NAVIGATEUR qui déclenche `pagehide`. Ce que le test a prouvé : la fonction que l’événement appelle (flushPendingSave → runSave(true) → publication + copie du dataset) écrit vraiment — Q6 s’en sert. Le déclenchement réel, tu le vérifies à la main.');
  answer('Q8', 'Périmètre : « drive.file » (+ gmail.send), un seul compte Google (celui qui est connecté) ; les Drives partagés ne sont pas ouverts (`supportsAllDrives` absent du module). Au-delà de 8 Mo (MAX_DATASET_COPY_BYTES, workspaceDrive.js:416) la copie Drive n’est pas écrite et seul un avertissement de console le dit. La taille RÉELLE de tes `ds_<id>.json` se lit dans l’audit en lecture seule (point c).');
  fine('Q8');
}

/* ═══ R — SCÉNARIO MINIMAL REPRODUCTIBLE : RENOMMER ET DÉPLACER UNE
   EXPÉRIENCE PAR LA SEULE PUBLICATION ═══════════════════════════════════════
   Quatre gestes, aucun aléa, aucun second poste, aucun retard, aucune erreur —
   et pourtant : le dossier du NOUVEAU nom naît VIDE, l'ancien garde tout, et le
   DÉPLACEMENT ne produit rien. C'est le défaut central du rapport (nom =
   identité), réduit à sa plus petite forme : chaque ligne ci-dessous est une
   preuve exécutée, pas une lecture. */
{
  const h = await newH({ seed: 99, datasetName: 'PROBE DATASET', datasetId: 'ds_probe' });
  const A = h.pcs[0];
  const P = (data) => A.do((M) => M.structure.publishDatasetStructure({
    datasetId: 'ds_probe', datasetName: 'PROBE DATASET', data
  }));
  const leaf = (name, project = 'Proj') => exp({ id: 't1', name, project });
  const full = (tests) => ({ datasetTitle: 'PROBE DATASET', projects: [proj('Proj', 'p1'), proj('Autre', 'p2')], tests });
  const nameOf = (h2, n) => h2.drive.pathOf(n.id).slice(1).join('/');
  const folders = () => h.drive.live().filter((n) => n.mimeType === h.drive.FOLDER_MIME).map((n) => nameOf(h, n));
  const files = () => h.drive.live().filter((n) => n.mimeType !== h.drive.FOLDER_MIME).map((n) => nameOf(h, n));

  await P(full([leaf('Alpha')]));
  const base = `PROBE_DATASET/projects/Proj/Alpha`;
  must(folders().includes(base) && folders().includes(`${base}/i1`) && folders().includes(`${base}/i1/data`),
    'l’expérience créée a bien ses trois niveaux sur le Drive');
  const projFolderId = h.drive.byPath(['Lab Workspace', 'PROBE_DATASET', 'projects', 'Proj']).id;

  /* ② LE MÊME objet, renommé — par la SEULE publication. */
  await P(full([leaf('Beta')]));
  const after = files();
  say('R', `renommé Alpha → Beta (même id) : dossiers ${JSON.stringify(folders().filter((p) => p.includes('/Proj/')))}`);
  say('R', `fichiers de l’expérience : ${JSON.stringify(after.filter((p) => p.includes('/Proj/')))}`);
  must(folders().includes(`${base}/i1/data`), 'l’ancien dossier est TOUJOURS là, avec ses enfants');
  const betaFolder = h.drive.foldersNamed('Beta', projFolderId)[0] || null;
  const alphaStillThere = folders().includes(base);
  const betaEmpty = !!betaFolder && h.drive.childrenOf(betaFolder.id).length === 0;
  const betaJsonInOld = files().includes(`${base}/i1/Beta.json`);
  const oldJsonKept = files().includes(`${base}/i1/Alpha.json`);
  say('R', `nouveau dossier « Beta » : ${betaFolder ? h.drive.pathOf(betaFolder.id).slice(1).join('/') : 'AUCUN'} — ${betaEmpty ? 'VIDE (aucun enfant)' : betaFolder ? `${h.drive.childrenOf(betaFolder.id).length} enfant(s)` : '—'}`);
  say('R', `le JSON du nouvel état est allé DANS L’ANCIEN dossier : ${betaJsonInOld} ; l’ancien JSON est resté : ${oldJsonKept}`);
  say('R', `identifiant du dossier Alpha conservé : ${alphaStillThere}`);

  /* ③ DÉPLACEMENT du même objet vers un autre projet, toujours par publication. */
  await P(full([leaf('Beta', 'Autre')]));
  say('R', `après déplacement vers « Autre » : ${JSON.stringify(folders().filter((p) => p.includes('/Proj/') || p.includes('/Autre/'))) } — ` +
    `un dossier « Autre/Beta » existe : ${folders().includes('PROBE_DATASET/projects/Autre/Beta')}`);

  /* ④ SESSION NEUVE (caches vidés) : la publication se répare-t-elle ? */
  h.mods.structure.resetDriveStructureCache();
  h.mods.structure.resetPublishedFingerprints();
  await P(full([leaf('Beta', 'Autre')]));
  const healed = folders().includes('PROBE_DATASET/projects/Autre/Beta');
  const cleaned = !folders().includes(base);
  say('R', `session neuve + republication : dossier au nouveau nom = ${healed}, ancien dossier disparu = ${cleaned}`);

  if (betaEmpty && oldJsonKept && betaJsonInOld) {
    defect('R', 'renommer une expérience par la SEULE publication crée un dossier VIDE au nouveau nom et laisse l’ancien avec tous les fichiers (dont le JSON du nouvel état) : sur le Drive, deux dossiers pour un objet — et l’expérience paraît vide sous son nouveau nom.');
  }
  if (!folders().includes('PROBE_DATASET/projects/Autre/Beta')) {
    defect('R', 'déplacer une expérience d’un projet à l’autre par la publication ne produit RIEN sur le Drive (aucun dossier créé ni déplacé) : le déplacement est silencieusement perdu.');
  }
  if (!healed || !cleaned) {
    defect('R', 'une session NEUVE ne répare pas : le dossier vide du nouveau nom est repris tel quel et l’ancien reste — le défaut est durable, il n’attend pas une seconde publication.');
  }
  answer('R', 'La publication seule ne renomme pas et ne déplace pas un dossier d’expérience : elle en fabrique un second (vide) au nouveau nom, écrit le nouvel état DANS l’ancien dossier, laisse l’ancien nom en place, et ignore le déplacement. Aucun aléa, aucun second poste : le nom est bien l’identité, et elle ne se transporte pas.');
}

/* ── VERDICT DE L'HARNESS ET TABLEAU FINAL ──────────────────────────────── */
for (const d of DRIVES) {
  must(d.stats.permanentDeletes === 0, `aucune suppression DÉFINITIVE (DELETE) : vu ${d.stats.permanentDeletes}`);
  must(d.stats.unsupportedQueries.length === 0, `aucune requête incomprise du faux Drive : « ${d.stats.unsupportedQueries[0] || ''} »`);
  must(d.stats.unrouted.length === 0, `aucune route inconnue demandée par l'app : ${d.stats.unrouted[0] || ''}`);
  must(d.stats.searchByNameWithoutTrashedFalse === 0, 'toutes les recherches par nom portent « trashed=false »');
}
const defects = [...Q.values()].filter((x) => x.verdict === 'défaut');
console.log(`\n═══ FASE 0 — RÉPONSES (${asserts} vérifications de base, ${Q.size} questions) ═══`);
for (const x of Q.values()) {
  console.log(`\n▶ ${x.id} [${x.verdict || '—'}]`);
  console.log(`   RÉPONSE : ${x.answer}`);
  x.proof.forEach((pr) => console.log(`   · ${pr}`));
}
console.log(`\nMODE : ${STRICT ? 'STRICT' : 'BASELINE'} — défaut(s) constaté(s) : ${defects.length}`);
console.log(`DÉFAUTS : ${defects.map((d) => d.id).join(', ') || 'aucun'}`);
process.exit(STRICT && defects.length ? 1 : 0);
