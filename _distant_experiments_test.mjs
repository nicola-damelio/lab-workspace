/* =========================================================================
   _distant_experiments_test.mjs — « LE ESPERIENZE DI UN ALTRO POSTO ».

   LE RAPPORT, mot pour mot : les expériences de Cintia (Test 84, 85, 86, 90,
   91) existent sur le Drive et dans le document partagé… puis disparaissent.
   Cause : la liste des expériences vit ENTIÈRE dans le payload, et CHAQUE
   enregistrement écrit la liste telle qu'elle est en mémoire. Le verrou local
   (`protectUnrecordedDrops`) ne peut rien faire contre une expérience qu'un
   AUTRE poste a créée pendant que celui-ci gardait une copie plus ancienne :
   ce poste ne l'a jamais vue, donc sa mémoire ne peut pas la reprendre — mais
   l'enregistrement l'efface quand même du document partagé.

   La réparation vérifiée ici, en PUR (src/utils/experimentTombstones.js) :
   `protectDistantDrops(distant, outgoing, deletions)` REMET ce que la copie
   PARTAGÉE porte et que nous n'avons pas, tant qu'aucune suppression n'est
   enregistrée pour lui (la 🗑 faite ailleurs reste une 🗑).
   Le CÂBLAGE suit (App.jsx) : c'est la relecture AVANT d'écrire qui fait tout
   le travail — une règle juste que personne n'appelle ne répare rien.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const T = await import('./src/utils/experimentTombstones.js');
const APP = readFileSync('./src/App.jsx', 'utf8').replace(/\r\n/g, '\n');

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
const A = { id: 't1', name: 'Aphids', datasetId: DS };
const B = { id: 't2', name: 'Bees', datasetId: DS };
const C = { id: 't3', name: 'Cintia Test 84', datasetId: DS };

/* ── 1. LE SCÉNARIO DU RAPPORT : la copie partagée en a une que nous n'avons pas ── */
const kept = T.protectDistantDrops([A, B, C], [A, B], []);
eq(ids(kept.tests), ['t1', 't2', 't3'],
  'l’expérience qui n’existe QUE dans la copie partagée est REMISE dans la liste écrite');
eq(ids(kept.rescued), ['t3'],
  '…et elle est nommée (l’écran peut le DIRE au lieu de l’avoir perdue)');
ok(T.describeDistantRescue(kept.rescued).includes('Cintia Test 84'),
  'le compte-rendu nomme l’expérience sauvée');
eq(ids(T.protectDistantDrops([A, B, C], [], []).tests), ['t1', 't2', 't3'],
  'une liste locale VIDE (poste neuf, cache vidé) ne peut plus vider le document partagé');
eq(Object.keys(kept).sort(), ['removed', 'rescued', 'tests'],
  'la forme rendue reste celle des autres verrous (tests / rescued / removed)');

/* ── 2. CE QUI N'EST PAS UNE PERTE ───────────────────────────────────────── */
eq(ids(T.protectDistantDrops([A, B], [A, B, C], []).tests), ['t1', 't2', 't3'],
  'une expérience que NOUS avons et que la copie partagée n’a pas reste écrite (ordre local gardé)');
eq(T.protectDistantDrops([A, B], [A, B, C], []).rescued.length, 0,
  '…et rien n’est « sauvé » : il n’y avait rien à sauver (aucun bruit)');
eq(T.protectDistantDrops([A, B], [A, B], []).tests.length, 2,
  'deux listes identiques ne changent rien');
eq(T.protectDistantDrops([], [A], []).tests.length, 1,
  'copie partagée vide : la liste écrite ne change pas');
eq(T.describeDistantRescue([]), '',
  'aucune expérience sauvée : aucun compte-rendu (jamais de dialogue inutile)');
eq(T.protectDistantDrops([A, A, B], [A], []).tests.length, 2,
  'aucun doublon n’entre par ce chemin non plus');

/* ── 3. LA 🗑 FAITE AILLEURS RESTE UNE 🗑 ─────────────────────────────────── */
eq(ids(T.protectDistantDrops([A, B, C], [A, B], [{ id: 't3', datasetId: DS, deletedAt: 5 }]).tests), ['t1', 't2'],
  'une suppression enregistrée pour C laisse C dehors, même si la copie partagée le porte encore');
eq(T.protectDistantDrops([A, B, C], [A, B], [{ id: 't3', datasetId: DS, deletedAt: 5 }]).removed, 0,
  '…et rien n’est « retiré » : C n’était déjà plus dans la liste écrite (aucun double comptage)');
eq(ids(T.protectDistantDrops([A, B], [A, B, C], [{ id: 't3', datasetId: DS, deletedAt: 5 }]).tests), ['t1', 't2'],
  'une expérience supprimée (record) sort de la copie écrite, même si la copie partagée ne la portait pas');
eq(T.protectDistantDrops([A, B], [A, B, C], [{ id: 't3', datasetId: DS, deletedAt: 5 }]).removed, 1,
  '…et là, le retrait est compté (l’écran peut le dire)');
eq(ids(T.protectDistantDrops([A, B, C], [A, B], [{ id: 't3', datasetId: 'ds2', deletedAt: 5 }]).rescued), ['t3'],
  'le record d’un AUTRE dataset ne peut pas faire disparaître cette expérience-ci');
eq(ids(T.protectDistantDrops([A, B, C], [A, B], ['t3']).tests), ['t1', 't2'],
  'un record écrit par une version ancienne (id seul) reste compris');

/* ── 4. LE CÂBLAGE : la relecture est AVANT l'écriture, aux DEUX portes ──── */
has(APP, 'protectDistantDrops, describeDistantRescue,',
  'App.jsx importe le verrou à distance (une règle non importée ne répare rien)');
has(APP, 'const out = protectDistantDrops(distant, list, deletions);',
  'la liste écrite est corrigée avec la copie PARTAGÉE');
has(APP, 'const guardDistantExperiments = async (list) => {',
  'un seul point d’entrée pour ce verrou');
has(APP, 'const readDistantExperiments = async (datasetId) => {',
  '…et une seule relecture, isolée du reste');
has(APP, 'LZString.decompressFromUTF16(data.payload)',
  'la copie relue est décompressée comme partout ailleurs (même format de payload)');
has(APP, "console.warn('[experiments] shared copy unreadable before writing",
  'une lecture impossible est DITE et ne bloque pas la sauvegarde (le verrou local reste le filet)');
eq((APP.match(/= await guardDistantExperiments\(rawData\.tests\);/g) || []).length, 2,
  'les DEUX points d’écriture du payload (enregistrement automatique ET retour à l’explorateur) passent par le verrou');
has(APP, 'voluntaryForgetRef.current = { datasetId: id, at: Date.now() };',
  'un geste qui a le droit d’écarter (♻️ Replace, undo/redo) désarme le verrou à distance');
has(APP, 'const DISTANT_GUARD_SILENCE_MS = 10000;',
  '…pour une durée explicite et courte (le temps que l’écriture passe)');
has(APP, 'if (forget.datasetId === datasetId && Date.now() - forget.at < DISTANT_GUARD_SILENCE_MS) return list;',
  'le silence ne concerne que le dataset concerné');
lacks(APP, 'await readDatasetCopy(datasetId)',
  'le verrou à distance ne lit PAS la copie du Drive (une copie en retard ferait plus de mal que de bien)');

/* ── Bilan ────────────────────────────────────────────────────────────────── */
console.log(`_distant_experiments_test.mjs — ${passed} assertions OK`);

