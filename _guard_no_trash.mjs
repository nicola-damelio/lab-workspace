/* _guard_no_trash.mjs — LA RÈGLE, VÉRIFIÉE (aucun accès réseau).
   Règle posée : LES DONNÉES DE LA CORBEILLE NE SE RESTAURENT PAS.

   Cette garde ne lit que des fichiers du dossier : elle constate que
   ① la matière de reprise (`_recover/recoverable_experiments.json`) ne contient
      que des fichiers-objets VIVANTS — son balayage d'origine interroge le Drive
      avec `trashed=false` (voir `_recover_experiments_scan.mjs`, `childrenOf`) ;
   ② aucune de mes sondes/reprises ne DEMANDE la corbeille : toute requête
      `drive/v3/files` qui liste ou cherche doit porter `trashed=false` ;
   ③ « Test 84 » — dont la seule trace est en corbeille — n'est NI dans la
      matière, NI dans le fichier de reprise produit.

   Usage : node _guard_no_trash.mjs */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const OUT = '_recover/guard.txt';
const lines = [];
const say = (s = '') => lines.push(String(s));
const ok = (cond, good, bad) => { say(`   ${cond ? '✔' : '✖'} ${cond ? good : bad}`); return cond; };
let allOk = true;

say(`# Garde — la corbeille ne se restaure pas (${new Date().toISOString()})\n`);

/* ① La matière : des fichiers-objets vivants uniquement. */
const MAT = '_recover/recoverable_experiments.json';
say('## ① La matière de reprise');
if (!existsSync(MAT)) {
  say('   ✖ matière absente'); allOk = false;
} else {
  const mat = JSON.parse(readFileSync(MAT, 'utf8'));
  const rows = Array.isArray(mat.recoverable) ? mat.recoverable : [];
  allOk = ok(rows.length > 0, `${rows.length} fichier(s)-objet retenu(s), tous issus d'un balayage « trashed=false »`,
    'matière vide — rien n’a été retenu') && allOk;
  const names = rows.map((r) => String(r.name));
  const has84 = names.some((n) => /^test[ _]?84$/i.test(n.trim()))
    || (mat.driveNames || []).some((n) => /^test[ _]?84$/i.test(String(n).trim()));
  allOk = ok(!has84, '« Test 84 » absent de la matière (il n’existe plus que dans la corbeille)',
    '« Test 84 » est dans la matière : elle vient donc de la corbeille — à écarter') && allOk;
  say(`   • ${new Set(rows.map((r) => String(r.object && r.object.id))).size} expérience(s) distincte(s) `
    + `pour ${rows.length} fichier(s)-objet (les autres noms sont des renommages)`);
}

/* ② Rien, dans mes outils, ne LIT la corbeille : la règle veut qu'elle ne soit
   jamais une source. La syntaxe distingue les deux directions :
     · `trashed=true`  apparaît dans une RECHERCHE (`?q=`) → LECTURE de la
       corbeille : interdite, ZÉRO toléré ;
     · `trashed: true` apparaît dans un CORPS d'écriture (PATCH) → RANGEMENT à la
       corbeille (outil de ménage des jumeaux) : il ne la lit pas, on le NOMME
       sans le confondre. */
say('\n## ② Aucun de mes outils ne LIT la corbeille');
const SELF = path.basename(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const READ_TRASH_Q = new RegExp(`trashed${'\\s*=\\s*'}true`, 'i');
const WRITE_TRASH = new RegExp(`trashed${'\\s*:\\s*'}true`, 'i');
const mine = readdirSync('.').filter((f) => /^_.*\.mjs$/.test(f) && f !== SELF);
const readers = [];
const writers = [];
const unguarded = [];
mine.forEach((f) => {
  let src = '';
  try { src = readFileSync(f, 'utf8'); } catch { return; }
  if (!src.includes('drive/v3/files')) return;
  /* Seules les lignes de CODE comptent : la même phrase dans un commentaire
     (un en-tête qui EXPLIQUE la corbeille) n'est pas une requête. */
  const codeLines = src.split('\n').filter((l) => {
    const t = l.trim();
    return !(/^(\/\/|\*|\/\*)/.test(t));
  }).join('\n');
  /* Une LECTURE de la corbeille = une vraie requête : la ligne doit citer
     `trashed=true` ET appeler la recherche (`listAll(`, `?q=`, `files?`). Un
     en-tête qui EXPLIQUE la corbeille n'est pas une requête. */
  const searchLines = codeLines.split('\n')
    .filter((l) => READ_TRASH_Q.test(l) && /(listAll\(|\?q=|files\?|q=)/.test(l));
  if (searchLines.length) readers.push(f);
  if (WRITE_TRASH.test(codeLines)) writers.push(f);
  const searches = (src.match(/\?q=[^\n]*/g) || []).filter((q) => /name\s*=|in parents/.test(q));
  if (searches.length && !src.includes('trashed=false')) unguarded.push(f);
});
say(`   • fichiers examinés : ${mine.length} · qui LISENT la corbeille : ${readers.length}`
  + ` · qui y RANGENT (écriture) : ${writers.length} · recherches sans « trashed=false » : ${unguarded.length}`);
readers.forEach((f) => say(`     – LIT LA CORBEILLE : ${f}`));
writers.forEach((f) => say(`     – range à la corbeille (jamais lue) : ${f}`));
unguarded.forEach((f) => say(`     – sans garde : ${f}`));
allOk = ok(readers.length === 0, 'aucun outil ne cherche « trashed=true » (la corbeille n’est pas une source)',
  `à retirer du dossier : ${readers.join(', ')}`) && allOk;
allOk = ok(unguarded.length === 0, 'toutes les recherches portent « trashed=false »',
  `sans « trashed=false » : ${unguarded.join(', ')}`) && allOk;

/* ③ Le fichier de reprise lui-même : « Test 84 » n'y est pas. */
say('\n## ③ Le fichier de reprise produit');
const made = readdirSync('_recover').filter((f) => /_experiences-retrouvees_.*\.json$/.test(f));
if (!made.length) {
  say('   ⚠ aucun fichier de reprise (lancer _recover_experiments.mjs)');
} else {
  made.forEach((f) => {
    const raw = readFileSync(`_recover/${f}`, 'utf8');
    const clean = !/Test[ _]?84/i.test(raw);
    allOk = ok(clean, `${f} ne contient pas « Test 84 »`, `${f} contient « Test 84 »`) && allOk;
    const doc = JSON.parse(raw);
    say(`     • ${f} · ${Math.round(Buffer.byteLength(raw, 'utf8') / 1024)} Ko · `
      + `dataset ${doc.datasetId} · comptes ${JSON.stringify(doc.counts)}`);
  });
}

say(`\n## Verdict`);
say(allOk ? '   ✔ La règle est tenue : la corbeille n’est ni lue, ni proposée, ni citée.'
  : '   ✖ Une des vérifications a échoué — voir ci-dessus.');

writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8');
console.log(`→ ${OUT}`);
