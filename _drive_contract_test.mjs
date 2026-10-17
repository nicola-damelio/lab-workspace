/* =========================================================================
   _drive_contract_test.mjs — TEST DE CONTRAT : LE DRIVE RÉEL ET LE FAUX
   RÉPONDENT-ILS PAREIL ?

   POURQUOI IL EXISTE (16/10/2026, demandé) : un faux qui répond « à peu près »
   ne prouve rien. Ici, la MÊME question est posée deux fois — une fois au Drive
   réel (relevé EN LECTURE SEULE par `tmp_dump_tree.mjs`, qui a écrit
   `_drive_real_tree.json` : l'arbre réel ET les identifiants rendus) et une
   fois au faux Drive, chargé avec le MÊME arbre, avec les MÊMES requêtes (celles
   que l'app émet vraiment : `q`, `pageSize`, `fields`, `nextPageToken`).
   Les listes d'identifiants doivent être ÉGALES, dans le MÊME ORDRE.

   Le relevé porte des NOMS RÉELS : il est IGNORÉ par git (`/_*.json`) et n'est
   jamais committé. Sans lui, ce test se DÉCLARE non exécutable (exit 0) — il ne
   prétend jamais avoir vérifié ce qu'il n'a pas vu.

   EXÉCUTER (avec le relevé) :
     node tmp_dump_tree.mjs --dataset="<nom exact>"     (écrit le relevé)
     node _drive_contract_test.mjs                      (rejoue : exit 0 ou 1)
   ========================================================================= */
import { existsSync, readFileSync } from 'node:fs';
import { createFakeDrive, FOLDER_MIME } from './_harness/fake-drive.mjs';

const FIXTURE = '_drive_real_tree.json';
if (!existsSync(FIXTURE)) {
  console.log('⏭ CONTRAT NON EXÉCUTÉ : le relevé du Drive réel est absent.');
  console.log(`   (${FIXTURE} porte des noms réels : il est ignoré par git et se refait avec)`);
  console.log('   node tmp_dump_tree.mjs --dataset="<nom exact du dataset>"');
  process.exit(0);
}
const real = JSON.parse(readFileSync(FIXTURE, 'utf8'));

/* ── LE FAUX DRIVE, CHARGÉ AVEC L'ARBRE RÉEL ──────────────────────────────────
   L'ordre du relevé EST l'ordre de l'API (createdTime croissant) : l'horloge
   virtuelle avance donc d'1 s entre deux nœuds, pour que le faux rende le même
   ordre sans `orderBy`. */
const drive = createFakeDrive({ seed: 12345 });
const token = drive.registerToken('tok_CONTRACT', 'PC');
const byId = new Map();
for (const n of real.nodes) {
  if (byId.has(n.id)) continue;
  const id = drive.mkFolder(n.name, n.parent, {
    id: n.id, mimeType: n.mimeType, text: ''
  });
  byId.set(id, n);
  drive.advance(1000);
}

const run = async (q, pageSize) => {
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', q);
  if (pageSize) url.searchParams.set('pageSize', String(pageSize));
  url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,createdTime)');
  const res = await drive.fetch(url.href, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`le faux refuse « ${q} » → HTTP ${res.status}`);
  const j = await res.json();
  /* PREMIÈRE PAGE SEULEMENT : le relevé réel n'a enregistré que la sienne. */
  return { ids: (j.files || []).map((f) => f.id), nextPageToken: j.nextPageToken || '' };
};

let fails = 0;
let same = 0;
let declared = 0;
console.log(`# CONTRAT RÉEL ↔ FAUX — dataset « ${real.dataset} » (relevé le ${real.readAt}, ${real.nodes.length} nœuds, ${real.reads} GET réels)`);
console.log(`   le faux a ${drive.nodes.size} nœud(s) — ${byId.size} du relevé ont pu être chargés`);
for (const { q, pageSize, ids } of real.queries) {
  /* LE RELEVÉ EST PARTIEL : quand la page réelle était PLEINE, l'API en avait
     d'autres — et notre faux ne connaît que les nœuds relevés. Ces requêtes-là
     sont DÉCLARÉES non comparables (jamais comptées comme réussies). */
  if (Number(pageSize) > 0 && ids.length === Number(pageSize)) {
    declared += 1;
    console.log(`   ⤍ non comparable (page réelle pleine : la liste réelle continue) — ${q}`);
    continue;
  }
  let got = [];
  let err = '';
  try { got = (await run(q, pageSize)).ids; } catch (e) { err = e.message; }
  const equal = !err && got.length === ids.length && got.every((x, i) => x === ids[i]);
  if (equal) same += 1;
  else {
    fails += 1;
    console.log(`   ✗ ${q}  (pageSize=${pageSize})`);
    if (err) console.log(`      le faux refuse : ${err}`);
    else {
      console.log(`      réel : ${ids.length} → ${ids.slice(0, 6).join(', ')}${ids.length > 6 ? ' …' : ''}`);
      console.log(`      faux : ${got.length} → ${got.slice(0, 6).join(', ')}${got.length > 6 ? ' …' : ''}`);
    }
  }
}
const comparable = real.queries.length - declared;
console.log(`\n═══ ESITO : ${fails === 0 ? `${same}/${comparable} REQUÊTES IDENTIQUES (ordre compris)` : `${fails} requête(s) DIVERGENTES sur ${comparable}`} · ${declared} déclarée(s) non comparable(s) ═══`);
if (fails) process.exit(1);
console.log('   le faux Drive rend, sur le même arbre, EXACTEMENT ce que le Drive réel a rendu.');
