/* =========================================================================
   _backup_file_test.mjs — LA SAUVEGARDE : UN FORMAT QUI SE VALIDE.

   Le défaut réparé (voir src/utils/backupFile.js) : la sauvegarde était un HTML
   dont tout le contenu vivait dans un `<script id="saved-data-blob">`. Elle ne
   disait RIEN d'elle-même — ni sa version, ni ce qu'elle portait — donc une
   restauration ne pouvait pas VÉRIFIER ce qu'elle lisait : un fichier tronqué,
   édité à la main, ou écrit par une version plus récente s'importait comme un
   fichier valide, en silence.

   Ce qui est vérifié ici, sans navigateur :
     • l'ALLER-RETOUR : ce qui est écrit se relit, à l'identique, comptes
       compris ;
     • le fichier est AUTO-DESCRIPTIF : format, version, provenance (datasetId),
       titre, sous-titre, compression, comptes, charge ;
     • le RÉSUMÉ NOMME ce que la sauvegarde porte (les expériences, les projets,
       les composés…) et reste COURT — borné, sans doublon, une ligne par nom —
       sans jamais devenir un second contrôle ;
     • la VALIDATION refuse, et dit POURQUOI : fichier tronqué, charge illisible,
       version plus récente, format inconnu, JSON invalide, fichier vide ;
     • le fichier ÉDITÉ est attrapé par ses COMPTES (déclarés ≠ réels) — c'est le
       cœur de la « restauration validée » ;
     • l'ANCIEN HTML reste LISIBLE (les sauvegardes déjà sur les Drive), charge
       tronquée comprise — mais sans comptes déclarés, donc sans faux refus ;
     • le NOM et le DOSSIER des sauvegardes suivent une règle unique (deux
       datasets de même titre ne se recouvrent pas) ;
     • la PURETÉ : rien n'est lu ni écrit dehors, et aucune entrée ne fait lever.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const B = await import('./src/utils/backupFile.js');

const SRC = readFileSync('./src/utils/backupFile.js', 'utf8');

let passed = 0;
const eq = (actual, expected, what) => { assert.deepEqual(actual, expected, what); passed += 1; };
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => ok(src.includes(needle), what);

/* ── 1. LE FORMAT SE DÉCLARE ──────────────────────────────────────────────── */
eq(B.BACKUP_FORMAT, 'lab-workspace-backup', 'le fichier écrit annonce SON format');
eq(B.BACKUP_SCHEMA, 1, '…et sa VERSION');
eq(B.SUPPORTED_SCHEMAS, [1], 'les versions lisibles sont nommées, pas devinées');
eq(B.BACKUP_LEGACY_FORMAT, 'lab-workspace-backup-legacy-html', 'l’ancien HTML a son nom de format (relu, jamais écrit)');

/* ── 2. L'ALLER-RETOUR ──────────────────────────────────────────────────────
   Un état réel : des collections de tailles connues, une chaîne accentuée, et
   une valeur qui n'est pas un tableau. */
const STATE = {
  datasetTitle: 'Café & Crampon — essai',
  tests: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
  projects: [{ id: 'p1' }],
  datasetProtocols: [{ id: 'pr1' }, { id: 'pr2' }],
  storages: [],
  molecules: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }, { id: 'm4' }],
  calculationEntries: [{ id: 'c1' }],
  compoundMeta: { a: 1, b: 2 },
  nmrExperiments: [],
  note: 'une valeur simple compte pour 1'
};
const counts = B.backupCountsOf(STATE);
eq(counts.tests, 3, 'trois expériences comptées');
eq(counts.projects, 1, 'un projet');
eq(counts.datasetProtocols, 2, 'deux protocoles');
eq(counts.molecules, 4, 'quatre molécules');
eq(counts.storages, 0, 'aucun stockage : zéro, pas « absent »');
eq(counts.compoundMeta, 2, 'une carte compte ses clés (deux fiches composés)');

const doc = B.buildBackupDocument({
  payload: B.encodeBackupPayload(STATE), title: STATE.datasetTitle,
  subtitle: 'sous-titre', datasetId: 'dsCafe9', savedAt: 1_700_000_000_000
});
const written = B.backupDocumentText(doc);
const read = B.parseBackupText(written);
ok(read.ok, 'un fichier écrit se relit');
eq(read.kind, 'json', '…et il est reconnu comme le format d’aujourd’hui');
eq(read.state, STATE, 'l’état relu est celui écrit, à l’identique (accents compris)');
eq(read.counts, counts, 'les comptes relus sont ceux de l’état');
eq(read.declared, counts, '…et le fichier les DÉCLARE lui-même');
eq(read.problems, [], 'aucun problème signalé sur un fichier intact');
eq(read.reason, '', 'aucune phrase de refus non plus');

/* ── 3. LE FICHIER SE DÉCRIT LUI-MÊME ───────────────────────────────────────
   Ce qu'un humain doit voir en ouvrant le fichier : d'où il vient, pour quel
   dataset, quand, et ce qu'il porte. */
eq(Object.keys(doc).sort(), ['compressed', 'counts', 'datasetId', 'format', 'payload', 'savedAt', 'schema', 'subtitle', 'summary', 'title'].sort(),
  'le document porte exactement : format, schema, savedAt, provenance, titre, sous-titre, compression, comptes, RÉSUMÉ, charge');
eq(doc.datasetId, 'dsCafe9', 'd’OÙ VIENT la sauvegarde est écrit (la restauration en a besoin pour ne pas recréer un dataset)');
eq(doc.title, STATE.datasetTitle, 'le titre est écrit');
eq(doc.subtitle, 'sous-titre', 'le sous-titre aussi');
eq(doc.savedAt, 1_700_000_000_000, 'la date est écrite');
eq(doc.compressed, true, 'la compression est déclarée');
ok(doc.payload.length > 0 && doc.payload !== JSON.stringify(STATE), 'la charge est bien la charge COMPRESSÉE, pas le texte de l’état');
eq(typeof B.backupDocumentText(doc), 'string', 'le fichier est du TEXTE (JSON), pas une enveloppe HTML');
ok(B.backupDocumentText(doc).includes('\n  "format"'), '…et il est INDENTÉ : lisible à l’œil nu');
/* Les comptes sont calculés même quand l'appelant ne les donne pas : un fichier
   sans comptes ne pourrait pas être validé à la relecture. */
const inferred = B.buildBackupDocument({ payload: B.encodeBackupPayload({ tests: [{}, {}] }), title: 'X' });
eq(inferred.counts.tests, 2, 'sans comptes donnés, le document les DÉDUIT de la charge');

/* ── 3 bis. LE RÉSUMÉ : CE QU'UNE SAUVEGARDE PORTE, NOMMÉ ───────────────────
   L'en-tête ne disait que des NOMBRES (« 81 expériences ») : ouvrir le fichier
   ne montrait pas QUELLES expériences. Le résumé les nomme — et il est
   TOUJOURS tiré de la charge, donc il ne peut pas dire autre chose que ce que
   le fichier porte. */
eq(doc.summary.tests, ['t1', 't2', 't3'], 'les expériences sont NOMMÉES (l’identifiant quand il n’y a pas de nom)');
eq(doc.summary.projects, ['p1'], '…les projets aussi');
eq(doc.summary.datasetProtocols, ['pr1', 'pr2'], '…et les protocoles');
eq(doc.summary.molecules, ['m1', 'm2', 'm3', 'm4'], '…et les molécules');
eq(doc.summary.compoundMeta, ['a', 'b'], 'une CARTE est nommée par ses CLÉS (les fiches composés sont rangées par nom)');
eq(doc.summary.storages, undefined, 'une collection VIDE n’est pas nommée (comme un compte nul ne se dit pas)');
eq(Object.keys(doc.summary).pop(), 'note', 'la note ferme la liste : les noms se lisent d’abord');
ok(doc.summary.note.includes(String(B.BACKUP_SUMMARY_MAX)),
  'la note dit la seule limite de l’en-tête — le nombre de noms par collection');
eq(read.doc.summary, doc.summary, 'le résumé est DANS le fichier écrit (il se relit tel quel)');

/* LE VOCABULAIRE RÉEL DES COLLECTIONS — relevé sur la sauvegarde d'un vrai
   dataset : une expérience et un projet portent un `name`, un protocole un
   `title`, un meuble un `name`, et les calculs sont rangés PAR nom de composé. */
const REAL = {
  tests: [{ name: 'CD' }, { name: 'Fluo' }, { id: 't9' }],
  projects: [{ name: 'BG04_', scientist: 'Nicolas' }],
  datasetProtocols: [{ title: 'CD_spec_acquisition', text: 'Pas à pas' }, { name: 'Sans titre' }],
  storages: [{ name: 'Freezer -20', type: 'freezer', boxes: [{ name: 'Box 12' }] }],
  molecules: ['HeLa-lysat', { name: '1YCR' }, { id: 'm7' }],
  calculationEntries: { 'Peptide-01': [{ name: 'run 1' }], Cafeine: [] },
  compoundMeta: { 'Peptide-01': {}, Cafeine: {} },
  nmrExperiments: [{ name: 'hsqc' }, { name: 'hsqc' }]
};
const realSummary = B.backupSummaryOf(REAL);
eq(realSummary.tests, ['CD', 'Fluo', 't9'], 'un nom vient du champ `name` — l’identifiant ne sert que faute de nom');
eq(realSummary.projects, ['BG04_'], '…le projet par son nom');
eq(realSummary.datasetProtocols, ['CD_spec_acquisition', 'Sans titre'], 'un protocole se nomme par son `title`, un autre par son `name`');
eq(realSummary.storages, ['Freezer -20'], 'un meuble par son nom (les BOÎTES qu’il contient ne sont pas des noms du dataset)');
eq(realSummary.molecules, ['HeLa-lysat', '1YCR', 'm7'], 'une molécule écrite à la main est son propre nom');
eq(realSummary.calculationEntries, ['Peptide-01', 'Cafeine'], 'les calculs sont nommés par COMPOSÉ (c’est la clé de la carte)');
eq(realSummary.compoundMeta, ['Peptide-01', 'Cafeine'], '…comme les fiches composés');
eq(realSummary.nmrExperiments, ['hsqc'], 'un nom répété ne s’écrit qu’une fois (le COMPTE, lui, reste deux)');
eq(B.backupCountsOf(REAL).nmrExperiments, 2, '…et les comptes disent bien les deux');

/* LA LISTE EST BORNÉE : l'en-tête ne doit pas peser le poids de la charge. */
const MANY = { tests: Array.from({ length: B.BACKUP_SUMMARY_MAX + 9 }, (_, i) => ({ name: `exp-${i + 1}` })) };
eq(B.backupSummaryOf(MANY).tests.length, B.BACKUP_SUMMARY_MAX,
  `le résumé s’arrête à ${B.BACKUP_SUMMARY_MAX} noms (les comptes disent ce qui suit)`);
eq(B.backupCountsOf(MANY).tests, B.BACKUP_SUMMARY_MAX + 9, '…et le COMPTE, lui, reste complet');

/* UN NOM TIENT SUR UNE LIGNE — un titre d'expérience peut être un paragraphe. */
const MESSY = B.backupSummaryOf({
  tests: [
    { name: 'Ligne 1\nLigne 2\t  espacée' }, { name: '   ' }, { name: 'x'.repeat(400) },
    { name: { nested: true } }, 42, null
  ]
});
eq(MESSY.tests[0], 'Ligne 1 Ligne 2 espacée', 'les retours et les espaces multiples sont ramenés à une espace');
eq(MESSY.tests[1].length, B.BACKUP_SUMMARY_NAME_MAX + 1, 'un nom démesuré est coupé…');
ok(MESSY.tests[1].endsWith('…'), '…et le « … » le dit');
eq(MESSY.tests.slice(2), ['42'], 'un nom vide ou illisible est écarté (un identifiant numérique, lui, se dit)');
eq(B.backupSummaryOf(null), { note: B.BACKUP_SUMMARY_NOTE }, 'un état absent ne fait pas lever le résumé (et il n’a rien à nommer)');
eq(B.backupSummaryOf({ tests: 'pas une liste' }).tests, ['pas une liste'], 'une valeur simple est son propre nom');
eq(B.backupSummaryOf({ tests: [null, {}, ''] }).tests, undefined, 'rien de nommable : rien dans le résumé (jamais une liste vide)');

/* ⚠ LE RÉSUMÉ N'EST PAS UN SECOND CONTRÔLE : ce qui décide d'un import, ce sont
   les COMPTES ; le résumé est là pour l'œil de qui ouvre le fichier. Un résumé
   retouché à la main ne doit donc pas bloquer une sauvegarde intacte. */
const renamed = { ...doc, summary: { tests: ['autre chose'], note: 'retouché' } };
eq(B.validateBackupDocument(renamed).ok, true, 'un résumé retouché ne fait pas refuser une sauvegarde intacte');
ok(B.backupDocumentText(renamed).includes('autre chose'), '…et il reste tel quel dans le fichier (rien ne le recalcule à la lecture)');

/* ── 4. CE QUI EST REFUSÉ, ET POURQUOI ─────────────────────────────────────
   Chaque refus doit dire sa cause : « échec » tout court ne sert à personne. */
const bad = (d) => B.validateBackupDocument(d);
const verdict = (d) => B.backupVerdictText(bad(d));

const newer = bad({ ...doc, schema: 2 });
eq(newer.ok, false, 'un fichier écrit par une version PLUS RÉCENTE est refusé');
eq(newer.state, null, '…et sa charge n’est même pas décodée (on ne devine pas)');
ok(newer.problems[0].includes('NEWER version'), '…la phrase le dit : version plus récente, rien n’est importé');
eq(bad({ ...doc, format: 'autre-chose' }).ok, false, 'un JSON qui n’annonce pas ce format est refusé');
eq(bad({ ...doc, payload: '' }).ok, false, 'un document sans charge est refusé');
eq(bad(null).ok, false, 'un document absent est refusé (jamais une exception)');
eq(bad({ ...doc, payload: doc.payload.slice(0, 24) }).ok, false, 'une charge TRONQUÉE est refusée');
eq(bad({ ...doc, payload: 'pas-du-lz' }).ok, false, 'une charge illisible est refusée');

/* LE FICHIER ÉDITÉ : la charge est intacte, mais le fichier MENT sur ce qu'il
   porte. C'est exactement ce que l'ancien format ne pouvait pas voir. */
const edited = { ...doc, counts: { ...counts, tests: counts.tests + 9 } };
const editedVerdict = verdict(edited);
eq(bad(edited).ok, false, 'un fichier dont les comptes déclarés ne concordent pas est REFUSÉ');
eq(bad(edited).mismatched, [{ key: 'tests', declared: 12, actual: 3 }], '…le désaccord est nommé, chiffres en main');
ok(editedVerdict.includes('DECLARES 12 expérience'), '…et la phrase dit ce qu’il DÉCLARE');
ok(editedVerdict.includes('actually carries 3'), '…et ce qu’il PORTE réellement');
ok(editedVerdict.includes('Nothing was imported'), '…ainsi que le fait que RIEN n’a été importé');

/* Les refus du LECTEUR, qui est le seul point d'entrée de la restauration. */
const nothing = B.parseBackupText('bonjour, ceci n’est pas une sauvegarde');
eq(nothing.ok, false, 'un fichier quelconque est refusé');
ok(nothing.reason.includes('neither a backup document nor an older HTML backup'),
  '…et la phrase dit CE QU’ON ATTENDAIT (les deux formats sont nommés)');
eq(B.parseBackupText('').ok, false, 'un fichier vide est refusé');
eq(B.parseBackupText('{ "format": ').ok, false, 'du JSON invalide est refusé');
ok(B.parseBackupText('{ "format": ').reason.includes('not valid JSON'), '…en le disant (édité ou tronqué)');
eq(B.parseBackupText(null).ok, false, 'null est refusé sans lever');
eq(B.parseBackupText(undefined).ok, false, 'undefined non plus');
eq(B.parseBackupText(42).ok, false, 'un nombre non plus');

/* ── 5. L'ANCIEN HTML RESTE LISIBLE ────────────────────────────────────────
   Les sauvegardes déjà écrites sur les Drive ne doivent pas devenir des
   orphelines : le lecteur les relit comme avant — mais elles ne DÉCLARAIENT pas
   de comptes, donc il n'y a rien à leur comparer (un faux refus serait pire que
   pas de contrôle). */
const legacyHtml = (state, { datasetId = 'dsOld', title = 'Ancien dataset', compressed = true, payload = null } = {}) => {
  const blob = {
    payload: payload === null ? B.encodeBackupPayload(state, compressed) : payload,
    isCompressed: compressed, datasetId, title, subtitle: 'sous-titre ancien', savedAt: 1234
  };
  return '<!DOCTYPE html>\n<html><body><script type="application/json" id="saved-data-blob">'
    + JSON.stringify(blob).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    + '</script></body></html>';
};

const old = B.parseBackupText(legacyHtml(STATE));
ok(old.ok, 'une sauvegarde HTML déjà écrite se relit encore');
eq(old.kind, 'html', '…et elle est reconnue comme l’ANCIEN format');
eq(old.state, STATE, '…l’état est le même qu’avant (accents compris)');
eq(old.counts, counts, 'les comptes sont calculés à la lecture (l’HTML ne les portait pas)');
eq(old.declared, null, '…et rien n’est « déclaré » : il n’y a donc pas de concordance à exiger');
eq(old.doc.format, B.BACKUP_LEGACY_FORMAT, 'le document relu porte le nom de l’ancien format');
eq(old.doc.schema, B.BACKUP_LEGACY_SCHEMA, '…et sa version (0), pour que l’appelant sache d’où il vient');
eq(old.doc.datasetId, 'dsOld', 'la provenance de l’ancien fichier est conservée');
eq(old.doc.title, 'Ancien dataset', '…son titre aussi');
eq(old.doc.savedAt, 1234, '…et sa date');
eq(old.doc.compressed, true, 'la compression de l’ancien fichier est lue');
ok(typeof old.doc.payload === 'string' && old.doc.payload.length > 0,
  'la charge brute est rendue AUSSI (l’app en mesure la taille pour l’avertissement de limite)');

const oldTruncated = B.parseBackupText(legacyHtml(STATE, { payload: 'pas-du-lz' }));
eq(oldTruncated.ok, false, 'un ancien HTML tronqué est REFUSÉ (jamais importé à moitié)');
ok(oldTruncated.reason.includes('could not be decoded'), '…et la phrase le dit');
eq(B.parseBackupText(legacyHtml(STATE, { compressed: false })).state, STATE,
  'un ancien fichier NON compressé se relit aussi');
eq(B.parseBackupText('<html><body>rien</body></html>').ok, false,
  'un HTML sans bloc de sauvegarde est refusé');

/* L'état écrit SANS compression se relit : les deux chemins passent par le même
   verdict, donc une sauvegarde non compressée n'est pas un cas à part. */
const plain = B.buildBackupDocument({ payload: B.encodeBackupPayload(STATE, false), compressed: false, title: 'Plain' });
const plainRead = B.parseBackupText(B.backupDocumentText(plain));
ok(plainRead.ok, 'une sauvegarde non compressée est valide');
eq(plainRead.state, STATE, '…et son état se relit');
eq(plain.compressed, false, '…sa déclaration de compression est respectée');
eq(B.parseBackupText(plainRead.doc.payload).ok, false, 'et une charge brute n’est jamais prise pour un document');

/* ── 6. LE NOM ET LE DOSSIER : UNE SEULE RÈGLE ─────────────────────────────
   Deux datasets de même titre ne doivent JAMAIS se recouvrir sur le Drive, et
   les sauvegardes vivent dans le dossier canonique du dataset. */
const name1 = B.backupFileName({ title: 'Café & Crampon', datasetId: 'abcd1234ef', dateStr: '2026-10-08' });
const name2 = B.backupFileName({ title: 'Café & Crampon', datasetId: 'ZZZZ777777', dateStr: '2026-10-08' });
ok(name1.endsWith('.json'), 'le nom du fichier annonce son format (.json)');
ok(name1.includes('_backup_2026-10-08'), '…et porte la date de la sauvegarde');
ok(name1.includes('1234ef'), '…et un fragment d’identifiant (les six derniers caractères)');
ok(name1 !== name2, 'deux datasets de MÊME TITRE ne se recouvrent pas (le fragment tranche)');
ok(B.backupFileName({ title: 'X', datasetId: '', dateStr: '2026-10-08' }).includes('_ds_'),
  'sans identifiant, un fragment neutre est utilisé (jamais un nom vide)');
const NAMING = await import('./src/utils/driveNaming.js');
eq(B.backupFolderOf('Café & Crampon'), `${NAMING.datasetFolderSlug('Café & Crampon')}/backups`,
  'le dossier de sauvegarde est celui du dataset, sous « backups »');
eq(B.backupFolderOf('Café & Crampon').endsWith('/backups'), true, '…toujours sous « backups »');

/* ── 7. LA PHRASE DES COMPTES ────────────────────────────────────────────── */
eq(B.describeBackupCounts(counts), '3 expériences, 1 projet, 2 protocoles, 4 molécules',
  'les comptes se disent en clair, du plus attendu au moins attendu');
eq(B.describeBackupCounts({ tests: 1 }), '1 expérience', 'un seul élément se dit au SINGULIER');
eq(B.describeBackupCounts({ tests: 0, projects: 0 }), 'nothing to carry', 'rien à porter se dit comme tel');
eq(B.describeBackupCounts(null), 'nothing to carry', 'un compte absent ne fait pas lever la phrase');
eq(B.describeBackupCounts({ tests: 9, projects: 9, storages: 9, datasetProtocols: 9, molecules: 9 }),
  '9 expériences, 9 projets, 9 protocoles, 9 emplacements',
  'la phrase reste courte (les comptes suivants restent dans le fichier)');

/* ── 8. LA PURETÉ ──────────────────────────────────────────────────────────
   Un module de validation ne doit ni lire le Drive ni écrire quoi que ce soit :
   c'est ce qui le rend utilisable pour VALIDER avant d'agir. */
ok(!/driveUpload|uploadWorkspaceFile|fetch\(|localStorage|sessionStorage|document\./.test(SRC),
  'le module ne touche ni au Drive, ni au stockage, ni au document');
has(SRC, "from 'lz-string'", 'il ne dépend que de la compression (la même qu’avant)');
has(SRC, 'BACKUP_BLOB_RE', 'et de la SEULE définition du bloc de l’ancien HTML');
eq(B.buildBackupDocument().counts, B.backupCountsOf({}), 'sans argument, le document se construit avec des comptes à zéro');
eq(B.backupFileName().endsWith('.json'), true, 'sans argument, le nom reste un nom de fichier valide');
eq(B.describeBackupCounts(undefined), 'nothing to carry', 'et la phrase des comptes ne lève jamais');

/* ── 9. LE BRANCHEMENT RÉEL DANS L'APPLICATION ─────────────────────────────
   Un format qui se valide ne sert à rien si l'application continue d'écrire
   l'ancien et de lire sans valider : on vérifie donc les DEUX extrémités. */
const APP = readFileSync('./src/App.jsx', 'utf8');
const SIDEBAR = readFileSync('./src/components/AppModules/appSidebar.jsx', 'utf8');

ok(/import\s*\{[^}]*parseBackupText[^}]*\}\s*from '\.\/utils\/backupFile';/.test(APP),
  'App.jsx importe le module de sauvegarde (écriture ET lecture)');
/* ① LA LECTURE : un seul point d'entrée, et la raison du refus à l'écran. */
has(APP, 'const parsedBackup = parseBackupText(text);', 'l’import passe TOUT fichier par la validation');
has(APP, 'if (parsedBackup.ok) {', '…et ne continue que si le fichier est valide');
has(APP, 's = parsedBackup.state;', '…l’état adopté venant de la validation (jamais d’un JSON reparsé à la main)');
has(APP, 'message: parsedBackup.reason ||', '…un refus DIT sa raison (fini le bouton muet)');
ok(!/text\.match\(\s*\/<script/.test(APP), 'plus aucune extraction à la main du bloc de l’ancien format dans App.jsx');
has(APP, 'accept=".json,.html"', 'le sélecteur de fichier accepte le format d’aujourd’hui ET les anciens');
has(SIDEBAR, 'accept=".json,.html"', '…dans la barre latérale aussi');
/* ② L'ÉCRITURE : les DEUX gestes écrivent le document, en JSON. */
has(APP, 'buildBackupDocument({ payload, title, subtitle, datasetId: dset.id, savedAt: Date.now() })',
  'la sauvegarde hebdomadaire écrit un document auto-descriptif');
has(APP, 'mimeType: \'application/json\'', '…et le dépose en JSON (plus en HTML)');
has(APP, 'backupFolderOf(title)', '…dans le dossier canonique du dataset');
has(APP, '$' + '{describeBackupCounts(carried)}', '…et le compte-rendu DIT ce que la sauvegarde porte');
ok(!APP.includes('buildBackupHtml'), 'le constructeur HTML a disparu (plus rien n’écrit ce format)');
ok(!APP.includes('saved-data-blob'), 'plus aucune écriture de fichier HTML dans App.jsx');

console.log(`\n${passed} vérifications passées — LA SAUVEGARDE : un format qui se valide, un en-tête qui NOMME ce qu'il porte (et l'ancien HTML qui se relit encore).\n`);
