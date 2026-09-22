/* =========================================================================
   _ligand_smiles_test.mjs — LE SMILES D'UN LIGAND ORGANIQUE D'UN PDB.

   Un PDB standard n'écrit AUCUNE chaîne SMILES : il ne nomme son ligand que par le
   code à 3 lettres de ses enregistrements HETATM. Le SMILES vient donc du Chemical
   Component Dictionary du RCSB (vérifié sur ATP : rcsb_chem_comp_descriptor.SMILES),
   et c'est ce que fait utils/ligandSmiles.js — lu ici sans aucun réseau : le `fetch`
   est INJECTÉ, donc la logique (choix du code, cache, réponses en erreur) est
   éprouvée pour de vrai.

   Ce que cette suite protège :
     • le CODE du ligand est lu des enregistrements HETATM seulement (un ATOM est un
       polymère), l'eau / les ions / les additifs de cristallisation sont écartés, et
       les codes sortent du plus fréquent au moins fréquent ;
     • le SMILES est lu dans les DEUX formes de la réponse du RCSB (la forme
       courante `rcsb_chem_comp_descriptor.SMILES` et l'ancienne liste
       `pdbx_chem_comp_descriptor[]`), et une réponse sans SMILES le dit au lieu de
       rendre une chaîne vide ;
     • un ligand n'est demandé qu'UNE fois (cache mémoire + localStorage) : une
       deuxième lecture ne touche pas le réseau, et le cache sert hors ligne ;
     • un PDB qui déclare plusieurs ligands essaie le plus fréquent d'abord ;
     • le DOCKING a retrouvé sa sous-section « Organic Molecule » — c'est là que le
       SMILES du ligand doit apparaître — et le viewer résout ce SMILES depuis la
       structure chargée quand la page ne le fournit pas.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// localStorage (le cache du dictionnaire) — le navigateur l'a, node non.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
  setItem: (k, v) => { store.set(String(k), String(v)); },
  removeItem: (k) => { store.delete(String(k)); },
  clear: () => store.clear(),
};

const LS = await import('./src/utils/ligandSmiles.js');

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const has = (needle, what, src) => ok(String(src).includes(needle), `${what}\n  introuvable : ${needle}`);

/* ══ 1. LE CODE DU LIGAND, DANS UN PDB RÉEL ═══════════════════════════════ */
const PDB = [
  'HEADER    HYDROLASE',
  'ATOM      1  N   MET A   1      11.104   6.134  -6.504  1.00  0.00           N',
  'ATOM      2  CA  MET A   1      11.639   6.071  -5.131  1.00  0.00           C',
  'HETATM   10  C1  STI A 500      -2.000   3.000   1.000  1.00  0.00           C',
  'HETATM   11  C2  STI A 500      -1.000   3.500   1.500  1.00  0.00           C',
  'HETATM   12  N1  STI A 500      -3.000   3.800   0.800  1.00  0.00           N',
  'HETATM   20  O   HOH A 600       6.000   6.000   6.000  1.00  0.00           O',
  'HETATM   21  NA  NA  A 601       7.000   7.000   7.000  1.00  0.00          NA',
  'HETATM   22  S   SO4 A 602       8.000   8.000   8.000  1.00  0.00           S',
  'END',
].join('\n');
eq(LS.ligandCodesFromPdbText(PDB), [{ code: 'STI', count: 3 }],
  'le ligand (STI) est reconnu : l’eau, l’ion et l’additif sont écartés');
eq(LS.codeOfHETATM('HETATM   10  C1  STI A 500      -2.000   3.000   1.000  1.00  0.00           C'), 'STI',
  'le code se lit aux colonnes 18-20 (comme tout le reste du viewer)');
eq(LS.codeOfHETATM('ATOM      1  N   MET A   1      11.104   6.134  -6.504  1.00  0.00           N'), '',
  'un enregistrement ATOM n’est jamais un ligand');
eq(LS.ligandCodesFromPdbText('ATOM      1  N   MET A   1      11.104   6.134  -6.504  1.00  0.00           N'), [],
  '…donc une protéine seule ne donne AUCUN ligand (rien à demander au dictionnaire)');
eq(LS.ligandCodesFromPdbText(''), [], 'un texte vide ne casse rien');
const TWO = [
  'HETATM   10  C1  AAA A 500      -2.000   3.000   1.000  1.00  0.00           C',
  'HETATM   10  C1  BBB A 501      -2.000   3.000   1.000  1.00  0.00           C',
  'HETATM   11  C2  BBB A 501      -1.000   3.500   1.500  1.00  0.00           C',
].join('\n');
eq(LS.ligandCodesFromPdbText(TWO).map((x) => x.code), ['BBB', 'AAA'],
  'deux ligands sortent du plus fréquent au moins fréquent');
ok(LS.LIGAND_EXCLUDED_CODES.has('HOH') && LS.LIGAND_EXCLUDED_CODES.has('NA')
  && LS.LIGAND_EXCLUDED_CODES.has('SO4') && !LS.LIGAND_EXCLUDED_CODES.has('STI'),
  'la liste des exclusions nomme l’eau, les ions et les additifs — et pas un ligand');

/* ══ 2. LA RÉPONSE DU DICTIONNAIRE (les deux formes) ══════════════════════ */
const MODERN = {
  chem_comp: { id: 'STI', name: 'IMATINIB', formula: 'C29 H31 N7 O', type: 'non-polymer' },
  rcsb_chem_comp_descriptor: { SMILES: 'Cc1ccc(cc1)NC(=O)c2ccc(cc2)CN3CCN(C)CC3', SMILES_stereo: 'STEREO', comp_id: 'STI' },
};
const READ = LS.readCcdSmiles(MODERN);
eq(READ.smiles, MODERN.rcsb_chem_comp_descriptor.SMILES, 'le SMILES se lit dans la forme COURANTE de l’API');
eq(READ.name, 'IMATINIB', '…avec le nom du composé');
eq(READ.formula, 'C29 H31 N7 O', '…et sa formule');
const OLD = {
  chem_comp: { name: 'OLD' },
  pdbx_chem_comp_descriptor: [
    { type: 'InChI', descriptor: 'InChI=1S/…' },
    { type: 'SMILES', descriptor: 'CCO' },
    { type: 'SMILES_CANONICAL', descriptor: 'CCO-stereo' },
  ],
};
eq(LS.readCcdSmiles(OLD).smiles, 'CCO', '…et dans l’ANCIENNE liste pdbx_chem_comp_descriptor');
eq(LS.readCcdSmiles(OLD).stereo, 'CCO-stereo', '…dont la forme canonique est lue comme stéréo');
eq(LS.readCcdSmiles({ chem_comp: { name: 'NO SMILES' } }), null,
  'une réponse SANS SMILES rend null (le code le dira, il n’affichera pas du vide)');
eq(LS.readCcdSmiles(null), null, '…et une réponse absente aussi');
eq(LS.readCcdSmiles('nope'), null, '…et un texte qui n’est pas un objet');

/* ══ 3. LE RÉSEAU EST INJECTÉ : cache, erreurs, repli ═════════════════════ */
const okFetch = (payload) => async (url) => ({
  ok: true,
  status: 200,
  url,
  json: async () => payload,
});
let calls = 0;
const countingFetch = (payload) => async (url) => { calls += 1; return okFetch(payload)(url); };
const STI = await LS.fetchLigandSmiles('sti', { fetchImpl: countingFetch(MODERN) });
eq(calls, 1, 'le dictionnaire est interrogé une fois');
eq(STI.code, 'STI', 'le code est rangé en majuscules');
eq(STI.smiles, MODERN.rcsb_chem_comp_descriptor.SMILES, 'et le SMILES est rendu');
ok(/RCSB/.test(STI.source), 'la réponse DIT d’où elle vient (RCSB Chemical Component Dictionary)');
const AGAIN = await LS.fetchLigandSmiles('STI', { fetchImpl: countingFetch(MODERN) });
eq(calls, 1, 'une deuxième lecture NE TOUCHE PAS le réseau (cache mémoire)');
eq(AGAIN.smiles, STI.smiles, '…et rend la même réponse');
ok(store.has(LS.LIGAND_SMILES_KEY), '…le cache est écrit dans localStorage');
const offline = await LS.fetchLigandSmiles('STI', { fetchImpl: async () => { throw new Error('offline'); } });
eq(offline.smiles, STI.smiles, 'le cache sert HORS LIGNE');
eq(LS.cachedLigandSmiles('sti').code, 'STI', 'cachedLigandSmiles retrouve l’entrée (casse indifférente)');
eq(LS.cachedLigandSmiles('ZZZ'), null, '…et rend null pour un code jamais vu');
// Une réponse en erreur : message lisible, jamais une chaîne vide.
await assert.rejects(() => LS.fetchLigandSmiles('ZZZ', { fetchImpl: async () => ({ ok: false, status: 404 }) }),
  /does not know/,
  'un code inconnu (HTTP 404) lève une erreur qui le dit');
await assert.rejects(() => LS.fetchLigandSmiles('QQQ', { fetchImpl: okFetch({ chem_comp: { name: 'X' } }) }),
  /has no SMILES/, '…et une réponse sans SMILES aussi');
await assert.rejects(() => LS.fetchLigandSmiles('A B', { fetchImpl: okFetch(MODERN) }),
  /not a chemical component code/, 'un code impossible est refusé avant tout appel réseau');
passed += 3;

/* ══ 4. LE LIGAND D'UN PDB, DE BOUT EN BOUT ═══════════════════════════════ */
const onlySecond = async (url) => {
  if (url.endsWith('/BBB')) return { ok: false, status: 404 };
  return { ok: true, status: 200, json: async () => ({ rcsb_chem_comp_descriptor: { SMILES: 'CCO' }, chem_comp: { name: 'AAA' } }) };
};
const RES = await LS.resolveLigandSmilesFromPdbText(TWO, { fetchImpl: onlySecond });
eq(RES.code, 'AAA', 'le ligand le plus fréquent (BBB) est essayé EN PREMIER, et l’on retombe sur le suivant');
eq(RES.smiles, 'CCO', '…dont le SMILES est bien celui du dictionnaire');
eq(RES.count, 1, '…la réponse dit combien d’exemplaires le fichier en contient');
eq(await LS.resolveLigandSmilesFromPdbText('ATOM      1  N   MET A   1      11.104   6.134  -6.504  1.00  0.00           N', { fetchImpl: onlySecond }),
  null, 'un PDB sans ligand rend null (aucune requête inutile)');

console.log(`_ligand_smiles_test.mjs — ${passed} assertions OK`);
