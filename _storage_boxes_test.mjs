/* =========================================================================
   _storage_boxes_test.mjs — les RÈGLES des boîtes de stockage.

   Ce qui est vérifié ici est ce qui doit rester vrai :

     • plusieurs boîtes peuvent vivre dans le MÊME emplacement (empilement lu
       comme « 2/3 »), et un meuble se remplit emplacement VIDE par emplacement
       vide avant d'empiler ;
     • déplacer une boîte ne touche QUE cette boîte ;
     • supprimer un meuble ne supprime JAMAIS ses boîtes : elles reçoivent un
       autre meuble, une par emplacement d'abord, ou restent sans emplacement ;
     • les champs obligatoires d'une boîte (nom de l'échantillon, propriétaire,
       date) existent au niveau de la BOÎTE et de chaque PUITS rempli ;
     • une boîte 1 × 1 est un échantillon en vrac (un seul puits).

   Le VRAI module est importé : src/utils/storageBoxes.js (aucun faux Drive :
   cet utilitaire ne connaît ni React ni le Drive).
   ========================================================================= */
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Les modules de src/ s'importent SANS extension (Vite les complète, pas Node) :
// le même crochet que les autres suites du dépôt.
register('./_esm_test_hook.mjs', import.meta.url);

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\nobtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};

const BOXES = await import('./src/utils/storageBoxes.js');

/* ── Des boîtes d'essai ───────────────────────────────────────────────────── */
const well = (o) => JSON.stringify(o);
// Une boîte 9 × 9 complète : la boîte ET son puits rempli ont leurs 3 champs.
const makeBox = (id, storageId, storageIndex, extra = {}) => ({
  id, type: 'plate-9x9box', name: `Box ${id}`, boxOwner: 'Anna', date: '2026-01-15',
  storageId, storageIndex, boxRows: 9, boxCols: 9,
  grid: [[well({ compound: 'C1', sampleOwner: 'Anna', date: '2026-01-15' })]],
  ...extra
});
const freezer1 = { id: 'st1', name: 'Freezer 1', rows: 2, cols: 3 };
const freezer2 = { id: 'st2', name: 'Freezer 2', rows: 1, cols: 3 };

const experiments = [
  makeBox('b3', 'st1', 1),
  makeBox('b1', 'st1', 1),
  makeBox('b2', 'st1', 0),
  makeBox('b9', 'st1', null),
  makeBox('b5', 'st2', 0),
  { id: 't1', type: 'plate-96', storageId: 'st1', storageIndex: 0 }
];
const find = (id) => experiments.find((t) => t.id === id);

/* ── 1. Reconnaître une boîte et lire son emplacement ─────────────────────── */
ok(BOXES.isStorageBox({ type: 'plate-9x9box' }), 'une boîte de stockage est reconnue');
ok(!BOXES.isStorageBox({ type: 'plate-96' }), 'une plaque n’est pas une boîte');
ok(!BOXES.isStorageBox(null), 'rien n’est pas une boîte');

eq(BOXES.boxesOfStorage(experiments, 'st1').map((b) => b.id), ['b3', 'b1', 'b2', 'b9'],
  'les boîtes d’un meuble — et elles seules');
eq(BOXES.slotIndexOf({ storageIndex: 4 }), 4, 'un emplacement numérique');
eq(BOXES.slotIndexOf({ storageIndex: '4' }), 4, 'un emplacement écrit en texte');
eq(BOXES.slotIndexOf({ storageIndex: null }), null, 'une boîte sans emplacement');
eq(BOXES.slotIndexOf({}), null, 'un emplacement absent');

/* ── 2. Plusieurs boîtes dans le MÊME emplacement (empilement) ────────────── */
eq(BOXES.boxesInSlot(experiments, 'st1', 1).map((b) => b.id), ['b1', 'b3'],
  'un emplacement peut porter plusieurs boîtes, dans un ordre STABLE');
eq(BOXES.boxesInSlot(experiments, 'st1', 2).length, 0, 'un emplacement vide ne rend rien');
eq(BOXES.slotStackLabel(experiments, find('b3')), '2/2', 'la position dans la pile se lit « 2/2 »');
eq(BOXES.slotStackLabel(experiments, find('b1')), '1/2', 'et « 1/2 » pour la première');
eq(BOXES.slotStackLabel(experiments, find('b2')), '', 'seule dans son emplacement : rien à afficher');

eq(BOXES.storageSlotCount(freezer1), 6, 'le nombre d’emplacements d’un meuble');
eq(BOXES.storageSlotCount({ rows: 0, cols: 0 }), 1, 'un meuble a toujours au moins un emplacement');
eq(BOXES.storageOccupancy(freezer1, experiments), { slots: 6, boxes: 4, used: 2, free: 4 },
  'l’occupation compte les EMPLACEMENTS occupés, pas les boîtes');

/* ── 3. Où va la prochaine boîte ──────────────────────────────────────────── */
eq(BOXES.nextSlotIndex([], 'st1', 6), 0, 'dans un meuble vide : le premier emplacement');
eq(BOXES.nextSlotIndex(experiments, 'st1', 6), 2,
  'un emplacement encore VIDE (0 et 1 occupés) avant d’empiler');
eq(BOXES.nextSlotIndex(experiments, 'st1', 2), 0,
  'quand tout est plein, on repart du premier emplacement (empilement)');


/* ── 4. Déplacer une boîte ────────────────────────────────────────────────── */
const moved = BOXES.moveBoxToSlot(experiments, 'b9', 'st2', 1);
eq(moved.find((t) => t.id === 'b9').storageId, 'st2', 'la boîte déplacée change de meuble');
eq(moved.find((t) => t.id === 'b9').storageIndex, 1, '…et d’emplacement');
ok(moved[0] === experiments[0] && moved[2] === experiments[2], 'les autres tests ne sont pas touchés');
const stacked = BOXES.moveBoxToSlot(experiments, 'b9', 'st1', 1);
eq(BOXES.boxesInSlot(stacked, 'st1', 1).map((b) => b.id), ['b1', 'b3', 'b9'],
  'on peut poser une boîte LÀ OÙ il y en a déjà une (empilement)');

/* ── 5. Supprimer un meuble : les boîtes ne sont jamais perdues ───────────── */
const spread = BOXES.assignBoxesToStorage(
  [makeBox('s1', 'stA', 0), makeBox('s2', 'stA', 1), makeBox('s3', 'stA', 2), makeBox('s4', 'stA', 3)],
  'stA', 'stB', 4
);
eq(spread.map((b) => b.storageIndex), [0, 1, 2, 3], 'quatre boîtes, quatre emplacements : une chacune');
eq(spread.map((b) => b.storageId), ['stB', 'stB', 'stB', 'stB'], '…toutes dans le meuble cible');
const packed = BOXES.assignBoxesToStorage(
  [makeBox('p1', 'stA', 0), makeBox('p2', 'stA', 1), makeBox('p3', 'stA', 2), makeBox('p4', 'stA', 3)],
  'stA', 'stB', 2
);
eq(packed.map((b) => b.storageIndex), [0, 1, 0, 1],
  'deux emplacements, quatre boîtes : elles s’empilent (rien n’est perdu)');

const withOccupied = BOXES.assignBoxesToStorage(
  [makeBox('e1', 'stB', 0), makeBox('m1', 'stA', 0), makeBox('m2', 'stA', 1)],
  'stA', 'stB', 3
);
eq(withOccupied.map((b) => b.storageIndex), [0, 1, 2],
  'la première boîte libre évite l’emplacement déjà occupé');

const reassigned = BOXES.assignBoxesToStorage(experiments, 'st1', 'st2', 3);
eq(BOXES.boxesOfStorage(reassigned, 'st1').length, 0, 'après déplacement, plus rien dans le meuble supprimé');
eq(BOXES.boxesOfStorage(reassigned, 'st2').length, 5, 'les CINQ boîtes sont dans le meuble cible');
eq(BOXES.storageOccupancy(freezer2, reassigned), { slots: 3, boxes: 5, used: 3, free: 0 },
  'trois emplacements occupés pour cinq boîtes (deux empilements)');
eq(reassigned.filter((t) => t.type === 'plate-96')[0].storageId, 'st1',
  'une expérience qui traînait dans le meuble n’est pas déplacée');
eq(reassigned.find((t) => t.id === 'b9').boxOwner, 'Anna', 'une boîte déplacée garde ses données');

const loose = BOXES.unassignBoxesOfStorage(experiments, 'st1');
eq(loose.filter((b) => b.type === 'plate-9x9box' && b.storageId === 'st1').length, 0,
  '« sans emplacement » : plus aucun meuble');
eq(loose[0].storageId, '', 'le meuble est vidé');
eq(loose[0].storageIndex, null, 'et l’emplacement aussi');
eq(loose.length, experiments.length, 'aucune boîte n’est supprimée du jeu de données');
eq(BOXES.removeStorage([freezer1, freezer2], 'st1').map((s) => s.id), ['st2'],
  'le meuble supprimé quitte la liste des meubles');


/* ── 6. Les champs obligatoires d’une boîte ───────────────────────────────── */
eq(BOXES.requiredBoxIssues(makeBox('c1', 'st1', 0)), [], 'une boîte complète n’a rien à signaler');
eq(BOXES.boxIsComplete(makeBox('c1', 'st1', 0)), true, '…et se dit complète');

const noName = makeBox('c2', 'st1', 0, { name: '   ' });
eq(BOXES.boxMissingRequired(noName), ['name'], 'le nom de l’échantillon manque sur la boîte');
eq(BOXES.requiredBoxIssues(noName)[0].message, 'Sample name is required on the box', 'le message est lisible');
const noOwnerNoDate = makeBox('c3', 'st1', 0, { boxOwner: '', date: '' });
eq(BOXES.boxMissingRequired(noOwnerNoDate), ['boxOwner', 'date'], 'propriétaire et date manquent');
eq(BOXES.requiredBoxIssues(noOwnerNoDate).length, 2, 'deux champs signalés (le puits est complet)');

const badWell = makeBox('c4', 'st1', 0, {
  grid: [
    [well({ compound: 'C1', sampleOwner: '', date: '' }), well({ solvent: 'DMSO' })],
    ['']
  ]
});
const wellIssues = BOXES.requiredBoxIssues(badWell);
eq(wellIssues.map((i) => `${i.scope}:${i.field}@${i.pos}`),
  ['well:sampleOwner@A1', 'well:date@A1', 'well:compound@A2', 'well:sampleOwner@A2', 'well:date@A2'],
  'chaque puits REMPLI réclame son nom d’échantillon, son propriétaire et sa date');
eq(wellIssues.length, 5, 'et un puits vide (A3) n’est jamais signalé');
eq(BOXES.describeBoxIssues(wellIssues),
  '5 required fields missing: well A1 Owner, well A1 Date, well A2 Sample name +2',
  'la phrase de l’écran nomme les champs et les puits');
eq(BOXES.describeBoxIssues([]), '', 'sans problème, aucune phrase');
ok(BOXES.describeBoxIssues(wellIssues, 1).endsWith('+4'), 'le reste est compté (« +4 »)');

eq(BOXES.wellMissingRequired({ compound: 'C', sampleOwner: 'A', date: '2026-01-01' }), [],
  'un puits (objet déjà analysé) qui a ses trois champs passe la règle');
eq(BOXES.wellMissingRequired(null), ['compound', 'sampleOwner', 'date'], 'un puits vide est incomplet');

const completeness = BOXES.storageCompleteness(
  [makeBox('b1', 'st1', 0), makeBox('b2', 'st1', 1, { boxOwner: '' })],
  'st1'
);
eq(completeness.total, 2, 'le meuble sait combien de boîtes il contient');
eq(completeness.complete, 1, '…combien sont complètes');
eq(completeness.incomplete.map((r) => r.box.id), ['b2'], '…et lesquelles ne le sont pas (jamais masquées)');

/* ── 7. Les tailles de boîte : 9 × 9 et 1 × 1 (échantillon en vrac) ───────── */
eq(BOXES.BOX_SIZE_PRESETS.map((p) => p.id), ['box9', 'bulk1'], 'deux tailles proposées');
eq(BOXES.presetById('bulk1').rows, 1, 'la taille « 1 × 1 » fait un seul puits');
eq(BOXES.presetById('inconnu').id, 'box9', 'une taille inconnue retombe sur 9 × 9');

const bulk = makeBox('bulk', 'st1', 0, { boxRows: 1, boxCols: 1, grid: [[well({ compound: 'Bulk A' })]] });
eq(BOXES.presetIdOfBox(bulk), 'bulk1', 'une boîte 1 × 1 est reconnue comme échantillon en vrac');
eq(BOXES.boxSizeLabel(bulk), '1 × 1 (bulk sample)', 'et se lit « 1 × 1 (bulk sample) »');
eq(BOXES.boxSizeLabel(makeBox('b', 'st1', 0)), '9 × 9', 'une boîte 9 × 9 se lit « 9 × 9 »');
eq(BOXES.requiredBoxIssues(bulk).map((i) => i.scope), ['well', 'well'],
  'une boîte 1 × 1 ne réclame QUE ce qui manque à son unique puits');
eq(BOXES.requiredBoxIssues(bulk).map((i) => i.pos), ['A1', 'A1'], '…dont la position est A1');

/* ── 8. Le même jeu de données n’est jamais muté ──────────────────────────── */
const before = JSON.stringify(experiments);
BOXES.moveBoxToSlot(experiments, 'b9', 'st2', 1);
BOXES.assignBoxesToStorage(experiments, 'st1', 'st2', 3);
BOXES.unassignBoxesOfStorage(experiments, 'st1');
eq(JSON.stringify(experiments), before, 'ces fonctions rendent un NOUVEAU jeu de données, l’ancien reste intact');

console.log(`_storage_boxes_test.mjs : ${passed}/${passed} passed`);
