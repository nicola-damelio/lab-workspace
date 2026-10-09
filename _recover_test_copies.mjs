/* =========================================================================
   _recover_test_copies.mjs — DES COPIES « POUR ESSAYER », SANS CONFUSION DE NOM.

   La question posée : « peut-on charger un backup dans un dataset d'ESSAI sans
   toucher le dataset d'origine, et sans que l'essai porte le MÊME NOM ? »

   Ce que le code de l'app fait (App.jsx, `loadHTML` / `confirmLoad`) :

     • la DESTINATION ne dépend PAS du fichier mais de ce qui est OUVERT —
       une base d'administration ouverte ⇒ l'import se fait DANS cette base
       (« restoringInPlace ») ; tout autre dataset ouvert (ou l'Explorateur)
       ⇒ un dataset NEUF (`ds_<timestamp>`) est créé et la base ouverte n'est
       jamais écrite ;
     • le NOM vient du fichier : pour une base, le titre adopté est `title` de
       l'en-tête JSON (`pendingLoad.adminTitle`). Deux datasets de même titre
       écrivent donc dans le MÊME dossier Drive (`backupFolderOf(title)` =
       `<slug(titre)>/backups`) : c'est la confusion à éviter.

   D'où ce script : il relit les fichiers de restauration de `_recover/`, garde
   la charge (payload) OCTET POUR OCTET, et n'écrit qu'un en-tête différent —
   titre suffixé « — TEST VÉRIF (à supprimer) », sous-titre préfixé « TEST — ».
   Un dataset créé depuis une copie de test ne peut donc PAS se confondre avec
   la base d'origine, ni sur Drive ni dans la liste des datasets.

   ⚠ Ces copies servent au dataset d'ESSAI uniquement : importées « tout
   coché » dans la VRAIE base, elles la renommeraient (le titre est importé).

   Usage :  node _recover_test_copies.mjs
   ========================================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
register('./_esm_test_hook.mjs', import.meta.url);
const B = await import('./src/utils/backupFile.js');

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(ROOT, '_recover');
const OUT_DIR = path.join(SRC_DIR, 'test');
const SUFFIX = ' — TEST VÉRIF (à supprimer)';

/* Les comptes par PAGE de la charge (l'administration range tout sous
   `administration`) : c'est la comparaison qui prouve que seule l'en-tête a
   bougé. */
const pageCountsOf = (state) => {
  const adm = (state && state.administration && typeof state.administration === 'object')
    ? state.administration : {};
  const out = new Map();
  Object.keys(adm).forEach((k) => { if (Array.isArray(adm[k])) out.set(k, adm[k].length); });
  return out;
};

const files = fs.readdirSync(SRC_DIR)
  .filter((n) => n.toLowerCase().endsWith('.json'))
  .sort();
if (!files.length) {
  console.log(`Aucun fichier .json dans ${SRC_DIR}`);
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

let bad = 0;
for (const name of files) {
  const src = path.join(SRC_DIR, name);
  const raw = fs.readFileSync(src, 'utf8');
  const before = B.parseBackupText(raw);
  console.log(`\n══ ${name}`);
  if (!before.ok || !before.doc) {
    console.log(`  ✖ REFUSÉ par l'app : ${before.reason} — copie NON écrite`);
    bad += 1;
    continue;
  }

  /* On REPART du document lu : la charge, la date et la provenance sont
     recopiées telles quelles. `buildBackupDocument` recalcule lui-même les
     comptes et le résumé À PARTIR DE LA CHARGE (voir backupFile.js), donc
     l'en-tête ne peut pas annoncer autre chose que ce que le fichier porte. */
  const doc = before.doc;
  const title = `${doc.title}${SUFFIX}`;
  const subtitle = `TEST — ${doc.subtitle || 'ne pas confondre avec la base'} (charge identique à « ${doc.title} »)`;
  const testDoc = B.buildBackupDocument({
    payload: doc.payload,
    title,
    subtitle,
    datasetId: doc.datasetId,
    savedAt: doc.savedAt,
    compressed: doc.compressed !== false
  });

  const outName = `${name.replace(/\.json$/i, '')}_TEST.json`;
  const outPath = path.join(OUT_DIR, outName);
  fs.writeFileSync(outPath, B.backupDocumentText(testDoc), 'utf8');

  /* CE QUI DOIT ÊTRE VRAI, ET QUI EST VÉRIFIÉ ICI :
     ① le validateur de l'app accepte la copie ;
     ② la chargée est IDENTIQUE (chaîne) ;
     ③ les comptes par page sont IDENTIQUES ;
     ④ le nom du dossier Drive change (donc aucune confusion possible). */
  const after = B.parseBackupText(fs.readFileSync(outPath, 'utf8'));
  const samePayload = after.doc && after.doc.payload === doc.payload;
  const a = pageCountsOf(before.state);
  const b = pageCountsOf(after.state);
  const samePages = a.size === b.size && [...a.entries()].every(([k, n]) => b.get(k) === n);
  const folderBefore = B.backupFolderOf(doc.title);
  const folderAfter = B.backupFolderOf(testDoc.title);

  console.log(`  → ${path.relative(ROOT, outPath)} (${Math.round(Buffer.byteLength(fs.readFileSync(outPath, 'utf8'), 'utf8') / 1024)} Ko)`);
  console.log(`  titre       : « ${testDoc.title} »`);
  console.log(`  validé      : ${after.ok ? 'oui' : `NON — ${after.reason}`}`);
  console.log(`  charge id.  : ${samePayload ? 'oui (octet pour octet)' : 'NON — ne pas utiliser'}`);
  console.log(`  pages id.   : ${samePages ? `oui (${a.size} page(s) : ${[...a.keys()].join(', ')})` : 'NON — ne pas utiliser'}`);
  console.log(`  dossier Dr. : ${folderBefore}  →  ${folderAfter}`);
  if (!after.ok || !samePayload || !samePages || folderBefore === folderAfter) bad += 1;
}

console.log(bad
  ? `\n✖ ${bad} copie(s) douteuse(s) — NE PAS les charger.`
  : `\n✔ ${files.length} copie(s) de test écrites dans ${path.relative(ROOT, OUT_DIR)} — charge identique, titre distinct.`);
process.exit(bad ? 1 : 0);
