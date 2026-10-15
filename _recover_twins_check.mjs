/* =========================================================================
   _recover_twins_check.mjs — « LE ESPERIENZE RECUPERATE SPARISCONO DI NUOVO ».

   Vérifie, avec les VRAIS modules (src/utils/experimentTombstones.js,
   src/utils/loadSelection.js) et les VRAIS fichiers de reprise (_recover/*.json),
   pourquoi une expérience reprise revient puis repart EN SILENCE.

   FUITES VÉRIFIÉES (chacune s'imprime « FUITE CONFIRMÉE » si le code laisse faire) :
     ② la fenêtre d'import propose « à ajouter » une expérience dont l'ID est déjà là ;
     ③ l'ajout (➕) empile un jumeau (même id, autre nom) ;
     ④ la relecture (`mergeExperimentsAddOnly`) lâche la ligne reprise, `added` vide
        donc AUCUN dialogue — invisible à l'écran ;
     ⑤ l'enregistrement (`protectUnrecordedDrops`) publie la copie sans elle, muet ;
     ⑥ le 🗑 d'une des deux lignes de même id n'enregistre AUCUN record ;
     ⑦ les DEUX règles du modèle d'identité : un record se lit par ID (il suit donc
        un renommage) MAIS un renommage — même id, même nombre de lignes — ne
        s'enregistre JAMAIS comme une suppression (sinon le verrou retire du payload
        l'expérience renommée) ;
     ⑧ la levée (🛡) comparée à un `deletedAt` écrit par un poste dont l'horloge
        avance : la copie écrite repart sans les expériences reprises.

   Sortie : rapport (stdout + _diag_twins.txt) ; code de sortie 0 = aucune fuite
   (après réparation), 1 = au moins une fuite CONFIRMÉE (l'état d'aujourd'hui).
   ========================================================================= */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import LZString from 'lz-string';

register('./_esm_test_hook.mjs', import.meta.url);

/* Un localStorage de poche : le magasin des records est écrit pour de vrai. */
const fakeStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (fakeStore.has(k) ? fakeStore.get(k) : null),
  setItem: (k, v) => { fakeStore.set(k, String(v)); },
  removeItem: (k) => { fakeStore.delete(k); },
  clear: () => fakeStore.clear(),
};

const T = await import('./src/utils/experimentTombstones.js');
const L = await import('./src/utils/loadSelection.js');

const out = [];
const say = (line = '') => { out.push(line); console.log(line); };
const HOLES = [];
const leak = (label, detail, isLeak) => {
  if (isLeak) { HOLES.push(label); say(`  ✘ FUITE — ${label}`); } else say(`  ✔ protégé — ${label}`);
  if (detail) String(detail).split('\n').forEach((l) => say(`      ${l}`));
};

/* Le payload d'un fichier de reprise est COMPRESSÉ (LZString) : un `grep` sur le
   fichier ne voit ni id ni nom. */
const decompress = (doc) => {
  const raw = doc && doc.payload;
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || !raw) return null;
  const tries = [() => LZString.decompressFromUTF16(raw), () => LZString.decompress(raw), () => raw];
  for (const t of tries) {
    try {
      const s = t();
      if (typeof s !== 'string' || !s) continue;
      const p = JSON.parse(s);
      if (p && typeof p === 'object') return p;
    } catch { /* essai suivant */ }
  }
  return null;
};

const files = readdirSync('_recover').filter((f) => f.toLowerCase().endsWith('.json'));
const rescues = [];
files.forEach((f) => {
  let doc = null;
  try { doc = JSON.parse(readFileSync(`_recover/${f}`, 'utf8')); } catch { return; }
  const payload = decompress(doc);
  const list = payload && (payload.tests || payload.plates);
  if (!Array.isArray(list) || !list.length) return;
  const date = (f.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || String(doc.savedAt || '');
  rescues.push({
    file: f,
    date,
    items: list.filter(Boolean).map((t) => ({ id: String(t.id || ''), name: String(t.name || '') })),
  });
});
rescues.sort((a, b) => String(a.date).localeCompare(String(b.date)));

say('═══════════════════════════════════════════════════════════════════════════');
say('  EXPÉRIENCES REPRISES — pourquoi elles repartent (sur le vrai code)');
say('═══════════════════════════════════════════════════════════════════════════');
say('');
say(`① LES FICHIERS DE REPRISE — ${rescues.length} fichier(s) portant une liste d'expériences`);
const namesById = new Map();
rescues.forEach((r) => {
  const family = /experiences-retrouvees/i.test(r.file)
    ? 'reprise du Drive'
    : (/^RESTORE-/i.test(r.file) ? 'restauration ciblée' : 'autre');
  say(`  ${r.date}  ${r.file}  → ${r.items.length} expérience(s)  [${family}]`);
  r.items.forEach((t) => {
    if (!namesById.has(t.id)) namesById.set(t.id, new Set());
    namesById.get(t.id).add(t.name);
  });
});
const renames = Array.from(namesById.entries()).filter(([, n]) => n.size > 1);
say('');
say(`  ⚠ ${renames.length} id(s) porté(s) par PLUSIEURS noms à travers les fichiers de reprise`);
say('    (l\'objet du Drive garde l\'id de l\'expérience À TRAVERS SES RENOMMAGES) :');
renames.forEach(([id, n]) => say(`      id=${id} → ${[...n].join(' / ')}`));
/* LE SCÉNARIO, avec les données RÉELLES :
   `file`   = la REPRISE DU JOUR — le fichier d'expériences retrouvées le plus
              récent (« …experiences-retrouvees_<date>.json », l'export du Drive
              qu'on applique à la fenêtre d'import) ;
   `base`   = ce que le dataset porte DÉJÀ : TOUS les autres fichiers (les reprises
              déjà appliquées + les restaurations ciblées RESTORE-*), dédoublonné
              par NOM — c'est ainsi que l'écran identifie ses lignes. */
const rescueLike = rescues.filter((r) => /experiences-retrouvees/i.test(r.file));
const newest = (rescueLike.length ? rescueLike[rescueLike.length - 1] : rescues[rescues.length - 1]) || null;
const applied = rescues.filter((r) => r !== newest);
const byName = new Map();
applied.flatMap((r) => r.items).forEach((t) => {
  if (!byName.has(t.name)) byName.set(t.name, { ...t, datasetId: 'ds_sim' });
});
const base = Array.from(byName.values());
const file = (newest ? newest.items : []).map((t) => ({ ...t, datasetId: 'ds_sim' }));
say('');
say(`  reprises déjà appliquées : ${applied.map((r) => r.date).join(', ') || '—'} → ${base.length} nom(s) dans le dataset`);
say(`  reprise du jour : ${newest ? `${newest.date}  ${newest.file}` : '—'}`);
say(`      ${file.map((t) => `« ${t.name} »`).join(', ')}`);

say('');
say('② LA FENÊTRE D\'IMPORT — « déjà là » se dit par l\'ID (`experimentId`) OU par le nom');
const rows = L.experimentRowChoices(file, base, false);
const baseIds = new Set(base.map(T.experimentKey).filter(Boolean));
const offered = [];
rows.forEach((row) => {
  const item = file.find((t) => L.testGroupKey(t) === row.key) || null;
  const key = item ? T.experimentKey(item) : '';
  const alreadyById = !!key && baseIds.has(key);
  if (item) say(`  ligne « ${row.title} »  inBase=${row.inBase}  « à ajouter »=${!row.inBase}  id déjà dans le dataset=${alreadyById}`);
  if (item && !row.inBase && alreadyById) offered.push(item);
});
leak('la fenêtre propose « à ajouter » une expérience dont l\'ID est DÉJÀ dans le dataset',
  offered.length
    ? offered.map((t) => `« ${t.name} » (${T.experimentKey(t)}) : même id qu'une ligne déjà présente, sous un autre nom`)
      .join('\n')
    : 'aucune ligne de ce fichier dans ce cas',
  offered.length > 0);

say('');
say('③ L\'AJOUT (➕) — `experimentsToAdd` : une seule règle d\'identité (l\'ID d\'abord, le nom à défaut)');
/* Le VRAI geste de App.jsx : `const { tests, skipped } = experimentsToAdd(testsRef.current, loadedTests)`.
   La fenêtre d\'import et l\'ajout parlaient de la même expérience autrement : par
   son ancien nom ici, par son id là — l\'ajout empilait donc une SECONDE ligne
   portant le même id, le jumeau que la relecture suivante efface. Une seule
   règle désormais (`experimentsToAdd`), et elle se DIT (`describeSkippedAdditions`). */
const added = T.experimentsToAdd(base, file);
const newTests = added.tests;
const skipped = added.skipped;
const screen = base.concat(newTests);
const byId = new Map();
screen.forEach((t) => {
  const k = T.experimentKey(t);
  if (!k) return;
  if (!byId.has(k)) byId.set(k, []);
  byId.get(k).push(t.name);
});
const stacked = Array.from(byId.entries()).filter(([, names]) => names.length > 1);
const twinsAdded = stacked.filter(([id]) => newTests.some((t) => T.experimentKey(t) === id));
const twinsInBase = stacked.filter(([id]) => !twinsAdded.some(([kept]) => kept === id));
say(`  ${newTests.length}/${file.length} ligne(s) entrée(s) ; ${skipped.length} écartée(s)`
  + `${skipped.length ? ` (${skipped.filter((s) => s.by === 'id').length} par l\'ID, ${skipped.filter((s) => s.by === 'name').length} par le nom)` : ''}`);
say(`  le compte-rendu du geste : ${T.describeSkippedAdditions(skipped) || '(rien à écarter)'}`);
say(`  id(s) portant PLUSIEURS lignes après l\'ajout : ${stacked.length}`
  + `${twinsAdded.length ? ` — dont ${twinsAdded.length} EMPILÉ(S) par ce geste` : ' — aucun empilé par ce geste'}`
  + `${twinsInBase.length ? ` ; ${twinsInBase.length} déjà présents (dataset écrit par une version antérieure du programme : effondrés à la première écriture, voir ⑦)` : ''}`);
stacked.forEach(([id, names]) => say(`      ${id} → ${names.join(' + ')}`));
leak('l\'ajout empile une SECONDE ligne portant le même id d\'expérience',
  twinsAdded.map(([id, names]) => `${id} : ${names.join(' + ')}`).join('\n'),
  twinsAdded.length > 0);
/* LA MÉMOIRE DU POSTE — App.jsx 2009-2018 : une Map par dataset, clé = experimentKey
   (donc l'ID) : UNE SEULE entrée par id, la dernière vue gagne. */
const remember = (list) => {
  const map = new Map();
  list.forEach((t) => { const k = T.experimentKey(t); if (k) map.set(k, t); });
  return Array.from(map.values());
};

/* La copie PARTAGÉE, écrite par un poste qui n'a pas encore vu la reprise. */
const staleCopy = base.slice();
const rescuedNames = newTests.map((t) => t.name);

say('');
say('④ LA RELECTURE (🔄 Refresh, réouverture) — `mergeExperimentsAddOnly` (garde ID-keyée)');
/* La copie relue est adoptée PAR ID (experimentTombstones.js : `list.concat(added)`) : une
   ligne de la copie qui porte le MÊME id qu'une ligne reprise CHASSE celle-ci de l'écran.
   Et `added`, la seule chose que la relecture DIT, ne nomme que ce qu'elle a GARDÉ : la ligne
   qui part n'est donc nommée nulle part — ni par le dialogue, ni par l'écran. */
const mergedRead = T.mergeExperimentsAddOnly(remember(screen), staleCopy, []);
const lostOnRead = rescuedNames.filter((n) => !mergedRead.tests.some((t) => t.name === n));
const saidOnRead = mergedRead.added.length ? `« ${mergedRead.added.map((t) => t.name).join(' », « ')} »` : '';
say(`  lignes à l'écran : ${screen.length} avant la relecture → ${mergedRead.tests.length} après`);
say(`  ce que la relecture GARDE (added — la seule chose qu'elle DIT) : ${saidOnRead || '(rien)'}`);
say(`    → ${saidOnRead ? "le dialogue ne parle que de ces lignes-là, jamais de celles qui ont quitté l'écran" : 'added vide : aucun dialogue'}`);
say(`  expériences reprises ABSENTES de l'écran : ${lostOnRead.length ? lostOnRead.join(', ') : '—'}`);
leak('la relecture REMPLACE la ligne reprise par celle de MÊME ID portée par la copie (son nom d\'avant) : elle quitte l\'écran SANS ÊTRE NOMMÉE',
  lostOnRead.length
    ? `${lostOnRead.join(', ')} — la copie relue porte leur ID sous un autre nom : le verrou croit la ligne « déjà là »`
    : '',
  lostOnRead.length > 0);
/* Le cas le plus favorable : la mémoire ne porte QUE ce que la reprise vient d'ajouter
   (App.jsx, `rememberExperiments(targetId, newTests)`) — même là, l'id est déjà dans
   la copie relue : rien n'est gardé. */
const mergedFresh = T.mergeExperimentsAddOnly(remember(newTests), staleCopy, []);
const lostEvenFresh = rescuedNames.filter((n) => !mergedFresh.tests.some((t) => t.name === n));
leak('…et la mémoire la plus fraîche (celle de la reprise elle-même) ne les garde pas non plus',
  lostEvenFresh.join(', '),
  lostEvenFresh.length > 0);

say('');
say('⑤ L\'ENREGISTREMENT AUTOMATIQUE (1,5 s après la dernière frappe) — `protectUnrecordedDrops` (garde ID-keyée)');
/* App.jsx écrit l'ÉCRAN (`latestDataRef.current.tests`), pas une copie : la garde compare donc
   la MÉMOIRE du poste (clé = id) à la liste affichée. Deux moments comptent. */
const writtenBefore = T.protectUnrecordedDrops(remember(screen), screen, []);
say(`  ① avant toute relecture — l'écran porte encore les jumeaux :`);
say(`     rescued=${writtenBefore.rescued.length}  removed=${writtenBefore.removed}`
  + `  lignes écrites=${writtenBefore.tests.length}/${screen.length}`
  + `${stacked.length ? ` — la copie PART avec ${stacked.length} id(s) en DOUBLE` : ''}`);
const writtenAfter = T.protectUnrecordedDrops(remember(mergedRead.tests), mergedRead.tests, []);
const lostOnWrite = rescuedNames.filter((n) => !writtenAfter.tests.some((t) => t.name === n));
const saidOnWrite = writtenAfter.rescued.length ? `« ${writtenAfter.rescued.map((t) => t.name).join(' », « ')} »` : '';
say(`  ② après la relecture — l'écran EST la liste relue :`);
say(`     rescued=${writtenAfter.rescued.length}${saidOnWrite ? ` (à propos de ${saidOnWrite})` : ''}`
  + `  removed=${writtenAfter.removed} → `
  + `${(!writtenAfter.rescued.length && !writtenAfter.removed) ? 'le verrou rend la main SANS UN MOT' : 'il parle'}`);
say(`     expériences reprises ABSENTES de la copie écrite : ${lostOnWrite.length ? lostOnWrite.join(', ') : '—'}`);
leak('l\'enregistrement publie la liste d\'APRÈS relecture — donc SANS les lignes reprises — et n\'en dit rien',
  lostOnWrite.length
    ? `${lostOnWrite.join(', ')} — pour la garde l\'ID est dans la liste écrite (via l\'autre nom) : rien à reprendre, donc rien à dire`
    : '',
  lostOnWrite.length > 0 && !writtenAfter.rescued.length && !writtenAfter.removed);
say('');
say('⑥ LE GESTE 🗑 SUR L\'UNE DES DEUX LIGNES D\'UN MÊME ID');
/* L\'écran peut porter DEUX lignes du même id (écrites par une version antérieure
   du programme : la reprise ID-keyée + une ligne renommée). Le geste 🗑 en
   retire UNE : si rien n\'est enregistré, l\'id « survit » via le jumeau, la perte
   est INDISTINGUABLE d\'une disparition, et le verrou d\'écriture reprend
   l\'expérience supprimée. On éprouve les VRAIS jumeaux des fichiers quand il y
   en a, sinon les deux noms d\'un même id reconstitués. Toujours éprouvé : c\'est
   la règle qui doit tenir, que le dataset porte un jumeau hérité ou non. */
const twinEntry = stacked[0] || null;
const rowsOfId = twinEntry
  ? screen.filter((t) => T.experimentKey(t) === twinEntry[0])
  : [{ id: 't_twin', name: 'pdb_', datasetId: 'ds_sim' }, { id: 't_twin', name: 'Pd1', datasetId: 'ds_sim' }];
const rescuedRow = rowsOfId[rowsOfId.length - 1];
if (!twinEntry) say('  (aucun id empilé dans les fichiers disponibles : les deux noms d\'un même id, reconstitués)');
fakeStore.clear();
T.recordExperimentDeletions(rowsOfId, rowsOfId.slice(0, -1), 'ds_sim', 1000);
const records = T.loadExperimentDeletions();
say(`  lignes de ${T.experimentKey(rowsOfId[0])} : ${rowsOfId.map((t) => `« ${t.name} »`).join(' + ')} — 🗑 sur « ${rescuedRow.name} »`);
say(`  records enregistrés pour ce geste : ${records.length}`
  + `${records.length ? ` (« ${records.map((r) => r.name || '(sans nom)').join(' », « ')} »)` : ''}`);
leak('supprimer une ligne dont le jumeau porte le même ID n\'enregistre AUCUN record',
  records.length ? '' : 'l\'ID « survit » via le jumeau → la suppression est INDISTINGUABLE d\'une perte (le verrou la reprendra)',
  records.length === 0);

say('');
say('⑦ LE MODÈLE DE L\'IDENTITÉ : l\'ID PRIME — et un RENOMMAGE n\'est pas une suppression');
/* Deux règles qui se complètent : un record se lit par ID (il suit donc un
   renommage — une 🗑 faite ailleurs ne « ressort » pas sous le nouveau nom), et un
   geste qui laisse le MÊME NOMBRE de lignes pour cet id n\'a rien supprimé : c\'est
   un renommage, et l\'enregistrer retirerait du payload l\'expérience renommée. */
const idOnly = String(rescuedRow.id || '');
const renamedOnly = T.withoutDeletedExperiments(
  [{ id: idOnly, name: 'Nouveau nom', datasetId: 'ds_sim' }],
  records,
);
say(`  un record sur ${idOnly} vise aussi la ligne renommée « Nouveau nom » → ${renamedOnly.length} ligne(s) restante(s) (il en faut 0)`);
leak('le record ID-keyé doit suivre un renommage : l\'expérience supprimée ailleurs reste supprimée ici, même renommée',
  renamedOnly.length ? 'la ligne renommée survivrait au record qui la vise (un renommage « annulerait » une suppression)' : '',
  renamedOnly.length > 0);
fakeStore.clear();
const renamePair = [
  { id: 't_rename', name: 'pdb_', datasetId: 'ds_sim' },
  { id: 't_rename', name: 'Pd1', datasetId: 'ds_sim' },
];
T.recordExperimentDeletions([renamePair[0]], [{ ...renamePair[0], name: 'Pd1' }], 'ds_sim', 2000);
const renameRecords = T.loadExperimentDeletions();
say(`  un simple renommage (« pdb_ » → « Pd1 »), même id, même nombre de lignes → records : ${renameRecords.length}`);
leak('un RENOMMAGE n\'est pas une suppression : rien ne doit être enregistré',
  renameRecords.length ? 'le renommage a écrit un record → le verrou retirerait du payload l\'expérience renommée' : '',
  renameRecords.length > 0);
const writtenPair = T.protectUnrecordedDrops(
  renamePair,
  renamePair,
  [{ id: 't_rename', name: 'Pd1', datasetId: 'ds_sim', deletedAt: 1000 }],
);
say(`  une écriture partant avec les deux lignes d\'un id : ${renamePair.length} → ${writtenPair.tests.length} ligne(s),`
  + ` jumeau(x) effondré(s) : ${writtenPair.collapsed.length}, remise(s) : ${writtenPair.rescued.length}`);
leak('la copie qui part ne doit plus porter DEUX lignes du même id',
  writtenPair.collapsed.length ? '' : 'l\'écriture publierait les deux lignes : la relecture suivante en effacera une en silence',
  writtenPair.collapsed.length === 0);

  say('');
  say('⑧ LA LEVÉE (🛡 `recordExperimentRevivals`) — deux dates, DEUX HORLOGES DE POSTES');
  fakeStore.clear();
  const T0 = 1_700_000_000_000;
  /* Le VRAI geste (App.jsx:1969) : `recordExperimentDeletions(prev, next, …)` —
     la ligne ÉTAIT là, elle n'y est plus. `before` non vide, sinon
     experimentTombstones.js:442 rend la main sans rien enregistrer. */
  T.recordExperimentDeletions([{ id: idOnly, name: rescuedRow.name, datasetId: 'ds_sim' }], [], 'ds_sim', T0);
  const del = T.deletionsForDataset(T.loadExperimentDeletions(), 'ds_sim');
  const rev = T.recordExperimentRevivals([{ id: idOnly, name: rescuedRow.name, datasetId: 'ds_sim' }], 'ds_sim', T0 - 60_000).revivals;
  const standing = T.withoutRevivedExperiments(del, T.revivalsForDataset(rev, 'ds_sim'));
  const written = T.withoutDeletedExperiments([{ id: idOnly, name: rescuedRow.name, datasetId: 'ds_sim' }], standing);
  say(`  suppression enregistrée à +0 s, levée écrite à −60 s (horloge du poste en retard) → `
    + `suppression qui tient : ${standing.length} ; lignes écrites : ${written.length}`);
  leak('la levée ne bat pas une suppression écrite 60 s « plus tard » par un autre poste',
    written.length ? '' : 'la copie écrite repart SANS l\'expérience reprise : le verrou d\'écriture la reprend au premier enregistrement',
    standing.length > 0 && written.length === 0);

say('');
say('═══════════════════════════════════════════════════════════════════════════');
if (HOLES.length) {
  say(`  ${HOLES.length} FUITE(S) CONFIRMÉE(S) — une expérience reprise peut repartir en SILENCE :`);
  HOLES.forEach((h) => say(`    ✘ ${h}`));
  say('');
  say('  LE FIL COMMUN : DEUX IDENTITÉS QUI NE S\'ACCORDENT PAS.');
  say('    · l\'ÉCRAN et l\'import (➕) doivent identifier une expérience comme les GARDES : par son ID');
  say('      d\'abord (`experimentKey`), le nom à défaut — une règle UNIQUE, définie une fois');
  say('      (`experimentsToAdd`, `experimentRowChoices` l\'importent : personne ne la recopie) ;');
  say('    · et les GARDES (relecture, verrou d\'écriture, 🗑) par le MÊME id — une seule règle, pas deux.');
  say('    La reprise ramène les noms d\'aujourd\'hui avec les ids d\'un autre nom (« Test 87 » ≡ « pdb_ » ≡');
  say('    « pdb_CDK2_CyclinA ») : sans la règle partagée, l\'ajout empile un jumeau et les gardes croient la');
  say('    ligne reprise « déjà là » — elles la lâchent sans un mot, et l\'enregistrement automatique publie ce');
  say('    vide. Une 🗑, elle, laisse un record DATÉ (un RENOMMAGE n\'en laisse pas) que la levée 🛡 lève sans');
  say('    dépendre de l\'horloge d\'un autre poste.');
} else {
  say('  Aucune fuite : une expérience reprise ne peut plus repartir en silence.');
}
say('═══════════════════════════════════════════════════════════════════════════');

writeFileSync('_diag_twins.txt', out.join('\n'), 'utf8');
console.log('\n→ rapport écrit : _diag_twins.txt');
process.exitCode = HOLES.length ? 1 : 0;



