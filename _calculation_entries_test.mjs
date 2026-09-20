/* =========================================================================
   _calculation_entries_test.mjs — « MES CALCULS N'ÉTAIENT PAS LÀ »

   Ce que le labo a vécu le 19/09/2026 : des calculs enregistrés dans la page
   Calculations sur un poste, et rien à l'écran sur un second poste.

   Les données, elles, voyageaient déjà : `calculationEntries` fait partie de
   la charge du dataset (App.jsx) et part donc sur Firestore ET dans
   `_workspace/datasets/ds_<id>.json`. Ce qui était cassé, c'était la LECTURE
   par l'écran — deux causes, deux verrous :

     1. la page ouvrait le calcul du PREMIER composé de la liste ; les calculs
        d'un autre composé existaient, mais l'écran disait « aucun calcul
        enregistré ». → un INVENTAIRE du dataset est toujours affiché, avec un
        composé cliquable par ligne (`calcInventory`) ;
     2. le filtre par scientifique (réservé aux superutilisateurs) comparait
        `operator` au nom du compte connecté : un calcul enregistré sans nom
        (`operator: 'unknown'`, session non identifiée) ou par un autre compte
        était MASQUÉ sans le dire. → une identité inconnue ne cache JAMAIS une
        donnée, les calculs sans nom restent visibles dans tous les filtres, et
        ce qui est masqué est COMPTÉ pour être annoncé (`selectCalcEntries`).

   Ce qui est vérifié : la logique pure du module RÉEL (src/utils/
   calculationEntries.js) et son câblage dans la page.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const C = await import('./src/utils/calculationEntries.js');
const MOD = readFileSync('./src/components/AppModules/calculationsModule.jsx', 'utf8');
const MISC = readFileSync('./src/components/AppModules/miscModules.jsx', 'utf8');
const APP = readFileSync('./src/App.jsx', 'utf8');

let passed = 0;
const eq = (actual, expected, what) => { assert.deepEqual(actual, expected, what); passed += 1; };
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => ok(src.includes(needle), what);

/* ── 1. Le dataset d'essai : deux composés, trois scientifiques, un sans nom ─ */
const entry = (id, operator, createdAt, extra = {}) => ({ id, operator, createdAt, tab: 'mg', data: {}, ...extra });
const ENTRIES = {
  Pepper: [
    entry('c1', 'Nicola', 1000),
    entry('c2', 'unknown', 2000),
    entry('c3', 'Sara', 3000)
  ],
  Salt: [
    entry('s1', '', 500),
    entry('s2', 'Nicola', 4000)
  ],
  Vide: []
};

/* ── 2. Qui a écrit quoi : inventaire, comptes, scientifiques ─────────────── */
eq(C.countCalcEntries(ENTRIES), 5, 'seuls les composés qui portent des calculs comptent');
const inv = C.calcInventory(ENTRIES);
eq(inv.map((r) => r.compound), ['Salt', 'Pepper'],
  'l’inventaire place le calcul le PLUS RÉCENT en tête (Salt, 4000)');
eq(inv[0].total, 2, '…et compte les calculs de ce composé');
eq(inv[0].scientists, ['Nicola'], '…avec les scientifiques qui les ont enregistrés');
eq(inv[0].unattributed, 1, '…et combien n’ont pas de nom (ils restent visibles)');
eq(inv[1].lastAt, 3000, 'la date du dernier calcul est retenue');
eq(C.calcInventory({ Zed: [entry('z', 'A', 10)], Ali: [entry('a', 'B', 10)] }).map((r) => r.compound),
  ['Ali', 'Zed'], 'à date égale, l’ordre des composés est stable (jamais aléatoire)');
eq(C.calcInventory({ Zero: [entry('z', 'A', 0)] }).map((r) => r.lastAt), [0],
  'un calcul sans date ne casse pas l’inventaire');

/* ── 3. « without a name » : attribuable à personne, donc visible partout ─── */
ok(C.isCalcUnattributed(entry('x', 'unknown', 1)), 'operator: "unknown" = calcul sans nom');
ok(C.isCalcUnattributed(entry('x', '', 1)), 'un operator vide = calcul sans nom');
ok(C.isCalcUnattributed({ id: 'x' }), 'un operator absent = calcul sans nom');
ok(!C.isCalcUnattributed(entry('x', 'Nicola', 1)), 'un vrai nom n’est pas « sans nom »');
eq(C.calcScientistsOf(ENTRIES.Pepper), ['Nicola', 'Sara'], 'les sans-nom ne polluent pas la liste des scientifiques');

/* ── 4. Le filtre : ce qui est visible, et ce qui est COMPTÉ ─────────────── */
const all = C.selectCalcEntries(ENTRIES.Pepper, { filter: 'ALL' });
eq(all.visible.map((e) => e.id), ['c3', 'c2', 'c1'], '« tous » montre tout, du plus récent au plus ancien');
eq([all.hiddenCount, all.total], [0, 3], '…et ne cache rien');

const mine = C.selectCalcEntries(ENTRIES.Pepper, { filter: 'MINE', myName: 'Nicola' });
eq(mine.visible.map((e) => e.id), ['c2', 'c1'], '« mes calculs » garde les miens ET ceux sans nom');
eq(mine.hidden.map((e) => e.id), ['c3'], '…le calcul d’un autre scientifique est masqué, mais CONNU');
eq(mine.hiddenCount, 1, '…et l’écran peut l’annoncer au lieu de dire « aucun calcul »');

const anonymous = C.selectCalcEntries(ENTRIES.Pepper, { filter: 'MINE', myName: '' });
eq(anonymous.visible.length, 3, 'SANS nom de compte, rien n’est caché (une identité inconnue ne cache jamais)');

const sara = C.selectCalcEntries(ENTRIES.Pepper, { filter: 'Sara', myName: 'Nicola' });
eq(sara.visible.map((e) => e.id), ['c3', 'c2'], 'un filtre nommé montre ce scientifique + les sans-nom');
eq(C.normalizeCalcFilter('sara'), 'sara', 'la casse des noms est conservée telle quelle');
eq(C.normalizeCalcFilter('mine'), 'MINE', 'les mots-clés sont reconnus quelle que soit la casse');
eq(C.normalizeCalcFilter(''), 'ALL', 'un filtre vide retombe sur « tous »');
eq(C.selectCalcEntries(ENTRIES.Pepper, { filter: 'UNKNOWN' }).visible.map((e) => e.id), ['c2'],
  'le filtre « sans nom » ne montre que ceux-là');
eq(C.selectCalcEntries(null, { filter: 'ALL' }).visible, [], 'un dataset sans calculs ne fait pas lever la page');
eq(C.selectCalcEntries([null, 7, 'x', entry('ok', 'Nicola', 1)], { filter: 'ALL' }).visible.map((e) => e.id),
  ['ok'], 'les entrées abîmées sont ignorées, jamais affichées ni comptées');

eq(C.defaultCalcFilter({ isSuperuser: true, myName: 'Nicola' }), 'ALL',
  'un superutilisateur ouvre sur « tous les scientifiques »');
eq(C.defaultCalcFilter({ isSuperuser: false, myName: 'Nicola' }), 'MINE',
  'un scientifique connecté ouvre sur ses calculs');
eq(C.defaultCalcFilter({ isSuperuser: false, myName: '' }), 'ALL',
  'un poste sans compte connecté ouvre sur TOUT (sinon les calculs sembleraient absents)');

eq(C.describeHiddenCalc(2, ['Sara']), '2 saved calculations hidden by this filter (Sara)',
  'l’écran sait dire ce qui est masqué, et par qui');
eq(C.describeHiddenCalc(0), '', 'aucun masqué : aucune phrase');
eq(C.describeHiddenCalc(1, ['A', 'B', 'C', 'D']), '1 saved calculation hidden by this filter (A, B, C…)',
  'la liste des scientifiques est bornée');

eq(C.lastCalcCompound(ENTRIES), 'Salt', 'la page peut ouvrir le composé du calcul le plus récent');
eq(C.lastCalcCompound({}), '', 'un dataset sans calcul n’a pas de composé à ouvrir');

/* ── 5. Le câblage dans la page (sinon la logique ne sert à rien) ────────── */
has(MOD, "from '../../utils/calculationEntries'", 'la page Calculations utilise le module partagé');
has(MOD, 'selectCalcEntries(allEntries, { filter: calcScientistFilter, myName })',
  '…pour décider ce qui est visible (et compter les masqués)');
has(MOD, 'calcInventory(calculationEntries)', '…et pour afficher l’INVENTAIRE du dataset');
has(MOD, 'Saved in this dataset', 'l’inventaire est À L’ÉCRAN, pas seulement dans l’état');
has(MOD, 'onClick={() => setSelectedCompound(row.compound)}',
  '…chaque composé de l’inventaire ouvre SES calculs, en un clic');
has(MOD, 'lastCalcCompound(calculationEntries)',
  'la page ouvre d’abord le composé du calcul le plus récent');
has(MOD, 'describeHiddenCalc(selection.hiddenCount)', 'ce qui est masqué est ANNONCÉ');
has(MOD, 'show all', '…et un clic permet de tout revoir');
has(MOD, 'My calculations ({myName})',
  'le filtre par scientifique est disponible pour tout le monde (plus seulement les superutilisateurs)');
has(MOD, 'Saved without a name', '…y compris le filtre « enregistré sans nom »');
ok(!MOD.includes('allEntries.filter((e) => !e.operator || e.operator === myName)'),
  'l’ancienne règle qui MASQUAIT sans le dire a disparu');
has(MOD, 'datasetDrivePath', 'la page dit OÙ le dataset est déposé sur le Drive');
has(APP, "datasetDrivePath={currentDatasetId ? workspaceDatasetPath(currentDatasetId) : ''}",
  'App.jsx lui passe le chemin réel (_workspace/datasets/ds_<id>.json)');
has(MISC, 'datasetDrivePath={datasetDrivePath}', '…transmis par le module Calculations');
has(APP, 'calculationEntries,', 'le contenu du dataset (donc les calculs) reste dans la charge sauvegardée');

console.log(`✅ ${passed} tests passés (les calculs d’un dataset se voient sur les deux postes)`);

