/* =========================================================================
   _load_merge_test.mjs — « 📂 Load backup » sur une base d’administration :
   REMPLACER ou FUSIONNER, et la fusion perd-elle quelque chose ?

   Question posée : « je charge une sauvegarde HTML PLUS ANCIENNE sur la page
   d’administration — est-ce que ça fusionne avec les entrées récentes, ou est-ce
   que ça les écrase ? » La réponse est maintenant un CHOIX de la fenêtre
   d’import, et les deux gestes ne se ressemblent pas :

     · ♻️ REPLACE — la page cochée est remplacée par celle du fichier
                    (le comportement historique : une ligne récente que le
                    fichier ignore disparaît) ;
     · 🔀 MERGE   — la BASE OUVERTE fait foi : le fichier n’AJOUTE que ce
                    qu’elle n’a pas encore. Rien n’est jamais effacé.

   Ce que cette suite vérifie, et sur QUOI :

     1. le GESTE, exécuté pour de vrai — `mergeAdministration`,
        `mergeAdminValue` et `mergePreviewOf` (src/utils/loadSelection.js) sont
        importés par le crochet ESM des tests : union par clé d’identité, version
        de la base qui l’emporte, pages NON cochées recopiées, `settings` clé par
        clé, lignes sans identité jamais perdues, doublons ;
     2. l’APERÇU annoncé AVANT de cliquer (« +3 lignes » / « rien de neuf ») ;
     3. le BRANCHEMENT dans App.jsx : le mode, le bouton qui applique LE mode
        choisi, et le compte-rendu d’après coup qui dit que rien n’a été effacé ;
     4. la NON-RÉGRESSION du mode « remplacer » : `filterLoadState` écrase
        toujours (c’est le geste historique, il ne doit pas changer) ;
     5. la CAUSE des jumeaux : `librerie`, `devisBc` et `reimbursements`
        n’avaient aucune identité (toutes leurs lignes se ressemblaient, donc se
        ré-ajoutaient à chaque chargement) — on vérifie ici que recharger DEUX
        FOIS la même sauvegarde n’ajoute plus rien, et que deux règles de
        défense s’ajoutent (page absente de la base dédoublonnée, `id` déjà pris
        renommé) ;
     6. la SÉLECTION LIGNE À LIGNE (`rowChoicesOf` / `rowPicksOf` /
        `pickAdminRows`) : « la page Dépenses » n’est pas un choix, donc chaque
        ligne du fichier se coche seule — en fusion, une ligne DÉJÀ dans la base
        est VERROUILLÉE (reconnue, jamais dupliquée) et les lignes nouvelles
        arrivent cochées ;
     7. le NOM : charger dans la base OUVERTE ne la renomme jamais (défaut
        constaté : une fusion rebaptisait la base du titre du fichier, et le
        nom décidant du dossier Drive, tout le travail suivant partait ailleurs).

   Suite : `node _load_merge_test.mjs` (reprise par _run_all.cjs).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const L = await import('./src/utils/loadSelection.js');

const APP = readFileSync('./src/App.jsx', 'utf8');
const SEL = readFileSync('./src/utils/loadSelection.js', 'utf8');

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected,
    `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => ok(src.includes(needle), what);

/* ── 1. Le geste : la base OUVERTE fait foi ────────────────────────────────
      La base contient une ligne (r2, « Frais mission ») que la sauvegarde
      ancienne ne porte PAS : c’est exactement la ligne qu’un « remplacer »
      ferait disparaître, et que la fusion doit conserver. */
const BASE = {
  recettes: [
    { id: 'r1', ligne: 'Bourse', type: 'Salaire', montant: 100 },
    { id: 'r2', ligne: 'Frais mission', type: 'Fonctionnement', montant: 200 },
  ],
  personnel: [{ id: 'p1', nom: 'Alice', dateEmbauche: '2020-01-01' }],
  om: [{ id: 'om1', description: 'Congrès', demandeur: 'Alice', dateMission: '2026-05-01' }],
};
const FILE = {
  recettes: [
    { id: 'r1', ligne: 'Bourse', type: 'Salaire', montant: 100 },      // déjà là
    { id: 'r9', ligne: 'Prestation', type: 'Salaire', montant: 300 },  // NOUVELLE
  ],
  personnel: [{ id: 'p1', nom: 'Alice', dateEmbauche: '2020-01-01' }],
  conges: [{ demandeur: 'Bob', dateDebut: '2026-01-01', dateFin: '2026-01-05' }],
};

const m = L.mergeAdministration(BASE, FILE, ['recettes', 'personnel']);
eq(m.administration.recettes.map((r) => r.id), ['r1', 'r2', 'r9'],
  'SEULE la ligne absente est ajoutée : « Frais mission » (r2), saisie depuis la sauvegarde, reste en place');
eq(m.administration.personnel.length, 1, 'une fiche déjà présente ne se dédouble pas');
eq([m.added, m.kept], [1, 2], 'le compte-rendu sépare les lignes AJOUTÉES de celles déjà reconnues');
eq(m.administration.om, BASE.om, 'une page NON cochée est recopiée telle quelle');
eq(m.addedByKey, { recettes: 1, personnel: 0 }, '…et le détail par page dit OÙ la ligne est arrivée');

/* La version de la base l’emporte sur celle du fichier : c’est la ligne la plus
   récente (celle qu’on vient de corriger) qui survit au chargement. */
const m2 = L.mergeAdministration(
  { recettes: [{ id: 'r1', ligne: 'Bourse', type: 'Salaire', montant: 999, note: 'corrigée depuis' }] },
  { recettes: [{ id: 'r1', ligne: 'Bourse', type: 'Salaire', montant: 100 }] },
  ['recettes'],
);
eq(m2.administration.recettes[0].montant, 999, 'la version RÉCENTE (base) l’emporte : la fusion n’écrase pas');
eq(m2.administration.recettes[0].note, 'corrigée depuis', '…la correction récente survit à une sauvegarde ancienne');
eq([m2.added, m2.kept], [0, 1], 'rien à ajouter → le compte-rendu le dira (« nothing new »)');

/* Aucune base ouverte (base neuve) : la fusion se réduit à ce que le fichier
   porte — il n’y a rien à écraser. */
const fresh = L.mergeAdministration({}, FILE, ['recettes', 'personnel', 'conges']);
eq(fresh.administration.recettes.length, 2, 'sans base ouverte, la fusion = ce que le fichier porte');
eq(fresh.administration.settings, undefined, '…et elle n’INVENTE aucune page que le fichier ne porte pas');

/* ── 2. Les cas limites de la fusion d’UNE valeur ─────────────────────────── */

/* Ligne sans identité exploitable (aucun champ) : elle est AJOUTÉE. Choisir à sa
   place reviendrait à jeter une ligne que personne ne peut identifier. */
const idless = L.mergeAdminValue('recettes', [], [{ ligne: '', type: '' }, { ligne: '', type: '' }]);
eq(idless.value.length, 2, 'deux lignes sans identité sont gardées (ajoutées) — jamais choisies à leur place');
eq(idless.added, 2, '…et comptées comme ajoutées');

/* Deux fois la même ligne DANS le fichier : une seule entrée (même règle que
   l’assistant d’import : `recordDedupeKey`). */
const twice = L.mergeAdminValue('recettes', [], [
  { ligne: 'Bourse', type: 'Salaire' },
  { ligne: 'Bourse', type: 'Salaire' },
]);
eq(twice.value.length, 1, 'un doublon INTERNE au fichier n’entre qu’une fois');

/* `settings` est un objet : clé par clé, la base l’emporte, le fichier ne
   remplit que ce qui manque (jamais l’écrasement d’une option déjà réglée). */
const st = L.mergeAdminValue('settings',
  { currency: 'EUR', retention: '10 ans' },
  { currency: 'USD', theme: 'light' });
eq(st.value, { currency: 'EUR', retention: '10 ans', theme: 'light' },
  'settings : la base l’emporte clé par clé, le fichier ne remplit que les clés ABSENTES');
eq([st.added, st.kept], [1, 1], '…et le compte-rendu dit ce qui vient du fichier et ce qui était déjà là');

/* Valeur simple : la base l’emporte ; le fichier ne remplit qu’un VIDE. */
eq(L.mergeAdminValue('settings', 'A', 'B').value, 'A', 'une valeur simple : la base l’emporte');
eq(L.mergeAdminValue('settings', '', 'B').value, 'B', '…sauf quand la base n’a rien (le fichier remplit)');


/* ── 3. L’APERÇU de la fenêtre (« +3 lignes ») ──────────────────────────────
      Ce que chaque page cochée apporterait, AVANT de cliquer : c’est la phrase
      qui évite de croire qu’un import ne fait rien. */
const SECTIONS = [
  { id: 'admin:recettes', keys: ['recettes'], unit: 'ligne' },
  { id: 'admin:personnel', keys: ['personnel'], unit: 'ligne' },
  { id: 'admin:conges', keys: ['conges'], unit: 'ligne' },
  { id: 'admin:om', keys: ['om'], unit: 'ligne' },
];
const prev = L.mergePreviewOf(BASE, FILE, SECTIONS, ['admin:recettes', 'admin:personnel', 'admin:conges']);
eq(prev['admin:recettes'], { added: 1, kept: 1 }, 'l’aperçu annonce ce que la page apporterait');
eq(prev['admin:personnel'], { added: 0, kept: 1 }, '…et « rien de neuf » quand le fichier est plus ancien');
eq(prev['admin:conges'], { added: 1, kept: 0 }, 'une page absente de la base est annoncée comme entièrement nouvelle');
ok(!Object.prototype.hasOwnProperty.call(prev, 'admin:om'),
  'une page NON cochée n’est pas annoncée (elle ne bougera pas)');

/* La fusion ne rend JAMAIS une base amputée : toutes ses pages sont recopiées,
   y compris celles que le fichier ne connaît pas — le défaut réparé (une page
   absente du fichier devenait VIDE avec « importer tout »). */
const keepAll = L.mergeAdministration(BASE, FILE, ['recettes']);
eq(Object.keys(keepAll.administration).sort(), ['om', 'personnel', 'recettes'],
  'la fusion conserve les pages que le fichier ne porte pas');

/* ── 4. NON-RÉGRESSION du mode « remplacer » ────────────────────────────────
      Le geste historique ne change pas : la page cochée est CELLE DU FICHIER
      (donc sa ligne r2 disparaît), les pages non cochées ne bougent pas. */
const replaced = L.filterLoadState(
  { administration: FILE },
  [{ id: 'admin:recettes', keys: ['recettes'], count: 2 }],
  ['admin:recettes'],
);
eq(replaced.administration.recettes.length, 2,
  '« remplacer » garde son sens : la page cochée devient celle du fichier');
eq(replaced.administration.recettes.map((r) => r.id), ['r1', 'r9'],
  '…donc la ligne récente absente du fichier est emportée (c’est VOULU en mode remplacer)');
eq(replaced.administration.personnel, undefined, '…et les pages non cochées restent intactes');


/* ── 5. Le BRANCHEMENT : c’est bien le mode choisi qui est appliqué ───────── */
has(SEL, 'export const mergeAdministration', 'la fusion est exportée par loadSelection.js');
has(SEL, 'export const mergePreviewOf', '…avec l’aperçu qui alimente les cases à cocher');
has(SEL, "import { recordDedupeKey, normalizeKey } from '../administration/importUtils';",
  'l’identité d’une ligne est CELLE de l’assistant d’import (une seule règle de dédoublonnage)');
has(APP, 'mergeAdministration, mergePreviewOf,',
  'App.jsx importe les deux fonctions (rien n’est re-défini dans le composant)');
has(APP, "const [loadAdminMode, setLoadAdminMode] = useState('merge');",
  'la fenêtre d’import offre le choix, et son défaut est la fusion (le geste sans perte)');
has(APP, "onClick={() => setLoadMode('replace')}",
  '…le mode « remplacer » reste à un clic (le geste historique)');
has(APP, 'onClick={() => confirmLoad(loadAdminMode, undefined, loadRows)}',
  'le bouton principal applique LE MODE CHOISI, sur les LIGNES cochées (jamais un mode figé)');
has(APP, '🔀 Merge the selected pages (${loadPicked.length})',
  '…et son libellé dit lequel il appliquera');
has(APP, "preview={loadAdminMode === 'merge' ? loadMergePreview : null}",
  'les cases annoncent ce que la FUSION apporterait, page par page');
has(APP, 'describeMergePart(s, preview[s.id])', '…avec la phrase qui lit cet aperçu');
has(APP, "const merging = mode === 'merge';", 'confirmLoad distingue les deux gestes');
has(APP, "'🔀 Merge — nothing was erased'",
  'la fusion est RACONTÉE après coup (ce qui a été ajouté, ce qui a été gardé)');
has(APP, "setLoadAdminMode('merge');",
  'chaque fichier rouvert repart du mode sans perte (le choix ne survit pas d’un fichier à l’autre)');
has(APP, 'const merged = mergeAdministration(openBase, pickedAdmin, Object.keys(pickedAdmin));',
  '…et la fusion reçoit LA BASE OUVERTE comme copie qui fait foi');

/* L’ORDRE est la protection : la fusion est décidée AVANT que la base soit
   écrite. L’inverse la prendrait sur une base déjà remplacée. */
const adminStart = APP.indexOf('if (pendingLoad && pendingLoad.isAdmin) {');
const mergeAt = APP.indexOf('const merging = mode === \'merge\';', adminStart);
const writeAt = APP.indexOf('setAdminContent(admin);', adminStart);
ok(adminStart > 0 && mergeAt > adminStart && writeAt > mergeAt,
  'la fusion est décidée AVANT l’écriture de la base (l’ordre EST la protection)');

/* Sans base ouverte, il n’y a rien à fusionner : le fichier se pose sur la
   SEMENCE (collections vides + options par défaut) — la base neuve a toutes ses
   pages, jamais seulement celles du fichier. */
const noBaseAt = APP.indexOf('} else if (merging) {', adminStart);
const seedAt = APP.indexOf('admin = { ...base, ...pickedAdmin };', noBaseAt);
const replaceAt = APP.indexOf('} else {', noBaseAt);
ok(noBaseAt > 0 && seedAt > noBaseAt && seedAt < replaceAt,
  'sans base ouverte, la fusion pose le fichier sur la SEMENCE (une base neuve garde toutes ses pages)');

/* ── 6. L’IDENTITÉ des collections oubliées — la CAUSE des jumeaux ─────────
      `librerie`, `devisBc` et `reimbursements` n’avaient AUCUNE règle
      d’identité : toutes leurs lignes se ressemblaient (identité ''), donc
      chaque fusion les ré-ajoutait toutes — et `remove(kind, id)` les
      supprimait ensuite par paquets. Ces trois règles sont la première
      défense ; le renommage d’`id` (plus bas) est la seconde. */
const U = await import('./src/administration/importUtils.js');
const SUPPLIER = { id: 'f1', fournisseur: 'Papeterie Dupont', email: 'contact@dupont.fr' };
ok(U.recordDedupeKey('librerie', SUPPLIER).length > 0,
  'librerie a une identité (elle était VIDE : tous les fournisseurs se ressemblaient)');
eq(U.recordDedupeKey('librerie', SUPPLIER),
  U.recordDedupeKey('librerie', { fournisseur: 'Papeterie Dupont', email: 'autre@x.fr' }),
  '…le NOM du fournisseur (voir SUPPLIER_NAME_KEYS) : deux fiches de coordonnées font UN fournisseur');
ok(U.recordDedupeKey('librerie', SUPPLIER) !== U.recordDedupeKey('librerie', { fournisseur: 'Sigma' }),
  '…et deux fournisseurs différents restent deux lignes');
const DEV_A = { kind: 'devis', description: 'Fioles', numDevis: 'DV-12' };
const DEV_B = { kind: 'devis', description: 'Fioles', numDevis: 'DV-13' };
const BC_A = { kind: 'bc', description: 'Fioles', numBC: 'DV-12' };
ok(U.recordDedupeKey('devisBc', DEV_A) !== U.recordDedupeKey('devisBc', DEV_B),
  'devisBc : le NUMÉRO distingue deux devis de même description');
ok(U.recordDedupeKey('devisBc', DEV_A) !== U.recordDedupeKey('devisBc', BC_A),
  '…et le TYPE sépare un devis du BC qui décrit le même achat');
const REI = { description: 'Taxi congrès', demandeur: 'Alice', dateMission: '2026-05-01' };
eq(U.recordDedupeKey('reimbursements', REI),
  U.recordDedupeKey('reimbursements', { description: 'Taxi congrès', beneficiaire: 'Alice', dateMission: '2026-05-01' }),
  'reimbursements : le bénéficiaire peut s’écrire « demandeur » ou « beneficiaire » — même identité');

/* Le test qui compte : charger DEUX FOIS la même sauvegarde n’ajoute rien —
   c’est exactement ce que la base a vécu (des jumeaux par chargement). */
const LIB = { librerie: [SUPPLIER, { id: 'f2', fournisseur: 'Sigma-Aldrich' }] };
const libOnce = L.mergeAdministration({}, LIB, ['librerie']);
eq(libOnce.added, 2, 'le premier chargement apporte ses deux fournisseurs');
const libTwice = L.mergeAdministration(libOnce.administration, LIB, ['librerie']);
eq([libTwice.added, libTwice.kept], [0, 2], 'le MÊME fichier rechargé n’ajoute RIEN (plus de jumeaux)');
const devOnce = L.mergeAdministration({}, { devisBc: [DEV_A] }, ['devisBc']);
const devTwice = L.mergeAdministration(devOnce.administration, { devisBc: [DEV_A] }, ['devisBc']);
eq([devTwice.added, devTwice.kept], [0, 1], 'devisBc : recharger le même devis ne le double pas');
const reiOnce = L.mergeAdministration({}, { reimbursements: [REI] }, ['reimbursements']);
const reiTwice = L.mergeAdministration(reiOnce.administration, { reimbursements: [REI] }, ['reimbursements']);
eq([reiTwice.added, reiTwice.kept], [0, 1], 'reimbursements : recharger le même remboursement ne le double pas');

/* ── 7. Les deux autres protections : page absente de la base, id déjà pris ── */
const twinFile = L.mergeAdministration({}, {
  recettes: [{ id: 'r1', ligne: 'Bourse', type: 'Salaire' }, { id: 'r2', ligne: 'Bourse', type: 'Salaire' }],
}, ['recettes']);
eq([twinFile.added, twinFile.administration.recettes.length], [1, 1],
  'une page qui n’existe QUE dans le fichier est dédoublonnée à l’arrivée (mêmes règles des deux côtés)');
const clash = L.mergeAdminValue('recettes',
  [{ id: 'r1', ligne: 'Bourse', type: 'Salaire' }],
  [{ id: 'r1', ligne: 'Prestation', type: 'Salaire' }]);
eq(clash.value.map((r) => r.id), ['r1', 'r1~2'],
  'une ligne ajoutée qui portait un id DÉJÀ pris reçoit un identifiant libre (sinon remove() en emportait deux)');
eq([clash.added, clash.renamed], [1, 1], '…et le compte-rendu le sait');
const clashMerge = L.mergeAdministration(
  { recettes: [{ id: 'r1', ligne: 'Bourse', type: 'Salaire' }] },
  { recettes: [{ id: 'r1', ligne: 'Prestation', type: 'Salaire' }] },
  ['recettes'],
);
eq(clashMerge.renamed, 1, 'la fusion COMPTE les identifiants renouvelés (le compte-rendu peut le dire)');
has(APP, 'received a NEW identifier', '…et il le DIT : une ligne que l’utilisateur n’a pas touchée a changé d’id');

/* ── 8. LIGNE À LIGNE — choisir DANS une page ──────────────────────────────── */
const CHOICES = L.rowChoicesOf('recettes', FILE.recettes, BASE.recettes, 'merge');
eq(CHOICES.map((c) => c.picked), [false, true],
  'en fusion, une ligne DÉJÀ dans la base n’est pas un CHOIX (le fichier ne la ré-ajoute pas)');
eq(CHOICES.map((c) => c.inBase), [true, false], '…ce que la fenêtre écrit : « already in the base »');
eq(CHOICES.map((c) => c.locked), [true, false],
  '…elle est VERROUILLÉE (elle traverse la sélection : la fusion la compte, mais ne la duplique pas)');
eq(L.rowChoicesOf('recettes', FILE.recettes, BASE.recettes, 'replace').map((c) => c.picked), [true, true],
  'en remplacement, tout est coché et décochable (le geste demandé est de reprendre la page telle quelle)');
ok(L.rowChoicesOf('recettes', FILE.recettes, BASE.recettes, 'replace').every((c) => !c.locked),
  '…et RIEN n’y est verrouillé : chaque ligne reste une décision');
eq(CHOICES[1].title, 'Prestation', 'chaque ligne se NOMME par son champ le plus parlant');
ok(CHOICES[1].sub.includes('300'), '…et rappelle son contexte (montant, statut, date)');
ok(CHOICES[0].key.startsWith('recettes::'), 'la clé d’une ligne est préfixée par sa collection');
const idlessChoice = L.rowChoicesOf('recettes', [{ ligne: '', type: '' }], [], 'merge');
ok(idlessChoice[0].noIdentity && idlessChoice[0].picked && idlessChoice[0].key.endsWith('#0'),
  'une ligne sans aucun champ reste cochée, repérée par sa position (aucun jumeau possible)');
const dupChoice = L.rowChoicesOf('recettes', [{ ligne: 'A', type: 'B' }, { ligne: 'A', type: 'B' }], [], 'merge');
eq(dupChoice[1].duplicateOf, 0, 'un doublon INTERNE au fichier est dit (« same as line 1 ») avant de cliquer');

/* Le défaut de la fenêtre, puis l’application de ce choix. */
const PICKS = L.rowPicksOf(FILE, SECTIONS, BASE, 'merge');
eq(PICKS['admin:recettes'], [CHOICES[0].key, CHOICES[1].key],
  'le défaut = la ligne verrouillée + la ligne nouvelle que la base n’a pas encore, page par page');
eq(PICKS['admin:personnel'].length, 1,
  '…une page entièrement déjà en base ne propose RIEN à décider (sa ligne est là pour être reconnue)');
const only = L.pickAdminRows(FILE, SECTIONS, PICKS);
eq(only.recettes.map((r) => r.id), ['r1', 'r9'],
  'le fichier est RÉDUIT aux lignes cochées — la verrouillée voyage pour être RECONNUE, pas ajoutée');
eq(only.personnel.map((r) => r.id), ['p1'], '…et une page dont toutes les lignes passent reste entière');
eq(only.om, undefined, '…sans CRÉER une page que le fichier ne porte pas');
eq(L.pickAdminRows(FILE, SECTIONS, null).recettes.length, 2,
  'sans sélection par ligne, la page part entière (c’est « ♻️ Import everything »)');
const mergedRows = L.mergeAdministration(BASE, only, ['recettes', 'personnel', 'conges']);
eq([mergedRows.added, mergedRows.administration.recettes.map((r) => r.id)], [2, ['r1', 'r2', 'r9']],
  'la fusion des lignes cochées ajoute la seule nouvelle (+ la page Congés) et ne touche à rien d’autre');
eq(mergedRows.kept, 2,
  '…et elle compte les lignes reconnues (2) : le compte-rendu dira « nothing new » en le justifiant');

/* ── 9. Le BRANCHEMENT de la sélection ligne à ligne ──────────────────────── */
has(SEL, 'export const rowChoicesOf', 'loadSelection.js décrit les lignes d’une page (libellé, « déjà là »)');
has(SEL, 'export const pickAdminRows', '…et sait réduire un fichier à ces lignes');
has(APP, 'const RowPickList = ', 'App.jsx porte la liste dépliable des lignes');
has(APP, 'onPickRows={pickLoadRows}', '…ses « all / none » repassent par le défaut calculé');
has(APP, 'onPickRows, onToggleRow, preview, rows, rowPicked,', '…le panneau DÉCLARE ce handler dans sa signature (le maillon qui manquait)');
has(APP, 'onToggleRow={toggleLoadRow}', '…et chaque ligne cochée remonte au handler du composant (pas de case inerte)');
has(APP, 'rows={loadRowChoices}', '…et elle reçoit les lignes du FICHIER ouvert');
has(APP, 'rowPicked={loadRows}', '…avec les lignes cochées de l’utilisateur');
has(APP, 'const pickedAdmin = pickAdminRows(pruned.administration || {}, allSections, rowsPicked);',
  'confirmLoad applique la sélection par ligne AVANT la fusion comme avant le remplacement');
has(APP, "'replace', defaultSelection(loadSections), null)",
  '« ♻️ Import everything » passe explicitement `null` : tout le contenu, pas seulement les lignes cochées');
has(APP, "setLoadRows(rowPicksOf(s.administration, sections, baseAtOpen, 'merge'));",
  'chaque fichier ouvert part de son défaut (en fusion : ce que la base n’a pas)');

/* ── 10. LE NOM DE LA BASE OUVERTE EST INTANGIBLE ───────────────────────────
      Défaut constaté en production : charger une sauvegarde pour FUSIONNER
      rebaptisait la base en cours du titre que portait le fichier — et le nom
      décidant du dossier Drive, le travail continuait sous une autre identité. */
has(APP, 'const loadedTitle = restoringInPlace',
  'une sauvegarde chargée DANS la base ouverte ne la renomme pas (elle n’apporte que du contenu)');
has(APP, 'const renamedFileNote = (openTitle && fileTitle',
  '…et quand le fichier portait un AUTRE nom, c’est DIT (rien ne change en silence)');
has(APP, 'A load changes the CONTENT of the open base, never its identity',
  'la fenêtre d’import l’annonce AVANT de cliquer');
has(APP, "title: merging ? '🔀 Merge — nothing was erased' : '♻️ Replace — the open base kept its name'",
  'le compte-rendu d’après coup porte la même phrase');

/* ── Bilan ────────────────────────────────────────────────────────────────── */
console.log(`_load_merge_test.mjs — ${passed} assertions OK (📂 Load backup : 🔀 fusionner sans rien perdre ou ♻️ remplacer, au choix — en fusion, la base ouverte fait foi, ligne à ligne, et garde son nom)`);

