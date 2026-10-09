/* =========================================================================
   _experiment_vanishing_test.mjs — « LE ESPERIENZE SPARISCONO DAL DATASET ».

   LE RAPPORT RÉPARÉ, mot pour mot : « anche nel dataset scientifico le
   esperienze spariscono: sul Drive ci sono ancora le cartelle e i .json, ma nel
   programma non ci sono più, e nessuno dice niente ».

   La cause : la liste des expériences vit ENTIÈRE dans le payload du dataset et
   chaque enregistrement (automatique : 1,5 s après la dernière frappe, vidé à la
   fermeture d'onglet) publie la liste telle qu'elle est en mémoire, d'un bloc.
   Un poste qui a lu une copie plus ancienne publie donc une liste plus courte,
   en silence — et rien ne le dit (il n'y a même pas de corbeille pour les
   expériences).

   La réparation vérifiée ici, en PUR (src/utils/experimentTombstones.js) :
     1. la LECTURE n'efface plus (`mergeExperimentsAddOnly`) ;
     2. l'ÉCRITURE ne perd rien sans record (`protectUnrecordedDrops`, le verrou) ;
     3. la SUPPRESSION est un record daté qui voyage, et un RETOUR volontaire le
        lève (`withoutRevivedExperiments`) — sans quoi un autre poste, qui
        détient encore l'expérience, la republierait.
   Les vérifications de CÂBLAGE (App.jsx) suivent : une règle juste que personne
   n'appelle ne répare rien.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

/* Un localStorage de poche : le magasin du module (bloc « MAGASIN ») est lu et
   écrit pour de vrai — c'est lui qui fait voyager une suppression d'une session
   à l'autre sur le même poste. */
const fakeStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (fakeStore.has(k) ? fakeStore.get(k) : null),
  setItem: (k, v) => { fakeStore.set(k, String(v)); },
  removeItem: (k) => { fakeStore.delete(k); },
  clear: () => fakeStore.clear(),
};

const T = await import('./src/utils/experimentTombstones.js');
const APP = readFileSync('./src/App.jsx', 'utf8').replace(/\r\n/g, '\n');
const LOAD = readFileSync('./src/utils/loadSelection.js', 'utf8').replace(/\r\n/g, '\n');

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => {
  assert.ok(String(src).includes(needle), `${what}\n  fragment absent : ${needle}`);
  passed += 1;
};
const lacks = (src, needle, what) => {
  assert.ok(!String(src).includes(needle), `${what}\n  fragment présent : ${needle}`);
  passed += 1;
};

const DS = 'ds1';
const ids = (list) => (Array.isArray(list) ? list : []).map((t) => String(t.id));

/* ── 1. LE VERROU : une écriture ne perd que ce qui a un RECORD ─────────── */
const A = { id: 't1', name: 'Aphids', datasetId: DS };
const B = { id: 't2', name: 'Bees', datasetId: DS };
const C = { id: 't3', name: 'Cicadas', datasetId: DS };

eq(ids(T.unrecordedDrops([A, B, C], [A, B], [])), ['t3'],
  'l’expérience absente de la liste écrite ET sans record est repérée — les autres non');
eq(ids(T.protectUnrecordedDrops([A, B, C], [A, B], []).tests), ['t1', 't2', 't3'],
  'la liste écrite GARDE l’expérience : rien ne disparaît sans record');
eq(ids(T.protectUnrecordedDrops([A, B, C], [A, B], []).rescued), ['t3'],
  '…et le compte-rendu dit laquelle a été remise (au lieu de la taire)');
eq(ids(T.protectUnrecordedDrops([A, B, C], [], []).tests), ['t1', 't2', 't3'],
  'le scénario même du rapport — une liste VIDE — n’efface plus rien');
eq(ids(T.protectUnrecordedDrops([A, B, C], [A, B], [{ id: 't3', datasetId: DS, deletedAt: 5 }]).tests), ['t1', 't2'],
  'une VRAIE suppression (record) passe : l’expérience reste dehors');
eq(T.protectUnrecordedDrops([A, B, C], [A, B, C], [{ id: 't3', datasetId: DS, deletedAt: 5 }]).removed, 1,
  '…et le retrait est compté quand la copie écrite portait encore une expérience supprimée ailleurs');
eq(ids(T.protectUnrecordedDrops([A, B, C], [A, B, C], [{ id: 't3', datasetId: DS, deletedAt: 5 }]).tests), ['t1', 't2'],
  '…et l’expérience supprimée ailleurs sort de la copie écrite (son 🗑 voyage avec le dataset)');
eq(ids(T.protectUnrecordedDrops([A, B, C], [A, B], [{ id: 't3', datasetId: 'ds2', deletedAt: 5 }]).rescued), ['t3'],
  'le record d’un AUTRE dataset ne peut pas faire disparaître cette expérience-ci');
eq(ids(T.protectUnrecordedDrops([A, B, C], [A, B], ['t3']).tests), ['t1', 't2'],
  'un record écrit par une version ancienne (id seul) reste compris');
eq(T.unrecordedDrops([A, B], [A, B], []).length, 0, 'une liste complète ne remet rien (aucun bruit)');
eq(T.unrecordedDrops([{ name: 'sans id' }], [], []).map((t) => t.name), ['sans id'],
  'une expérience SANS id est reconnue par son nom (elle est gardée elle aussi)');
eq(T.unrecordedDrops([{ type: 'plate-9x9box', id: 'b1', name: 'Boîte 1' }], [], []).length, 1,
  'une boîte de stockage entre dans la même règle (elle ne peut pas disparaître non plus)');
eq(T.unrecordedDrops([{ note: 'rien' }], [], []).length, 0,
  'une entrée sans id NI nom n’est pas « remise » (elle n’est pas identifiable)');

/* ── 2. LA LECTURE : adopter sans jamais effacer ────────────────────────── */
eq(ids(T.mergeExperimentsAddOnly([A, B, C], [A, B], []).tests), ['t1', 't2', 't3'],
  'une copie relue PLUS COURTE n’efface plus ce que ce poste connaît');
eq(ids(T.mergeExperimentsAddOnly([A, B, C], [A, B], []).added), ['t3'],
  '…et ce qui a été gardé est nommé (c’est le signe d’un autre poste en retard)');
eq(ids(T.mergeExperimentsAddOnly([A], [A, B], []).tests), ['t1', 't2'],
  'une copie relue PLUS LONGUE est adoptée telle quelle (rien à garder)');
eq(ids(T.mergeExperimentsAddOnly([A], [A, B], []).added), [], '…sans bruit');
eq(ids(T.mergeExperimentsAddOnly([A, B, C], [A, B, C], [{ id: 't3', datasetId: DS, deletedAt: 5 }]).tests), ['t1', 't2'],
  'ce qui a été supprimé reste supprimé, même porté par la mémoire du poste');
eq(ids(T.mergeExperimentsAddOnly([C], [A, B], [{ id: 't3', datasetId: DS, deletedAt: 5 }]).tests), ['t1', 't2'],
  'une relecture ne RESSUSCITE pas une expérience supprimée');
eq(T.mergeExperimentsAddOnly([A], [A], []).tests[0], A,
  'la copie relue fait foi pour ce qu’elle porte (la version gardée vient du poste)');

/* ── 3. LA SUPPRESSION EST UNE DONNÉE (et un retour la lève) ────────────── */
eq(T.withoutRevivedExperiments([{ id: 't3', datasetId: DS, deletedAt: 5 }], []).length, 1,
  'sans levée, la suppression tient');
eq(T.withoutRevivedExperiments([{ id: 't3', datasetId: DS, deletedAt: 5 }], [{ id: 't3', datasetId: DS, revivedAt: 6 }]).length, 0,
  'une levée PLUS RÉCENTE annule la suppression (l’expérience restaurée revient)');
eq(T.withoutRevivedExperiments([{ id: 't3', datasetId: DS, deletedAt: 6 }], [{ id: 't3', datasetId: DS, revivedAt: 5 }]).length, 1,
  'supprimer APRÈS avoir restauré supprime pour de bon');
eq(T.withoutRevivedExperiments([{ id: 't3', datasetId: 'ds2', deletedAt: 5 }], [{ id: 't3', datasetId: DS, revivedAt: 9 }]).length, 1,
  'la levée d’un AUTRE dataset ne lève pas celle-ci');
eq(T.withoutRevivedExperiments([{ name: 'Cicadas', deletedAt: 5 }], [{ name: 'Cicadas', datasetId: DS, revivedAt: 6 }]).length, 0,
  'un record sans id se lit par le nom (vestige d’une version ancienne)');
eq(ids(T.withoutDeletedExperiments([A, B, C], [{ id: 't2', datasetId: DS, deletedAt: 1 }])), ['t1', 't3'],
  'withoutDeletedExperiments écarte par id');
eq(T.isExperimentDeleted({ name: 'Bees' }, [{ id: 't9', name: 'Bees', deletedAt: 1 }]), true,
  'une expérience sans id est reconnue par son nom');
eq(T.isExperimentDeleted({ id: 't2', name: 'Bees' }, [{ name: 'Bees', deletedAt: 1 }]), true,
  'un record sans id reconnaît l’expérience de ce nom');
eq(T.isExperimentDeleted({ id: 't2', name: 'Autre' }, [{ id: 't2', name: 'Bees', deletedAt: 1 }]), true,
  'l’id prime sur le nom (une expérience renommée reste supprimée)');

/* ── 4. LE MAGASIN : le geste laisse un record, la restauration le lève ─── */
fakeStore.clear();
T.recordExperimentDeletions([A, B, C], [A, B], DS, 1000);
eq(T.loadExperimentDeletions().map((r) => r.id), ['t3'], 'le geste 🗑 laisse la suppression de CE qui a disparu');
eq(T.isExperimentDeleted(C, T.loadExperimentDeletions()), true, '…et le verrou la reconnaît');
T.recordExperimentRevivals([C], DS, 2000);
eq(T.withoutRevivedExperiments(T.loadExperimentDeletions(), T.loadExperimentRevivals()).length, 0,
  'la restauration volontaire lève la suppression (sinon le verrou reprendrait l’expérience restaurée)');
T.recordExperimentDeletions([A, B, C], [A, B], DS, 3000);
eq(T.withoutRevivedExperiments(T.loadExperimentDeletions(), T.loadExperimentRevivals()).length, 1,
  'supprimer à nouveau, APRÈS la restauration, supprime pour de bon');
T.adoptExperimentDeletions([{ id: 't7', name: 'Sept', datasetId: DS, deletedAt: 4 }]);
eq(T.isExperimentDeleted({ id: 't7', datasetId: DS }, T.loadExperimentDeletions()), true,
  'adopter les records d’une copie (un autre poste a supprimé) vaut ici aussi');
eq(T.normalizeDeletions(['t1', { id: 't1', datasetId: DS, deletedAt: 9 }, { datasetId: DS, deletedAt: 2 }]).length, 2,
  'les records sont normalisés : dédoublonnés par identité, ceux sans identité écartés');
eq(T.describeUnrecordedDrops([]), '', 'aucune perte réparée → aucune phrase (le cas normal reste muet)');
ok(T.describeUnrecordedDrops([C]).includes('KEPT'), 'une perte réparée SE DIT');
ok(T.describeKeptExperiments([C]).includes('Cicadas'), 'ce qui a été gardé à la relecture est nommé');
ok(T.describeRemovedExperiments(2).includes('2'), 'ce qui a été retiré par un record est compté');

/* ── 5. LE CÂBLAGE : le verrou est DANS les chemins, pas dans une page ──── */
has(APP, "} from './utils/experimentTombstones';",
  'App.jsx importe le verrou des expériences (une règle juste que personne n’appelle ne répare rien)');
has(APP, 'deletedExperiments: loadExperimentDeletions(),',
  'la suppression d’une expérience VOYAGE avec le payload du dataset');
eq(APP.split('rawData.tests = guardExperimentsForWrite(rawData.tests);').length - 1, 2,
  'l’enregistrement automatique ET la sortie du dataset passent par le verrou (les deux seuls points d’écriture)');
has(APP, 'recordExperimentDeletions(prev, next, currentDatasetIdRef.current);',
  'le GESTE (🗑, undo/redo…) laisse sa suppression enregistrée — c’est ce qui distingue une suppression d’une perte');
has(APP, 'const merged = mergeExperimentsAddOnly(',
  'une RELECTURE (ouverture, 🔄 Refresh) est en AJOUT SEUL : elle n’efface plus');
has(APP, 'adoptDatasetExperimentRecords(dset);',
  'les records portés par la copie relue sont adoptés (une suppression d’un autre poste vaut ici)');
has(APP, 'rememberExperiments(currentDatasetId, tests);',
  'ce que l’écran montre est RETENU : la mémoire du poste est la base du verrou');
has(APP, 'protectUnrecordedDrops(knownExperimentsOf(datasetId), list, deletions)',
  'la liste écrite est corrigée AVANT de partir');
has(APP, 'describeUnrecordedDrops(out.rescued)',
  'un sauvetage SE DIT (un enregistrement muet était le défaut)');
has(APP, 'forgetExperiments(targetId, loadedTests);',
  'un REMPLACEMENT volontaire (♻️) est le seul geste qui vide la mémoire du poste');
lacks(APP, 'const newTests = loadedTests.map((p) => ({',
  'l’ajout ne donne plus un id NEUF à chaque copie (le défaut qui perdait lien de projet et dossier Drive)');
has(APP, 'newTests.push(p && p.id ? { ...p } : { ...p, id: freshId() });',
  'l’ajout CONSERVE l’id d’origine de l’expérience restaurée');
has(APP, 'if (key && existingKeys.has(key)) return;',
  'une expérience que le dataset porte déjà n’entre jamais deux fois (aucun jumeau à supprimer)');
has(APP, 'recordExperimentRevivals(newTests, targetId);',
  'un retour volontaire LÈVE la suppression (sinon le verrou reprendrait l’expérience restaurée)');
has(APP, 'const testRowPicks = (rowsPicked && Array.isArray(rowsPicked[TESTS_SECTION_ID]))',
  'le dataset scientifique a lui aussi une sélection LIGNE À LIGNE');
has(APP, 'pickExperimentRows(allLoadedTests, testRowPicks)',
  '…et elle réduit la page cochée à ce qui est coché');
has(APP, 'const sciRows = experimentRowChoices(loadedTests, testsRef.current, false);',
  'la fenêtre d’import d’un dataset scientifique PROPOSE ces lignes');
has(APP, 'const testRows = experimentRowChoices(pendingLoad.tests, pendingLoad.baseTests, false);',
  'le memo des lignes lit la liste COURANTE dans `pendingLoad` (photographiée par loadHTML) — et non `testsRef`, déclarée 250 lignes plus bas : un memo s’exécute PENDANT le rendu, la lire là levait « Cannot access \'testsRef\' before initialization » à l’ouverture de 📂 Load backup');
has(APP, 'baseTests: testsRef.current,',
  '…et c’est le GESTE (loadHTML, après le rendu) qui photographie cette liste');
lacks(APP, 'experimentRowChoices(pendingLoad.tests, testsRef.current',
  'aucun memo ne lit une ref déclarée plus bas (la porte _tdz_scan_test.mjs tient le reste)');
has(APP, 'experimentRestoreNote',
  'ce qui est revenu — et ce qui était déjà là — est DIT après l’import');

/* ── 6. LE RECUPERO « CHIRURGICO » : des lignes dans loadSelection.js ───── */
has(LOAD, "export const TESTS_SECTION_ID = 'data:tests';",
  'la page « Expériences / Tests » a son identifiant de lignes');
has(LOAD, 'export const experimentRowChoices = (incomingTests, baseTests, merging = false) => {',
  '…et ses lignes se calculent en PUR (loadSelection.js, testable)');
has(LOAD, 'export const pickExperimentRows = (tests, picks) => {',
  'l’application du choix ligne à ligne est pure elle aussi');
has(LOAD, 'export const testGroupKey = (t) => {',
  'l’identité d’une ligne est le NOM (la règle des pages du dataset)');
has(LOAD, "import { experimentKey } from './experimentTombstones';",
  'l’identité de repli est IMPORTÉE du verrou (une seule définition, jamais deux)');

const L = await import('./src/utils/loadSelection.js');
const C1 = { id: 't1', name: 'Aphids', projectNames: ['GEC'], operator: 'Nicola', date: '2026-01-05' };
const C2 = { id: 't2', name: 'Aphids', projectNames: ['GEC'], operator: 'Nicola', date: '2026-01-06' };
const C3 = { id: 't3', name: 'Bees', projectNames: ['GEC'] };

const rows = L.experimentRowChoices([C1, C2, C3], [C3], false);
eq(rows.length, 2, 'trois entrées, deux essais : DEUX lignes (une expérience = un nom avec ses conditions)');
eq(rows[0].key, 'name:Aphids', 'la ligne porte le NOM de l’essai — la règle des pages du dataset');
ok(rows[0].sub.includes('2 conditions'), 'la ligne dit combien de conditions elle ramène');
ok(rows[0].sub.includes('GEC'), '…et le projet de l’expérience, pour la reconnaître');
eq(rows[0].inBase, false, 'l’essai que le dataset ne porte pas n’est pas dit « déjà là »');
eq(rows[1].inBase, true, 'celui qu’il porte l’est (une seule de ses conditions suffit)');
eq(rows[0].picked, true, 'par défaut TOUT est coché : le seul défaut sûr pour les DEUX boutons');
eq(L.pickExperimentRows([C1, C2, C3], ['name:Aphids']).map((t) => t.id), ['t1', 't2'],
  'cocher une ligne ramène l’essai ENTIER (ses conditions) — et son id d’origine');
eq(L.pickExperimentRows([C1, C2, C3], ['name:Bees']).map((t) => t.id), ['t3'],
  'ne ramener QUE l’expérience perdue : c’est le geste chirurgical demandé');
eq(L.pickExperimentRows([C1, C2, C3], []).length, 0, 'rien de coché : rien ne part');
eq(L.experimentRowChoices([{ name: 'Senza id', condition: 1 }], [{ name: 'Senza id' }], false)[0].inBase, true,
  'une entrée sans id est reconnue par son nom (règle d’identité partagée avec le verrou)');
const rowsMerge = L.experimentRowChoices([C3], [C3], true);
eq([rowsMerge[0].locked, rowsMerge[0].picked], [true, false],
  'en fusion, une expérience déjà là est verrouillée et décochée (rien ne s’empile)');
const anon = L.experimentRowChoices([{ note: 'x' }], [], false);
eq([anon[0].key, anon[0].noIdentity], ['#row:0', true],
  'une entrée sans identité fait une ligne à elle, reconnaissable à sa POSITION');
eq(L.pickExperimentRows([{ note: 'x' }], ['#row:0']).length, 1, '…et elle se coche comme les autres');
eq(L.testGroupKey({ name: 'Aphids', id: 't9' }), 'name:Aphids',
  'le nom prime sur l’id pour le REGROUPEMENT (deux conditions = une ligne)');

/* ── 7. LA FENÊTRE DU DATASET SCIENTIFIQUE PORTE SES LIGNES ───────────────
   LE RAPPORT, mot pour mot : « il load backup non é chirurgico, non mi
   permette di selezionare i singoli tests ». Les lignes existaient, PURES et
   testées ci-dessus, et `confirmLoad` savait déjà les appliquer — mais la
   fenêtre d'un dataset SCIENTIFIQUE ne les recevait pas (`<LoadPickPanel>`
   sans `rows`) et ses deux boutons appelaient `confirmLoad('append')` /
   `confirmLoad('replace')` SANS le troisième argument (`loadRows`) : la
   sélection cochée sous « ▸ lines » était jetée. Le retour d'UNE expérience
   redevient le geste demandé — une ligne = une expérience, ses conditions
   comprises, son id d'origine compris. */
eq(APP.split('rows={loadRowChoices}').length - 1, 2,
  'les DEUX fenêtres (base d’administration ET dataset scientifique) reçoivent les lignes — une seule source, jamais deux listes');
eq(APP.split('onToggleRow={toggleLoadRow}').length - 1, 2,
  '…et les deux branchent la même case à cocher (aucune ligne inerte)');
eq(APP.split('onPickRows={pickLoadRows}').length - 1, 2,
  '…et le même « all / none » de page (les DEUX niveaux remis à leur défaut)');
has(APP, "confirmLoad('append', undefined, loadRows)",
  '« ➕ Add the selected elements » applique la sélection ligne à ligne (sans ce 3e argument elle était jetée)');
has(APP, "confirmLoad('replace', undefined, loadRows)",
  '« 🔄 Replace the selected elements » aussi — les deux gestes voient la MÊME sélection');
has(APP, "confirmLoad('replace', defaultSelection(loadSections), null)",
  '« 🔄 Import everything » reste le seul geste SANS sélection par ligne (tout le contenu du fichier)');
lacks(APP, "confirmLoad('append')",
  'plus aucun geste n’oublie la sélection : c’est le bug « non é chirurgico »');
lacks(APP, "confirmLoad('replace')",
  '…ni le remplacement (les deux boutons de la fenêtre portent les lignes)');

/* La chaîne complète, en PUR : les lignes de la fenêtre → la clé cochée → les
   essais qui partent. C'est la relecture du geste, de bout en bout, sans
   navigateur. */
const missing = L.experimentRowChoices([C1, C2, C3], [C3], false).find((r) => !r.inBase);
eq(missing && missing.key, 'name:Aphids',
  'la ligne de l’expérience perdue est celle que rien ne marque « already in the base »');
eq(L.pickExperimentRows([C1, C2, C3], [missing.key]).map((t) => [t.id, t.name]),
  [['t1', 'Aphids'], ['t2', 'Aphids']],
  'cette ligne part ENTIÈRE (ses deux conditions) et avec ses IDS D’ORIGINE — lien de projet et dossier Drive retrouvés');
eq(L.pickExperimentRows([C1, C2, C3], L.experimentRowChoices([C1, C2, C3], [C3], false)
  .filter((r) => r.picked).map((r) => r.key)).map((t) => t.id), ['t1', 't2', 't3'],
  'le DÉFAUT de la fenêtre (TOUT coché) laisse les deux boutons faire exactement ce qu’ils faisaient : rien de perdu');
eq(L.pickExperimentRows([C1, C2, C3], L.experimentRowChoices([C1, C2, C3], [C3], false)
  .filter((r) => r.picked && !r.inBase).map((r) => r.key)).map((t) => t.id), ['t1', 't2'],
  '…et ne cocher que ce qui MANQUE (ce que dit la ligne « already in the base ») ne ramène que ça');

/* ── Bilan ─────────────────────────────────────────────────────────────── */
console.log(`_experiment_vanishing_test.mjs — ${passed} assertions OK (le esperienze non spariscono più: lettura in aggiunta, scrittura sotto verrou, e il ritorno di UNA esperienza da una copia è CHIRURGICO — una riga per esperienza, con il suo id)`);

