/* =========================================================================
   _probe_noproject.mjs — QUI est l'expérience « sans Projet » ?

   Le message qui apparaît à la connexion vient de `validateDatasetExperiments`
   (src/utils/experimentRules.js) appelé par `runWeeklyBackup` (src/App.jsx) :
   il compte les tests SANS projet dans `latestDataRef.current.tests`.

   Cet outil est LOCAL et en LECTURE SEULE :
     · il imprime les règles exactes qui décident « sans projet » (le code) ;
     · il regarde la COPIE locale du dataset (_recover/found2.json) et dit
       combien de tests n'ont aucun projet, avec leurs noms et leurs ids ;
     · il fait de même pour les 6 expériences reprises (_recover/*.json), car
       une expérience reprise SANS projet ferait exactement ce message.
   Rien n'est écrit, rien n'est envoyé.
   ========================================================================= */
import { readFileSync, readdirSync } from 'node:fs';
import LZString from 'lz-string';

const say = (s = '') => console.log(String(s));

/* ── 1. les règles, lues dans le code ───────────────────────────────────── */
say('════ 1. LES RÈGLES (src/utils/experimentRules.js) ════');
const rules = readFileSync('src/utils/experimentRules.js', 'utf8');
const lines = rules.split('\n');
const grab = (name) => {
  const i = lines.findIndex((l) => new RegExp(`(export\\s+)?const\\s+${name}\\s*=`).test(l));
  if (i < 0) return;
  /* on imprime jusqu'à la fin de la déclaration (ligne qui commence par `};`) */
  for (let j = i; j < Math.min(i + 30, lines.length); j++) {
    say(`   ${j + 1}| ${lines[j]}`);
    if (/^\};?\s*$/.test(lines[j])) break;
  }
  say('');
};
grab('isExperimentTest');
grab('experimentsWithoutProjects');
grab('experimentProjects');
say('   — ce que `validateDatasetExperiments` en fait —');
say(`   ${lines.slice(187, 199).map((l, k) => `${188 + k}| ${l}`).join('\n   ')}`);

/* ── 2. la copie locale du dataset ──────────────────────────────────────── */
const payloadOf = (raw) => {
  const doc = JSON.parse(raw);
  if (doc && typeof doc.payload === 'string') {
    /* backupFile.js : payload = LZString compressé (où en clair si compressed=false) */
    return { doc, payload: null, compressed: doc.compressed !== false };
  }
  return { doc, payload: doc, compressed: false };
};

say('\n════ 2. LA COPIE DU DATASET (_recover/found2.json) ════');
const raw = readFileSync('_recover/found2.json', 'utf8');
const { doc } = payloadOf(raw);
say(`   clés racine : ${Object.keys(doc).slice(0, 14).join(', ')}${Object.keys(doc).length > 14 ? ' …' : ''}`);
say(`   format=${doc.format || '—'} · schema=${doc.schema ?? '—'} · datasetId=${doc.datasetId || '—'} · compressé=${doc.compressed !== false}`);
let tests = [];
if (Array.isArray(doc.tests)) tests = doc.tests;
else if (Array.isArray(doc.payload)) tests = doc.payload;
else if (Array.isArray(doc.data?.tests)) tests = doc.data.tests;
else if (Array.isArray(doc.data)) tests = doc.data;
if (!tests.length) {
  /* payload compressé : il faut LZString, présent dans le projet */
  say('   (payload compressé — décompression via le module du projet)');
}
say(`   tests trouvés à la racine : ${tests.length}`);
say(`   exemple de clés d'un test : ${tests[0] ? Object.keys(tests[0]).slice(0, 12).join(', ') : '—'}`);

const isExp = (t) => !!(t && (t.instanceName || t.testCategory || t.category || t.protocol || t.fcsData || t.nmrData || t.conditions));
const projectNamesOf = (t) => (Array.isArray(t?.projectNames) ? t.projectNames : [])
  .map((s) => String(s || '').trim()).filter(Boolean);

const noProj = tests.filter((t) => isExp(t) && projectNamesOf(t).length === 0);
say(`\n   ▸ tests « expérience » (instanceName/testCategory…) : ${tests.filter(isExp).length}`);
say(`   ▸ SANS aucun projet : ${noProj.length}`);
noProj.forEach((t) => say(`      – « ${t.name} »  id=${t.id}  instanceName=${t.instanceName || '—'}  projectNames=${JSON.stringify(t.projectNames ?? null)}`));

/* ── 3. les expériences reprises ─────────────────────────────────────────── */
say('\n════ 3. LES EXPÉRIENCES REPRISES (_recover/GEC-*experiences-retrouvees*.json) ════');
const files = readdirSync('_recover').filter((f) => /experiences-retrouvees.*\.json$/.test(f));
say(`   fichiers : ${files.join(', ') || '—'}`);
files.forEach((f) => {
  const d = JSON.parse(readFileSync(`_recover/${f}`, 'utf8'));
  /* Le document porte sa charge dans `payload` (compressé en UTF16) —
     exactement ce que lit `parseBackupText` (src/utils/backupFile.js). */
  let content = d;
  if (typeof d.payload === 'string') {
    const json = d.compressed === false ? d.payload : (LZString.decompressFromUTF16(d.payload) || '');
    try { content = JSON.parse(json); } catch { content = null; }
  }
  const list = content && Array.isArray(content.tests) ? content.tests : [];
  say(`   • ${f} · tests=${list.length} · datasetId=${d.datasetId || '—'} · compressé=${d.compressed !== false}`);
  list.forEach((t) => {
    const pn = projectNamesOf(t);
    say(`      ${pn.length ? '✔' : '✖ SANS PROJET'} « ${t.name} » id=${t.id}`
      + `  type=${t.type || '—'}  instance=${t.instanceName || '—'}`
      + `  projectNames=${JSON.stringify(t.projectNames ?? null)}`);
  });
  if (!list.length) say('      (aucune expérience lue)');
});
